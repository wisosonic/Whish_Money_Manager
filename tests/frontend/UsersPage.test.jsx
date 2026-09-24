/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UsersPage from "@/pages/UsersPage";
import { base44 } from "@/api/base44Client";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { setAuthRole } from "./authMock";

vi.mock("@/lib/AuthContext", async () => (await import("./authMock")).authContextMock);
vi.mock("@/api/base44Client", () => ({
  base44: { users: { list: vi.fn(), create: vi.fn(), update: vi.fn() }, roles: { list: vi.fn() } },
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
  base44.users.list.mockResolvedValue(people);
  base44.roles.list.mockResolvedValue(roles);
  base44.users.update.mockResolvedValue({});
  base44.users.create.mockResolvedValue({ id: 9, email: "new@test.local" });
});
afterEach(cleanup);

const renderPage = async () => {
  render(<MemoryRouter><UsersPage /></MemoryRouter>);
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
    await waitFor(() => expect(base44.users.update).toHaveBeenCalledWith(5, { role: "manager" }));
    expect(await screen.findByText("تم تغيير دور cashier@test.local")).toBeInTheDocument();
  });

  it("deactivates and reactivates users, but offers no deactivate button on your own row", async () => {
    await renderPage();
    expect(within(row("admin@test.local")).queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument();
    fireEvent.click(within(row("cashier@test.local")).getByRole("button", { name: "تعطيل" }));
    await waitFor(() => expect(base44.users.update).toHaveBeenCalledWith(5, { is_active: false }));
    fireEvent.click(within(row("old@test.local")).getByRole("button", { name: "تفعيل" }));
    await waitFor(() => expect(base44.users.update).toHaveBeenCalledWith(6, { is_active: true }));
  });

  it("shows the server's refusal (e.g. last Admin)", async () => {
    base44.users.update.mockRejectedValue(new Error("At least one active Admin is required"));
    await renderPage();
    fireEvent.change(within(row("admin@test.local")).getByLabelText("دور admin@test.local"), { target: { value: "user" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("يجب أن يبقى مسؤول نشط واحد على الأقل"); // translated API message
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

    await waitFor(() => expect(base44.users.create).toHaveBeenCalledWith({ full_name: "New Person", email: "new@test.local", role: "manager", password: "long-password" }));
    expect(await screen.findByText("تمت إضافة new@test.local")).toBeInTheDocument();
    expect(base44.users.list).toHaveBeenCalledTimes(2); // reloaded
  });

  it("blocks a short password before calling the server, and shows server errors", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /إضافة مستخدم/ }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مستخدم" });
    fireEvent.change(within(dialog).getByLabelText("البريد الإلكتروني"), { target: { value: "x@test.local" } });
    fireEvent.change(within(dialog).getByLabelText(/كلمة المرور/), { target: { value: "short" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("8 أحرف على الأقل");
    expect(base44.users.create).not.toHaveBeenCalled();

    base44.users.create.mockRejectedValue(new Error("A user with this email already exists"));
    fireEvent.change(within(dialog).getByLabelText(/كلمة المرور/), { target: { value: "long-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    expect(await within(dialog).findByText("يوجد مستخدم بهذا البريد الإلكتروني")).toBeInTheDocument();
  });

  it("resets a password and says the user was signed out everywhere", async () => {
    await renderPage();
    fireEvent.click(within(row("cashier@test.local")).getByRole("button", { name: /كلمة المرور/ }));
    const dialog = screen.getByRole("dialog", { name: "كلمة مرور جديدة لـ cashier@test.local" });
    fireEvent.change(within(dialog).getByLabelText("كلمة المرور الجديدة"), { target: { value: "new-long-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(base44.users.update).toHaveBeenCalledWith(5, { password: "new-long-password" }));
    expect(await screen.findByText(/وتسجيل خروجه من كل الأجهزة/)).toBeInTheDocument();
  });
});
