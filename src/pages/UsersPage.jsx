import { useCallback, useEffect, useState } from "react";
import { UserPlus, KeyRound, Loader2, X, AlertCircle, CheckCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import Header from "@/components/layout/Header";

const MIN_PASSWORD_LENGTH = 8;
const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200";

// Admin-only screen (route guarded in App.jsx; every action is re-checked by the API).
export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetFor, setResetFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [userList, roleList] = await Promise.all([base44.users.list(), base44.roles.list()]);
      setUsers(userList);
      setRoles(roleList);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (target, changes, successMessage) => {
    setError("");
    setNotice("");
    try {
      await base44.users.update(target.id, changes);
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100" dir="rtl">
      <Header />
      <div className="p-2 md:p-4 max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
            <div>
              <h2 className="text-lg font-bold text-gray-800">المستخدمون والصلاحيات</h2>
              <p className="text-sm text-gray-500">{users.length} مستخدم</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
              <UserPlus className="w-4 h-4" />
              إضافة مستخدم
            </button>
          </div>

          {error && (
            <div role="alert" className="m-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
          {notice && (
            <div role="status" className="m-4 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle className="w-4 h-4" /> {notice}
            </div>
          )}

          {/* Role summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 border-b bg-gray-50">
            {roles.map((role) => (
              <div key={role.id} className="bg-white rounded-lg border border-gray-100 p-3">
                <p className="font-bold text-gray-800">{role.label}</p>
                <p className="text-xs text-gray-500 mt-1" dir="ltr">{role.description}</p>
              </div>
            ))}
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-3">الاسم</th>
                    <th className="px-4 py-3">البريد الإلكتروني</th>
                    <th className="px-4 py-3">الدور</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3">آخر دخول</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => {
                    const isSelf = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} className={u.is_active ? "" : "bg-gray-50 text-gray-400"} data-testid={`user-row-${u.email}`}>
                        <td className="px-4 py-3 font-medium">
                          {u.full_name || "-"} {isSelf && <span className="text-xs text-blue-600">(أنت)</span>}
                        </td>
                        <td className="px-4 py-3" dir="ltr">{u.email}</td>
                        <td className="px-4 py-3">
                          <select
                            aria-label={`دور ${u.email}`}
                            value={u.role}
                            onChange={(e) => update(u, { role: e.target.value }, `تم تغيير دور ${u.email}`)}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-sm bg-white">
                            {roles.map((role) => <option key={role.name} value={role.name}>{role.label}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                            {u.is_active ? "نشط" : "معطّل"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs" dir="ltr">{u.last_login ? new Date(u.last_login).toLocaleString("en-GB") : "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => setResetFor(u)}
                              className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                              <KeyRound className="w-3.5 h-3.5" /> كلمة المرور
                            </button>
                            {!isSelf && (
                              <button
                                onClick={() => update(u, { is_active: !u.is_active }, u.is_active ? `تم تعطيل ${u.email} وتسجيل خروجه` : `تم تفعيل ${u.email}`)}
                                className={`rounded-lg px-2 py-1 text-xs border ${u.is_active ? "border-red-200 text-red-600 hover:bg-red-50" : "border-green-200 text-green-700 hover:bg-green-50"}`}>
                                {u.is_active ? "تعطيل" : "تفعيل"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreateUserModal
          roles={roles}
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            setShowCreate(false);
            setNotice(`تمت إضافة ${created.email}`);
            await load();
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          target={resetFor}
          onClose={() => setResetFor(null)}
          onSaved={async () => {
            const email = resetFor.email;
            setResetFor(null);
            setNotice(`تم تغيير كلمة مرور ${email} وتسجيل خروجه من كل الأجهزة`);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" role="dialog" aria-label={title}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="إغلاق"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateUserModal({ roles, onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: "", email: "", role: "user", password: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      onCreated(await base44.users.create(form));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal title="إضافة مستخدم" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="new-name" className="block text-sm text-gray-600 mb-1">الاسم</label>
          <input id="new-name" value={form.full_name} onChange={set("full_name")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="new-email" className="block text-sm text-gray-600 mb-1">البريد الإلكتروني</label>
          <input id="new-email" type="email" required dir="ltr" value={form.email} onChange={set("email")} className={inputCls} />
        </div>
        <div>
          <label htmlFor="new-role" className="block text-sm text-gray-600 mb-1">الدور</label>
          <select id="new-role" value={form.role} onChange={set("role")} className={inputCls}>
            {roles.map((role) => <option key={role.name} value={role.name}>{role.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm text-gray-600 mb-1">كلمة المرور (8 أحرف على الأقل)</label>
          <input id="new-password" type="password" required dir="ltr" autoComplete="new-password" value={form.password} onChange={set("password")} className={inputCls} />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? "جاري الحفظ..." : "إضافة"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ target, onClose, onSaved }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`);
      return;
    }
    setSaving(true);
    try {
      await base44.users.update(target.id, { password });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Modal title={`كلمة مرور جديدة لـ ${target.email}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-500">سيتم تسجيل خروج المستخدم من كل الأجهزة.</p>
        <div>
          <label htmlFor="reset-password" className="block text-sm text-gray-600 mb-1">كلمة المرور الجديدة</label>
          <input id="reset-password" type="password" required dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="border rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
            {saving ? "جاري الحفظ..." : "حفظ"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
