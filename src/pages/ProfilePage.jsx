import { useEffect, useState } from "react";
import { UserRound, IdCard, KeyRound, Loader2 } from "lucide-react";
import { api } from "@/api/apiClient";
import Header, { formatLastLogin } from "@/components/layout/Header";
import { Section } from "@/components/settings/SettingsControls";
import { useAuth } from "@/lib/AuthContext";
import { useI18n } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { usePreferences } from "@/lib/PreferencesContext";

// The signed-in user's own profile (every role): what the account is, and changing the name, the
// email (needs the current password) and the password (signs out the user's other devices).
// Roles and deactivation stay with the Admin on the Users page.
const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 100;
const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-200";
const labelCls = "flex flex-col gap-1 text-sm font-medium text-gray-700";
const buttonCls = "inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300";
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default function ProfilePage() {
  const { t, dir, num } = useI18n();
  const { user } = useAuth();
  const hour24 = usePreferences().preferences.clock === "24h";
  const when = (iso) => (iso ? <span dir="ltr">{num(formatLastLogin(iso, { hour24 }))}</span> : "—");

  const details = [
    { key: "name", label: t("profile.name"), value: user?.full_name || "—" },
    { key: "email", label: t("profile.email"), value: <span dir="ltr">{user?.email}</span> },
    { key: "role", label: t("profile.role"), value: user?.role ? t(`roles.${user.role}`) : "—" },
    { key: "since", label: t("profile.memberSince"), value: when(user?.created_date) },
    { key: "current", label: t("profile.currentLogin"), value: when(user?.last_login) },
    { key: "previous", label: t("profile.previousLogin"), value: user?.previous_login ? when(user.previous_login) : t("header.firstLogin") },
  ];

  return (
    <div className="min-h-screen bg-gray-100" dir={dir}>
      <Header />
      <main className="p-3 md:p-6 max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("profile.title")}</h1>
          <p className="text-sm text-gray-500">{t("profile.subtitle")}</p>
        </div>

        <Section id="profile-account" icon={IdCard} title={t("profile.account")}>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm" data-testid="profile-details">
            {details.map((item) =>
              <div key={item.key} className="min-w-0" data-testid={`profile-${item.key}`}>
                <dt className="text-gray-500">{item.label}</dt>
                <dd className="font-semibold text-gray-800 break-words">{item.value}</dd>
              </div>
            )}
          </dl>
        </Section>

        {user && <PersonalInfoForm user={user} />}
        <PasswordForm />
      </main>
    </div>
  );
}

// ═══ Name and email ═══

function PersonalInfoForm({ user }) {
  const { t, errorText } = useI18n();
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.full_name || "");
  const [email, setEmail] = useState(user.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // After a save (or a refresh of the account), start again from what's stored.
  useEffect(() => {
    setName(user.full_name || "");
    setEmail(user.email || "");
    setCurrentPassword("");
  }, [user.full_name, user.email]);

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  const nameChanged = trimmedName !== (user.full_name || "");
  const emailChanged = normalizedEmail !== user.email;
  const nameValid = trimmedName.length <= MAX_NAME_LENGTH;
  const emailValid = isValidEmail(normalizedEmail);
  const canSave = (nameChanged || emailChanged) && nameValid && emailValid && (!emailChanged || currentPassword) && !saving;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const changes = {};
      if (nameChanged) changes.full_name = trimmedName;
      if (emailChanged) Object.assign(changes, { email: normalizedEmail, current_password: currentPassword });
      const updated = await api.auth.updateProfile(changes);
      updateUser(updated);
      notify.success(emailChanged ? t("profile.info.savedEmail", { email: updated.email }) : t("profile.info.saved"));
    } catch (err) {
      const message = errorText(err.message);
      setError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section id="profile-info" icon={UserRound} title={t("profile.info.title")} description={t("profile.info.description")}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className={labelCls}>
          {t("profile.name")}
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
            maxLength={MAX_NAME_LENGTH + 20} aria-invalid={!nameValid} data-testid="profile-name-input" />
        </label>
        {!nameValid && <p className="text-xs text-red-600">{t("profile.info.nameTooLong", { max: MAX_NAME_LENGTH })}</p>}
        <label className={labelCls}>
          {t("profile.email")}
          <input className={inputCls} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" aria-invalid={!emailValid} data-testid="profile-email-input" />
        </label>
        {!emailValid && <p className="text-xs text-red-600">{t("profile.info.emailInvalid")}</p>}
        {emailChanged && emailValid &&
          <>
            <p className="text-xs text-gray-500">{t("profile.info.emailNote")}</p>
            <label className={labelCls}>
              {t("profile.password.current")}
              <input className={inputCls} type="password" dir="ltr" value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" data-testid="profile-email-password" />
            </label>
          </>
        }
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={buttonCls} disabled={!canSave} data-testid="profile-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {t("profile.info.save")}
        </button>
      </form>
    </Section>
  );
}

// ═══ Password ═══

function PasswordForm() {
  const { t, errorText } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Shown once the field in question has something in it.
  const problem =
    next && next.length < MIN_PASSWORD_LENGTH ? t("users.passwordTooShort", { min: MIN_PASSWORD_LENGTH }) :
    next && current && next === current ? t("profile.password.same") :
    confirm && confirm !== next ? t("profile.password.mismatch") : "";
  const canSave = current && next && confirm && !problem && !saving;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      const { sessions_revoked: others } = await api.auth.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      notify.success(others ? t("profile.password.changedOthers", { count: others }) : t("profile.password.changed"));
    } catch (err) {
      const message = errorText(err.message);
      setError(message);
      notify.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section id="profile-password" icon={KeyRound} title={t("profile.password.title")} description={t("profile.password.description")}>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <label className={labelCls}>
          {t("profile.password.current")}
          <input className={inputCls} type="password" dir="ltr" value={current} onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password" data-testid="password-current" />
        </label>
        <label className={labelCls}>
          {t("profile.password.new", { min: MIN_PASSWORD_LENGTH })}
          <input className={inputCls} type="password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password" data-testid="password-new" />
        </label>
        <label className={labelCls}>
          {t("profile.password.confirm")}
          <input className={inputCls} type="password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password" data-testid="password-confirm" />
        </label>
        {problem && <p className="text-xs text-red-600" data-testid="password-problem">{problem}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={buttonCls} disabled={!canSave} data-testid="password-save">
          {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {t("profile.password.save")}
        </button>
      </form>
    </Section>
  );
}
