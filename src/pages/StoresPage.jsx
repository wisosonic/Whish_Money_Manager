import { useCallback, useEffect, useState } from "react";
import { Store, Plus, Pencil, Trash2, Users, MapPin, Phone, Mail, UserCog, Loader2, X, AlertTriangle, UserPlus, UserMinus } from "lucide-react";
import { api } from "@/api/apiClient";
import Header from "@/components/layout/Header";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { PERMISSIONS } from "@/lib/permissions";

// Stores. The Admin (stores:manage) adds, edits and deletes stores, picks each store's Manager and
// can manage any store's Users. A store's Manager manages its Users. Its Users see its details.
// Someone not in a store is told so. Every rule is also enforced by the API (server/stores.js).
const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200";
const buttonCls = "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300";

export default function StoresPage() {
  const { t, dir, errorText } = useI18n();
  const { user, can } = useAuth();
  const canManage = can(PERMISSIONS.STORES_MANAGE);
  const [stores, setStores] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // a store, or {} for a new one
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      setStores(await api.stores.list());
      // The Admin picks Managers from the users with the Manager role.
      if (canManage) setManagers((await api.users.list()).filter((u) => u.role === "manager" && u.is_active));
      setError("");
    } catch (err) {
      setError(errorText(err?.message || ""));
    } finally {
      setLoading(false);
    }
    // errorText only changes with the language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);
  useEffect(() => { load(); }, [load]);

  const setManager = async (store, userId) => {
    try {
      await api.stores.setManager(store.id, userId);
      const name = managers.find((m) => m.id === userId);
      notify.success(userId ? t("stores.managerSet", { store: store.name, manager: name?.full_name || name?.email }) : t("stores.managerCleared", { store: store.name }));
      await load();
    } catch (err) {
      notify.error(errorText(err?.message || ""));
    }
  };

  const remove = async () => {
    const store = deleting;
    try {
      await api.stores.remove(store.id);
      notify.success(t("stores.deleted", { store: store.name }));
      setDeleting(null);
      await load();
    } catch (err) {
      notify.error(errorText(err?.message || ""));
      setDeleting(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <main className="p-3 md:p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{canManage ? t("stores.title") : t("stores.myTitle")}</h1>
            <p className="text-sm text-gray-500">{canManage ? t("stores.subtitle") : t("stores.mySubtitle")}</p>
          </div>
          {canManage &&
            <button type="button" onClick={() => setEditing({})} className={`${buttonCls} bg-blue-600 hover:bg-blue-700 text-white`} data-testid="add-store">
              <Plus className="w-4 h-4" aria-hidden="true" />{t("stores.add")}
            </button>
          }
        </div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {loading ?
          <div className="p-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" aria-hidden="true" /></div> :
        stores.length === 0 ?
          <div className="bg-white rounded-2xl shadow p-8 text-center" data-testid="no-store">
            <Store className="w-10 h-10 text-blue-600 mx-auto mb-3" aria-hidden="true" />
            <h2 className="text-lg font-bold text-gray-800 mb-2">{t("stores.noStoreTitle")}</h2>
            <p className="text-sm text-gray-500">{t("stores.noStoreMessage")}</p>
          </div> :
          <div className={`grid gap-4 ${stores.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {stores.map((store) =>
              <StoreCard key={store.id} store={store} canManage={canManage} managers={managers}
                // Members: the Admin for every store, a Manager for the store they manage.
                canManageMembers={canManage || (can(PERMISSIONS.STORES_MEMBERS) && store.manager?.id === user?.id)}
                onEdit={() => setEditing(store)} onDelete={() => setDeleting(store)} onSetManager={(userId) => setManager(store, userId)}
                onMembersChanged={load} />
            )}
          </div>
        }
      </main>

      {editing && <StoreForm store={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {deleting &&
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
          <div role="alertdialog" aria-labelledby="delete-store-title" aria-describedby="delete-store-body" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-red-100 rounded-full p-2"><AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" /></div>
              <h2 id="delete-store-title" className="font-bold text-gray-800 text-lg">{t("stores.deleteTitle", { store: deleting.name })}</h2>
            </div>
            <p id="delete-store-body" className="text-sm text-gray-600">{t("stores.deleteBody")}</p>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setDeleting(null)} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">{t("common.cancel")}</button>
              <button type="button" onClick={remove} className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 font-semibold" data-testid="confirm-delete-store">{t("common.delete")}</button>
            </div>
          </div>
        </div>
      }
    </div>
  );
}

// ═══ One store ═══

function StoreCard({ store, canManage, managers, canManageMembers, onEdit, onDelete, onSetManager, onMembersChanged }) {
  const { t } = useI18n();
  const detail = (Icon, label, value, ltr = false) =>
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-gray-500">{label}</dt>
        <dd className="text-sm font-medium text-gray-800 break-words" dir={ltr ? "ltr" : undefined}>{value || "—"}</dd>
      </div>
    </div>;

  return (
    <section className="bg-white rounded-xl shadow p-4 md:p-6 min-w-0" aria-labelledby={`store-${store.id}`} data-testid={`store-${store.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="bg-blue-50 text-blue-700 rounded-lg p-2 shrink-0"><Store className="w-5 h-5" aria-hidden="true" /></div>
          <div className="min-w-0">
            <h2 className="font-bold text-gray-800 text-lg break-words" id={`store-${store.id}`}>{store.name}</h2>
            <p className="text-xs text-gray-500">{t("stores.userCount", { count: store.member_count })} · {t("stores.transactionCount", { count: store.transaction_count })}</p>
          </div>
        </div>
        {canManage &&
          <div className="flex gap-2">
            <button type="button" onClick={onEdit} className={`${buttonCls} border text-gray-700 hover:bg-gray-50`} aria-label={t("stores.editNamed", { store: store.name })}>
              <Pencil className="w-4 h-4" aria-hidden="true" />{t("common.edit")}
            </button>
            <button type="button" onClick={onDelete} className={`${buttonCls} border border-red-200 text-red-600 hover:bg-red-50`} aria-label={t("stores.deleteNamed", { store: store.name })}>
              <Trash2 className="w-4 h-4" aria-hidden="true" />{t("common.delete")}
            </button>
          </div>
        }
      </div>

      <dl className="grid sm:grid-cols-2 gap-3 mb-4">
        {detail(MapPin, t("stores.location"), store.location)}
        {detail(Phone, t("stores.phone"), store.phone, true)}
        {detail(Mail, t("stores.email"), store.email, true)}
        {canManage ?
          <div className="flex items-start gap-2 min-w-0">
            <UserCog className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" aria-hidden="true" />
            <label className="min-w-0 flex-1 text-xs text-gray-500">
              {t("stores.manager")}
              <select value={store.manager?.id ?? ""} onChange={(e) => onSetManager(e.target.value ? Number(e.target.value) : null)}
                aria-label={t("stores.managerOfNamed", { store: store.name })} data-testid={`manager-${store.id}`}
                className="mt-0.5 w-full border border-gray-200 rounded-lg px-2 py-1 text-sm font-medium text-gray-800 bg-white">
                <option value="">{t("stores.noManager")}</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}{m.store_id && m.store_id !== store.id ? ` (${m.store_name})` : ""}</option>)}
              </select>
            </label>
          </div> :
          detail(UserCog, t("stores.manager"), store.manager ? store.manager.full_name || store.manager.email : t("stores.noManager"))
        }
      </dl>

      {canManageMembers && <StoreMembers store={store} onChanged={onMembersChanged} />}
    </section>
  );
}

// ═══ A store's Users (its Manager, or the Admin) ═══

function StoreMembers({ store, onChanged }) {
  const { t, errorText } = useI18n();
  const [members, setMembers] = useState(null);
  const [assignable, setAssignable] = useState([]);
  const [adding, setAdding] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [details, candidates] = await Promise.all([api.stores.get(store.id), api.stores.assignable(store.id)]);
      setMembers(details.members || []);
      setAssignable(candidates);
    } catch (err) {
      notify.error(errorText(err?.message || ""));
      setMembers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.id]);
  useEffect(() => { load(); }, [load]);

  const change = async (action, message) => {
    setWorking(true);
    try {
      await action();
      notify.success(message);
      setAdding("");
      await load();
      onChanged?.();
    } catch (err) {
      notify.error(errorText(err?.message || ""));
    } finally {
      setWorking(false);
    }
  };

  const users = (members || []).filter((m) => m.role === "user");
  return (
    <div className="border-t pt-4" data-testid={`members-${store.id}`}>
      <h3 className="flex items-center gap-2 font-semibold text-gray-800 mb-2">
        <Users className="w-4 h-4 text-blue-600" aria-hidden="true" />{t("stores.members")}
      </h3>
      {members === null ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" aria-hidden="true" /> :
        <>
          {users.length === 0 ?
            <p className="text-sm text-gray-500 mb-3">{t("stores.noMembers")}</p> :
            <ul className="divide-y divide-gray-100 mb-3">
              {users.map((m) =>
                <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-gray-800">{m.full_name || m.email}</span>
                    <span className="block text-xs text-gray-500" dir="ltr">{m.email}</span>
                  </span>
                  <button type="button" disabled={working} onClick={() => change(() => api.stores.removeMember(store.id, m.id), t("stores.memberRemoved", { user: m.full_name || m.email, store: store.name }))}
                    className={`${buttonCls} border text-gray-600 hover:bg-gray-50 px-2 py-1 text-xs`} aria-label={t("stores.removeMember", { user: m.full_name || m.email })}>
                    <UserMinus className="w-3.5 h-3.5" aria-hidden="true" />{t("stores.remove")}
                  </button>
                </li>
              )}
            </ul>
          }
          <div className="flex flex-wrap gap-2">
            <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t("stores.addMemberTo", { store: store.name })}
              data-testid={`add-member-${store.id}`} className="flex-1 min-w-[12rem] border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">{assignable.length ? t("stores.chooseUser") : t("stores.nobodyToAdd")}</option>
              {assignable.map((u) => <option key={u.id} value={u.id}>{u.full_name ? `${u.full_name} (${u.email})` : u.email}</option>)}
            </select>
            <button type="button" disabled={!adding || working} data-testid={`add-member-button-${store.id}`}
              onClick={() => {
                const who = assignable.find((u) => u.id === Number(adding));
                change(() => api.stores.addMember(store.id, Number(adding)), t("stores.memberAdded", { user: who?.full_name || who?.email, store: store.name }));
              }}
              className={`${buttonCls} bg-blue-600 hover:bg-blue-700 text-white`}>
              <UserPlus className="w-4 h-4" aria-hidden="true" />{t("stores.addMember")}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">{t("stores.membersHint")}</p>
        </>
      }
    </div>
  );
}

// ═══ Add / edit a store (Admin) ═══

function StoreForm({ store, onClose, onSaved }) {
  const { t, dir, errorText } = useI18n();
  const isNew = !store.id;
  const [form, setForm] = useState({ name: store.name || "", location: store.location || "", phone: store.phone || "", email: store.email || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const field = (key, label, props = {}) =>
    <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
      {label}
      <input className={inputCls} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} data-testid={`store-${key}`} {...props} />
    </label>;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const saved = isNew ? await api.stores.create(form) : await api.stores.update(store.id, form);
      notify.success(isNew ? t("stores.created", { store: saved.name }) : t("stores.saved", { store: saved.name }));
      onSaved();
    } catch (err) {
      const message = errorText(err?.message || "");
      setError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" dir={dir}>
      <form onSubmit={submit} role="dialog" aria-labelledby="store-form-title" className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full space-y-3" noValidate>
        <div className="flex items-center justify-between">
          <h2 id="store-form-title" className="font-bold text-gray-800 text-lg">{isNew ? t("stores.add") : t("stores.editNamed", { store: store.name })}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t("common.close")}><X className="w-5 h-5" /></button>
        </div>
        {field("name", t("stores.name"), { required: true, maxLength: 100, autoFocus: true })}
        {field("location", t("stores.location"), { maxLength: 200 })}
        {field("phone", t("stores.phone"), { maxLength: 40, dir: "ltr", type: "tel" })}
        {field("email", t("stores.email"), { maxLength: 120, dir: "ltr", type: "email" })}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 border rounded-lg py-2 text-gray-600 hover:bg-gray-50">{t("common.cancel")}</button>
          <button type="submit" disabled={!form.name.trim() || saving} data-testid="save-store"
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 font-semibold disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}{t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
