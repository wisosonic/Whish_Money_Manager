/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "@/pages/UsersPage";
import AppToaster from "@/components/layout/AppToaster";
import { clearToasts, findToast } from "./toastHelpers";
import { api } from "@/api/apiClient";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/apiClient", () => ({
  api: { users: { list: vi.fn(), create: vi.fn(), update: vi.fn() }, roles: { list: vi.fn() } },
}));

const roles = DEFAULT_ROLES.map((r, i) => ({ id: i + 1, name: r.name, label: r.label, description: r.description, permissions: r.permissions }));
const people = [
  { id: 1, email: "admin@test.local", full_name: "Admin Person", role: "admin", is_active: true, last_login: "2026-09-24T08:00:00Z" },
  { id: 5, email: "cashier@test.local", full_name: "Cashier", role: "user", is_active: true, last_login: null },
  { id: 6, email: "old@test.local", full_name: "Former", role: "user", is_active: false, last_login: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  setAuthRole("admin"); // id 1 → "(أنت)"
  api.users.list.mockResolvedValue(people);
  api.roles.list.mockResolvedValue(roles);
  api.users.update.mockResolvedValue({});
  api.users.create.mockResolvedValue({ id: 9, email: "new@test.local" });
});
afterEach(() => {
  cleanup();
  clearToasts();
});

const renderPage = async () => {
  render(<MemoryRouter><UsersPage /><AppToaster /></MemoryRouter>);
  await screen.findByTestId("user-row-cashier@test.local");
};
const row = (email) => screen.getByTestId(`user-row-${email}`);

describe("UsersPage", () => {
  it("lists users with role, status and last login, and the three roles", async () => {
    await renderPage();
    expect(screen.getByText("3 مستخدم")).toBeInTheDocument();
    expect(within(row("admin@test.local")).getByText("(أنت)")).toBeInTheDocument();
    expect(within(row("cashier@test.local")).getByLabelText("دور cashier@test.local")).toHaveValue("user");
    expect(within(row("old@test.local")).getByText("معطّل")).toBeInTheDocument();
    ["مسؤول", "مدير", "مستخدم"].forEach((label) => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
  });

  it("changes a user's role", async () => {
    await renderPage();
    fireEvent.change(within(row("cashier@test.local")).getByLabelText("دور cashier@test.local"), { target: { value: "manager" } });
    await waitFor(() => expect(api.users.update).toHaveBeenCalledWith(5, { role: "manager" }));
    expect(await findToast("تم تغيير دور cashier@test.local")).toHaveAttribute("data-type", "success");
  });

  it("deactivates and reactivates users, but offers no deactivate button on your own row", async () => {
    await renderPage();
    expect(within(row("admin@test.local")).queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument();
    fireEvent.click(within(row("cashier@test.local")).getByRole("button", { name: "تعطيل" }));
    await waitFor(() => expect(api.users.update).toHaveBeenCalledWith(5, { is_active: false }));
    fireEvent.click(within(row("old@test.local")).getByRole("button", { name: "تفعيل" }));
    await waitFor(() => expect(api.users.update).toHaveBeenCalledWith(6, { is_active: true }));
  });

  it("shows the server's refusal (e.g. last Admin)", async () => {
    api.users.update.mockRejectedValue(new Error("At least one active Admin is required"));
    await renderPage();
    fireEvent.change(within(row("admin@test.local")).getByLabelText("دور admin@test.local"), { target: { value: "user" } });
    // Translated API message, as an error notification.
    expect(await findToast("يجب أن يبقى مسؤول نشط واحد على الأقل")).toHaveAttribute("data-type", "error");
  });

  it("adds a user", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /إضافة مستخدم/ }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مستخدم" });
    fireEvent.change(within(dialog).getByLabelText("الاسم"), { target: { value: "New Person" } });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني"), { target: { value: "new@test.local" } });
    fireEvent.change(within(dialog).getByLabelText("الدور"), { target: { value: "manager" } });
    fireEvent.change(within(dialog).getByLabelText(/كلمة المرور/), { target: { value: "long-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    await waitFor(() => expect(api.users.create).toHaveBeenCalledWith({ full_name: "New Person", email: "new@test.local", role: "manager", password: "long-password" }));
    expect(await findToast("تمت إضافة new@test.local")).toHaveAttribute("data-type", "success");
    expect(api.users.list).toHaveBeenCalledTimes(2); // reloaded
  });

  it("blocks a short password before calling the server, and shows server errors", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /إضافة مستخدم/ }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مستخدم" });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني"), { target: { value: "x@test.local" } });
    fireEvent.change(within(dialog).getByLabelText(/كلمة المرور/), { target: { value: "short" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("8 أحرف على الأقل");
    expect(api.users.create).not.toHaveBeenCalled();

    api.users.create.mockRejectedValue(new Error("A user with this email already exists"));
    fireEvent.change(within(dialog).getByLabelText(/كلمة المرور/), { target: { value: "long-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    expect(await within(dialog).findByText("يوجد مستخدم بهذا البريد الإلكتروني")).toBeInTheDocument();
    // Shown next to the form, and as an error notification.
    expect(await findToast("يوجد مستخدم بهذا البريد الإلكتروني")).toHaveAttribute("data-type", "error");
  });

  it("resets a password and says the user was signed out everywhere", async () => {
    await renderPage();
    fireEvent.click(within(row("cashier@test.local")).getByRole("button", { name: /كلمة المرور/ }));
    const dialog = screen.getByRole("dialog", { name: "كلمة مرور جديدة لـ cashier@test.local" });
    fireEvent.change(within(dialog).getByLabelText("كلمة المرور الجديدة"), { target: { value: "new-long-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(api.users.update).toHaveBeenCalledWith(5, { password: "new-long-password" }));
    expect(await findToast(/وتسجيل خروجه من كل الأجهزة/)).toHaveAttribute("data-type", "success");
  });
});
