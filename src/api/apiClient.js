// @ts-nocheck

const LOCAL_API_PREFIX = '/local-api';
// Old versions kept the signed-in user in localStorage; it's no longer used and is cleared on load.
const LEGACY_LOCAL_STORAGE_USER_KEY = 'hawalaflow_local_user';

// Fired when the server says the session is gone (logged out elsewhere, deactivated, password reset).
// AuthContext listens and shows the login screen.
export const SESSION_ENDED_EVENT = 'auth:session-ended';

// The session lives in an HTTP-only cookie set by the server: the browser sends it automatically
// with same-origin requests, and page scripts can't read it.
// `download: true` returns { blob, filename } (from Content-Disposition) instead of parsed JSON.
const apiRequest = async (path, { download = false, ...options } = {}) => {
  const response = await fetch(`${LOCAL_API_PREFIX}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text)?.error || text;
    } catch {
      // not JSON — keep the raw text
    }
    if (response.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    }
    throw Object.assign(new Error(message || `Request failed: ${response.status}`), { status: response.status });
  }

  if (download) {
    const disposition = response.headers.get('Content-Disposition') || '';
    const filename = (disposition.match(/filename="([^"]+)"/) || [])[1] || 'download.csv';
    return { blob: await response.blob(), filename };
  }
  return response.json();
};

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_USER_KEY);
  } catch {
    // storage unavailable — nothing to clean up
  }
}

// Query string from the defined values only (undefined / null / "" are left out).
const query = (params) => {
  const defined = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return defined.length ? `?${new URLSearchParams(defined.map(([key, value]) => [key, String(value)]))}` : '';
};

const makeEntityClient = (entityPath) => ({
  filter: async (filter = {}, sortField = 'created_date', limit = 1000) =>
    apiRequest(`/${entityPath}/filter`, {
      method: 'POST',
      body: JSON.stringify({ filter, sortField, limit }),
    }),

  create: async (payload) =>
    apiRequest(`/${entityPath}/create`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  bulkCreate: async (records) =>
    apiRequest(`/${entityPath}/bulk-create`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),

  update: async (id, payload) =>
    apiRequest(`/${entityPath}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  delete: async (id) =>
    apiRequest(`/${entityPath}/${id}`, {
      method: 'DELETE',
    }),
});

export const api = {
  auth: {
    // The signed-in user (with role and permissions), or a 401 error.
    me: async () => apiRequest('/auth/me', { method: 'GET' }),

    // Sets the session cookie; returns the user.
    login: async (email, password) =>
      apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),

    // Saves part of the signed-in user's display preferences; returns the updated user.
    updatePreferences: async (changes) =>
      apiRequest('/auth/preferences', {
        method: 'PUT',
        body: JSON.stringify(changes),
      }),

    // The signed-in user's own name / email ({ full_name?, email?, current_password? }; the email
    // needs the current password). Returns the updated user.
    updateProfile: async (changes) =>
      apiRequest('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(changes),
      }),

    // Signs the user out on their other devices; returns { ok, sessions_revoked }.
    changePassword: async (currentPassword, newPassword) =>
      apiRequest('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      }),

    // Deletes the session on the server (the token can't be reused) and clears the cookie.
    logout: async (redirectUrl) => {
      await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    },
    redirectToLogin: (redirectUrl) => {
      if (redirectUrl) {
        window.location.href = redirectUrl;
      }
    },
  },

  // Admin only (users:manage).
  users: {
    list: async () => apiRequest('/users', { method: 'GET' }),
    create: async (payload) => apiRequest('/users', { method: 'POST', body: JSON.stringify(payload) }),
    update: async (id, payload) => apiRequest(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  },
  roles: {
    list: async () => apiRequest('/roles', { method: 'GET' }),
  },

  // Stores. Everyone sees their own store; the Admin (stores:manage) manages all of them; a store's
  // Manager (stores:members) adds and removes its Users.
  stores: {
    list: async () => apiRequest('/stores', { method: 'GET' }),
    get: async (id) => apiRequest(`/stores/${id}`, { method: 'GET' }),
    create: async (payload) => apiRequest('/stores', { method: 'POST', body: JSON.stringify(payload) }),
    update: async (id, payload) => apiRequest(`/stores/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: async (id) => apiRequest(`/stores/${id}`, { method: 'DELETE' }),
    // userId null clears the store's Manager.
    setManager: async (id, userId) => apiRequest(`/stores/${id}/manager`, { method: 'PUT', body: JSON.stringify({ user_id: userId }) }),
    assignable: async (id) => apiRequest(`/stores/${id}/assignable`, { method: 'GET' }),
    addMember: async (id, userId) => apiRequest(`/stores/${id}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
    removeMember: async (id, userId) => apiRequest(`/stores/${id}/members/${userId}`, { method: 'DELETE' }),
  },

  // Closed days, per store: nothing on a store's closed date can be changed until it's reopened
  // (days:close to change). storeId: the store (the Admin's list without one: every store's).
  closedDays: {
    list: async (storeId) => apiRequest(`/closed-days${query({ store_id: storeId })}`, { method: 'GET' }),
    close: async (date, storeId) => apiRequest('/closed-days', { method: 'POST', body: JSON.stringify({ date, store_id: storeId }) }),
    reopen: async (date, storeId) => apiRequest(`/closed-days/${encodeURIComponent(date)}${query({ store_id: storeId })}`, { method: 'DELETE' }),
  },

  // A store's commission rate on credits (percent) and its history (settings:office to change).
  commissionRates: {
    // { store_id, date, rate (on that date), current (today), history: [{ rate, effective_from, created_by, created_date }] }
    get: async (date, storeId) => apiRequest(`/commission-rates${query({ date, store_id: storeId })}`, { method: 'GET' }),
    set: async (rate, effectiveFrom, storeId) =>
      apiRequest('/commission-rates', { method: 'PUT', body: JSON.stringify({ rate, effective_from: effectiveFrom, store_id: storeId }) }),
    remove: async (effectiveFrom, storeId) =>
      apiRequest(`/commission-rates/${encodeURIComponent(effectiveFrom)}${query({ store_id: storeId })}`, { method: 'DELETE' }),
  },

  // Admin panel (data:export / data:purge — Admin and Manager). Dates are YYYY-MM-DD, inclusive.
  // storeId: one store; the Admin can leave it out for every store (a Manager always gets theirs).
  admin: {
    // First and last day that has any data.
    range: async (storeId) => apiRequest(`/admin/range${query({ store_id: storeId })}`, { method: 'GET' }),
    // Counts and totals in a range (the preview shown before a backup or a delete).
    summary: async (from, to, storeId) =>
      apiRequest(`/admin/summary${query({ from, to, store_id: storeId })}`, { method: 'GET' }),
    // CSV backup; kind is "transactions" or "balances". Returns { blob, filename }.
    exportCsv: async (kind, from, to, storeId) =>
      apiRequest(`/admin/export${query({ kind, from, to, store_id: storeId })}`, { method: 'GET', download: true }),
    // Deletes the range's transactions and opening balances. `expectedCount` is the number of
    // transactions the user confirmed; the server refuses (409) if the data changed since.
    purge: async (from, to, expectedCount, storeId) =>
      apiRequest('/admin/purge', {
        method: 'POST',
        body: JSON.stringify({ from, to, expected_count: expectedCount, store_id: storeId }),
      }),
    // Reports (data:export). income: { year, years, months: [{ month, count, profit, cashIn, cashOut }] }.
    // parties: party "sender" (of Cash In) or "receiver" (of Cash Out) in a range, ranked by
    // "volume" or "count" → { totals, rows: [{ rank, name, number, count, volume, average, share, … }] }.
    reports: {
      income: async (year, storeId) => apiRequest(`/admin/reports/income${query({ year, store_id: storeId })}`, { method: 'GET' }),
      parties: async ({ party, from, to, by = 'volume', limit = 10, storeId }) =>
        apiRequest(`/admin/reports/parties${query({ party, from, to, by, limit, store_id: storeId })}`, { method: 'GET' }),
      // Every store side by side (stores:all — the Admin): { totals, stores: [{ id, name, count, cash_in, cash_out, volume, commission, share }] }.
      stores: async (from, to) => apiRequest(`/admin/reports/stores${query({ from, to })}`, { method: 'GET' }),
    },
    // Restore a backup CSV (data:restore): preview what it would add, then add it. expectedCount is
    // the number of rows the preview showed; the server refuses (409) if that changed.
    // Rows keep the store named in the file; backups from before stores go to storeId.
    restorePreview: async (csv, storeId) => apiRequest('/admin/restore/preview', { method: 'POST', body: JSON.stringify({ csv, store_id: storeId }) }),
    restore: async (csv, expectedCount, storeId) =>
      apiRequest('/admin/restore', { method: 'POST', body: JSON.stringify({ csv, expected_count: expectedCount, store_id: storeId }) }),
  },
  entities: {
    Transaction: {
      ...makeEntityClient('transactions'),

      // Existing transactions of the store that share a reference number with an upload (re-imported statement lines).
      findDuplicates: async (references, storeId) =>
        apiRequest('/transactions/find-duplicates', {
          method: 'POST',
          body: JSON.stringify({ references, store_id: storeId }),
        }),

      // Apply the same changes to several transactions. `changes` may include type, sender_name,
      // receiver_name, service, note, transaction_date and commission_rate (applied per row to its amount).
      bulkUpdate: async (ids, changes) =>
        apiRequest('/transactions/bulk-update', {
          method: 'POST',
          body: JSON.stringify({ ids, changes }),
        }),

      bulkDelete: async (ids) =>
        apiRequest('/transactions/bulk-delete', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        }),

      // Like bulkCreate, but with overwrite=true it first deletes the store's entries with the same
      // references. storeId: the store the statement is imported into.
      importRecords: async (records, { overwrite = false, storeId } = {}) =>
        apiRequest('/transactions/import', {
          method: 'POST',
          body: JSON.stringify({ records, overwrite, store_id: storeId }),
        }),
    },
    DailyBalance: makeEntityClient('daily-balances'),
  },
  integrations: {
    Core: {
      // storeId: the store the statement is for (commissions use its rate).
      ExtractPdf: async (file, storeId) => {
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = String(reader.result || '');
            resolve(result.split(',')[1] || '');
          };
          reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        return apiRequest('/pdf/extract', {
          method: 'POST',
          body: JSON.stringify({ base64, store_id: storeId }),
        });
      },
      ExtractCsv: async (file, storeId) => {
        const text = await file.text();
        return apiRequest('/csv/extract', {
          method: 'POST',
          body: JSON.stringify({ text, store_id: storeId }),
        });
      },
    },
  },
};
