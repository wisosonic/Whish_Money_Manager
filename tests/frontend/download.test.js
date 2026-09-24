/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "@/lib/download";

describe("saveBlob", () => {
  afterEach(() => vi.useRealTimers());

  it("downloads the blob under the given file name, then releases the object URL", () => {
    vi.useFakeTimers();
    URL.createObjectURL = vi.fn(() => "blob:backup");
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
    });

    const blob = new Blob(["id\r\n"], { type: "text/csv" });
    saveBlob(blob, "transactions_2026-09-01_2026-09-30.csv");

    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([{ href: "blob:backup", download: "transactions_2026-09-01_2026-09-30.csv", attached: true }]);
    expect(document.querySelector("a[download]")).toBeNull(); // the temporary link is removed
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:backup");
    click.mockRestore();
  });
});
