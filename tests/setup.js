import "@testing-library/jest-dom/vitest";

// jsdom has no matchMedia (used by useIsMobile and the chart's reduced-motion check).
// Tests that need a specific answer replace window.matchMedia themselves.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
  });
}

// jsdom has no ResizeObserver (Recharts' ResponsiveContainer uses it; every supported browser has it).
if (typeof window !== "undefined" && typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement Blob.prototype.text() (every supported browser does), and the
// import flow uses it to sniff the %PDF- signature and to read CSV files.
if (typeof Blob !== "undefined" && typeof Blob.prototype.text !== "function" && typeof FileReader !== "undefined") {
  Blob.prototype.text = function text() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// The app remembers things in cookies (src/lib/cookies.js), and jsdom keeps them for the whole test
// file: clear them after every test so one test's remembered day, store or settings can't leak into
// the next. (Tests that need a cookie set it themselves.)
import { afterEach } from "vitest";
afterEach(() => {
  if (typeof document === "undefined") return;
  document.cookie.split(";").map((part) => part.split("=")[0].trim()).filter(Boolean)
    .forEach((name) => { document.cookie = `${name}=; Path=/; Max-Age=0`; });
});
