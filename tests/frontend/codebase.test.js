// Guards for removed code (the unused modals and toast packages stay deleted, the API client keeps
// its new name) and for the bundle split (Recharts and the non-dashboard pages load on demand).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const filesUnder = (dir, pattern) => {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (pattern.test(entry.name)) out.push(full);
  });
  walk(path.join(root, dir));
  return out;
};
const sources = [...filesUnder("src", /\.jsx?$/), ...filesUnder("tests", /\.jsx?$/), ...filesUnder("server", /\.js$/)];

describe("removed and renamed code", () => {
  it.each(["ReviewPDFModal", "InsertTransactionModal"])("%s is deleted and nothing refers to it", (name) => {
    expect(fs.existsSync(path.join(root, "src/components/transactions", `${name}.jsx`))).toBe(false);
    const users = sources.filter((f) => f !== __filename && fs.readFileSync(f, "utf8").includes(name));
    expect(users).toEqual([]);
  });

  it("the API client is src/api/apiClient.js, exported as `api`", async () => {
    expect(fs.existsSync(path.join(root, "src/api/base44Client.js"))).toBe(false);
    const client = await import("@/api/apiClient");
    expect(Object.keys(client.api)).toEqual(expect.arrayContaining(["auth", "entities", "integrations", "users", "roles", "admin"]));
  });

  it("no code uses the old base44 names any more", () => {
    // "base44.com" is allowed (also written base44\.com inside a regex): a branding test checks the
    // old Base44 logo URL is gone.
    const leftovers = sources
      .filter((f) => f !== __filename)
      .filter((f) => /\bbase44(?:Client)?\b(?!\\?\.com)/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(leftovers).toEqual([]);
  });
});

describe("unused packages", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  it.each(["react-hot-toast", "@radix-ui/react-toast"])("%s is uninstalled and not imported (notifications use sonner)", (name) => {
    expect(deps).not.toHaveProperty(name);
    const users = sources.filter((f) => f !== __filename && fs.readFileSync(f, "utf8").includes(`"${name}"`));
    expect(users.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("the shadcn toast files that used them are deleted; sonner is the only notification system", () => {
    ["toast.jsx", "toaster.jsx", "use-toast.jsx"].forEach((file) =>
      expect(fs.existsSync(path.join(root, "src/components/ui", file))).toBe(false));
    expect(deps).toHaveProperty("sonner");
  });
});

describe("browser storage", () => {
  it("the app remembers things in cookies only: no localStorage / sessionStorage writes in src (user's request)", () => {
    const writers = filesUnder("src", /\.jsx?$/)
      .filter((f) => /(?:localStorage|sessionStorage)\.setItem/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f).split(path.sep).join("/"));
    expect(writers).toEqual([]);
  });
});

describe("bundle split", () => {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const relative = (f) => path.relative(root, f).split(path.sep).join("/");
  const appSources = filesUnder("src", /\.jsx?$/);
  // A static `import … from "<target>"` (as opposed to a lazy `import("<target>")`).
  const importsStatically = (source, target) =>
    new RegExp(`^import[^;]*from ["']${target.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["']`, "m").test(source);

  it("only the shared chart imports Recharts (ui/chart.jsx is an unused shadcn file)", () => {
    const users = appSources.filter((f) => /from ["']recharts["']/.test(fs.readFileSync(f, "utf8"))).map(relative);
    expect(users.sort()).toEqual(["src/components/reports/IncomeChart.jsx", "src/components/ui/chart.jsx"]);
    expect(appSources.filter((f) => /components\/ui\/chart["']/.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });

  it("the chart loads on demand: the dashboard window and the income report use lazy(() => import(…))", () => {
    const list = read("src/components/dashboard/TransactionsList.jsx");
    expect(importsStatically(list, "@/components/dashboard/MonthlyChartModal")).toBe(false);
    expect(list).toContain('lazy(() => import("@/components/dashboard/MonthlyChartModal"))');
    const report = read("src/components/reports/IncomeReport.jsx");
    expect(importsStatically(report, "@/components/reports/IncomeChart")).toBe(false);
    expect(report).toContain('lazy(() => import("@/components/reports/IncomeChart"))');
    // Nothing else pulls the chart in statically (the window itself is loaded lazily).
    const staticUsers = appSources
      .filter((f) => path.basename(f) !== "MonthlyChartModal.jsx")
      .filter((f) => ["@/components/reports/IncomeChart", "@/components/dashboard/MonthlyChartModal"]
        .some((target) => importsStatically(fs.readFileSync(f, "utf8"), target)))
      .map(relative);
    expect(staticUsers).toEqual([]);
  });

  it("pages other than the dashboard load on demand, behind a Suspense spinner", () => {
    const app = read("src/App.jsx");
    ["UsersPage", "SettingsPage", "AdminPage", "ProfilePage", "StoresPage"].forEach((page) => {
      expect(importsStatically(app, `./pages/${page}`)).toBe(false);
      expect(app).toContain(`const ${page} = lazy(() => import("./pages/${page}"));`);
    });
    expect(importsStatically(app, "./pages/Dashboard")).toBe(true);
    expect(app).toMatch(/<Suspense fallback={<PageSpinner \/>}>\s*<Routes>/);
  });
});
