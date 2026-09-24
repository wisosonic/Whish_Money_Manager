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

export const base44 = {
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

  // Admin panel (data:export / data:purge — Admin and Manager). Dates are YYYY-MM-DD, inclusive.
  admin: {
    // First and last day that has any data.
    range: async () => apiRequest('/admin/range', { method: 'GET' }),
    // Counts and totals in a range (the preview shown before a backup or a delete).
    summary: async (from, to) =>
      apiRequest(`/admin/summary?${new URLSearchParams({ from, to })}`, { method: 'GET' }),
    // CSV backup; kind is "transactions" or "balances". Returns { blob, filename }.
    exportCsv: async (kind, from, to) =>
      apiRequest(`/admin/export?${new URLSearchParams({ kind, from, to })}`, { method: 'GET', download: true }),
    // Deletes the range's transactions and opening balances. `expectedCount` is the number of
    // transactions the user confirmed; the server refuses (409) if the data changed since.
    purge: async (from, to, expectedCount) =>
      apiRequest('/admin/purge', {
        method: 'POST',
        body: JSON.stringify({ from, to, expected_count: expectedCount }),
      }),
  },
  entities: {
    Transaction: {
      ...makeEntityClient('transactions'),

      // Existing transactions that share a reference number with an upload (re-imported statement lines).
      findDuplicates: async (references) =>
        apiRequest('/transactions/find-duplicates', {
          method: 'POST',
          body: JSON.stringify({ references }),
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

      // Like bulkCreate, but with overwrite=true it first deletes existing entries with the same references.
      importRecords: async (records, { overwrite = false } = {}) =>
        apiRequest('/transactions/import', {
          method: 'POST',
          body: JSON.stringify({ records, overwrite }),
        }),
    },
    DailyBalance: makeEntityClient('daily-balances'),
  },
  integrations: {
    Core: {
      ExtractPdf: async (file) => {
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
          body: JSON.stringify({ base64 }),
        });
      },
      ExtractCsv: async (file) => {
        const text = await file.text();
        return apiRequest('/csv/extract', {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
      },
    },
  },
};
