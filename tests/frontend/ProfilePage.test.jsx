/** @vitest-environment jsdom */
// Profile page: account details, changing the name / email (current password needed) and the
// password, and the header's link to it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/pages/ProfilePage";
import Header from "@/components/layout/Header";
import AppToaster from "@/components/layout/AppToaster";
import { LanguageProvider } from "@/lib/i18n";
import { PreferencesProvider } from "@/lib/PreferencesContext";
import { api } from "@/api/apiClient";
import { authMocks, setAuthRole } from "./authMock";
import { clearToasts, findToast } from "./toastHelpers";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: { auth: { updateProfile: vi.fn(), changePassword: vi.fn(), updatePreferences: vi.fn() } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "wmm_lang=; Max-Age=0; Path=/";
  setAuthRole("user", {
    full_name: "Rami Haddad",
    created_date: "2026-01-05T09:00:00Z",
    last_login: "2026-09-25T08:00:00Z",
    previous_login: null,
  });
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const renderPage = ({ lang, path = "/profile", ui = <ProfilePage /> } = {}) => render(
  <LanguageProvider initialLang={lang}>
    <MemoryRouter initialEntries={[path]}>
      <PreferencesProvider>{ui}<AppToaster /></PreferencesProvider>
    </MemoryRouter>
  </LanguageProvider>
);
const type = (testId, value) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe("account details", () => {
  it("shows name, email, role (translated) and sign-ins; a first sign-in says so", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "ملفي الشخصي" })).toBeInTheDocument();
    expect(screen.getByTestId("profile-name")).toHaveTextContent("Rami Haddad");
    expect(screen.getByTestId("profile-email")).toHaveTextContent("user@test.local");
    expect(screen.getByTestId("profile-role")).toHaveTextContent("مستخدم");
    expect(screen.getByTestId("profile-since")).toHaveTextContent(/2026\/01\/05/);
    expect(screen.getByTestId("profile-previous")).toHaveTextContent("أول تسجيل دخول");
  });

  it("works in English and for every role", () => {
    setAuthRole("manager", { previous_login: "2026-09-20T10:00:00Z" });
    renderPage({ lang: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "My profile" })).toBeInTheDocument();
    expect(screen.getByTestId("profile-role")).toHaveTextContent("Manager");
    expect(screen.getByTestId("profile-previous")).toHaveTextContent(/2026\/09\/20/);
  });
});

describe("personal information", () => {
  it("Save is disabled until something changes; a name change needs no password", async () => {
    api.auth.updateProfile.mockResolvedValue({ ...authMocks().user, full_name: "Rami H." });
    renderPage();
    expect(screen.getByTestId("profile-save")).toBeDisabled();
    type("profile-name-input", "  Rami H.  ");
    expect(screen.queryByTestId("profile-email-password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("profile-save"));
    await waitFor(() => expect(api.auth.updateProfile).toHaveBeenCalledWith({ full_name: "Rami H." }));
    expect(await findToast("تم حفظ الملف الشخصي")).toHaveAttribute("data-type", "success");
    expect(authMocks().updateUser).toHaveBeenCalledWith(expect.objectContaining({ full_name: "Rami H." }));
  });

  it("changing the email asks for the current password and sends it with the new address", async () => {
    api.auth.updateProfile.mockResolvedValue({ ...authMocks().user, email: "rami@test.local" });
    renderPage();
    type("profile-email-input", " Rami@Test.Local ");
    expect(screen.getByText(/العمليات التي أدخلتها باسمك/)).toBeInTheDocument();
    expect(screen.getByTestId("profile-save")).toBeDisabled();
    type("profile-email-password", "my-password");
    fireEvent.click(screen.getByTestId("profile-save"));
    await waitFor(() => expect(api.auth.updateProfile).toHaveBeenCalledWith({ email: "rami@test.local", current_password: "my-password" }));
    expect(await findToast("تم حفظ الملف الشخصي. سجّل الدخول من الآن بـ rami@test.local.")).toBeInTheDocument();
  });

  it("an invalid email or a too-long name can't be saved", () => {
    renderPage();
    type("profile-email-input", "not-an-email");
    expect(screen.getByText("أدخل بريداً إلكترونياً صحيحاً")).toBeInTheDocument();
    expect(screen.queryByTestId("profile-email-password")).not.toBeInTheDocument();
    expect(screen.getByTestId("profile-save")).toBeDisabled();
    type("profile-email-input", "user@test.local");
    type("profile-name-input", "x".repeat(101));
    expect(screen.getByText("يجب ألا يزيد الاسم عن 100 حرف")).toBeInTheDocument();
    expect(screen.getByTestId("profile-save")).toBeDisabled();
  });

  it("a refusal from the server is shown in the form and as a notification (translated)", async () => {
    api.auth.updateProfile.mockRejectedValue(new Error("Current password is incorrect"));
    renderPage();
    type("profile-email-input", "rami@test.local");
    type("profile-email-password", "wrong");
    fireEvent.click(screen.getByTestId("profile-save"));
    expect(await findToast("كلمة المرور الحالية غير صحيحة")).toHaveAttribute("data-type", "error");
    expect(screen.getByRole("alert")).toHaveTextContent("كلمة المرور الحالية غير صحيحة");
    expect(authMocks().updateUser).not.toHaveBeenCalled();
  });
});

describe("change password", () => {
  it("checks the new password as you type: length, same as current, confirmation", () => {
    renderPage();
    const save = screen.getByTestId("password-save");
    type("password-current", "old-password");
    type("password-new", "short");
    expect(screen.getByTestId("password-problem")).toHaveTextContent("8 أحرف على الأقل");
    type("password-new", "old-password");
    expect(screen.getByTestId("password-problem")).toHaveTextContent("يجب أن تختلف كلمة المرور الجديدة عن الحالية");
    type("password-new", "new-password");
    type("password-confirm", "new-passw0rd");
    expect(screen.getByTestId("password-problem")).toHaveTextContent("كلمتا المرور الجديدتان غير متطابقتين");
    expect(save).toBeDisabled();
    type("password-confirm", "new-password");
    expect(screen.queryByTestId("password-problem")).not.toBeInTheDocument();
    expect(save).toBeEnabled();
  });

  it("saves, clears the fields and says how many other devices were signed out", async () => {
    api.auth.changePassword.mockResolvedValue({ ok: true, sessions_revoked: 2 });
    renderPage({ lang: "en" });
    type("password-current", "old-password");
    type("password-new", "new-password");
    type("password-confirm", "new-password");
    fireEvent.click(screen.getByTestId("password-save"));
    await waitFor(() => expect(api.auth.changePassword).toHaveBeenCalledWith("old-password", "new-password"));
    expect(await findToast("Password changed. Signed out 2 other devices.")).toHaveAttribute("data-type", "success");
    ["password-current", "password-new", "password-confirm"].forEach((id) => expect(screen.getByTestId(id)).toHaveValue(""));
  });

  it("with no other devices, just confirms; a refusal keeps what was typed", async () => {
    api.auth.changePassword.mockResolvedValueOnce({ ok: true, sessions_revoked: 0 });
    renderPage();
    const fill = () => { type("password-current", "old-password"); type("password-new", "new-password"); type("password-confirm", "new-password"); };
    fill();
    fireEvent.click(screen.getByTestId("password-save"));
    expect(await findToast("تم تغيير كلمة المرور")).toBeInTheDocument();

    api.auth.changePassword.mockRejectedValueOnce(new Error("Current password is incorrect"));
    fill();
    fireEvent.click(screen.getByTestId("password-save"));
    expect(await findToast("كلمة المرور الحالية غير صحيحة")).toHaveAttribute("data-type", "error");
    expect(screen.getByTestId("password-new")).toHaveValue("new-password");
  });

  it("password fields are real password inputs with the right autocomplete hints", () => {
    renderPage();
    expect(screen.getByTestId("password-current")).toHaveAttribute("type", "password");
    expect(screen.getByTestId("password-current")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByTestId("password-new")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("تأكيد كلمة المرور الجديدة")).toHaveAttribute("type", "password");
  });
});

describe("header link", () => {
  it("the user's name in the header opens the profile, and is marked current there", () => {
    const { unmount } = renderPage({ path: "/", ui: <Header /> });
    const link = screen.getByTestId("profile-link");
    expect(link).toHaveAttribute("href", "/profile");
    expect(link).toHaveTextContent("Rami Haddad");
    expect(link).toHaveAttribute("title", "ملفي الشخصي");
    expect(link).not.toHaveAttribute("aria-current");
    unmount();
    renderPage({ path: "/profile", ui: <Header /> });
    expect(screen.getByTestId("profile-link")).toHaveAttribute("aria-current", "page");
  });
});
