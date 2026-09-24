import { describe, expect, it } from "vitest";
import { detectFileType } from "@/lib/fileType";

describe("detectFileType", () => {
  it("detects a PDF by its %PDF- signature, whatever its name or MIME type", async () => {
    expect(await detectFileType(new File(["%PDF-1.7 ..."], "statement.pdf", { type: "application/pdf" }))).toBe("pdf");
    expect(await detectFileType(new File(["%PDF-1.4 ..."], "download", { type: "" }))).toBe("pdf");
  });

  it("detects a CSV by extension or by the MIME types browsers report for it", async () => {
    const csv = "statement_id,line_no\n";
    expect(await detectFileType(new File([csv], "AccountStatement.CSV", { type: "" }))).toBe("csv");
    // Windows + Excel installed reports .csv files as application/vnd.ms-excel
    expect(await detectFileType(new File([csv], "export", { type: "application/vnd.ms-excel" }))).toBe("csv");
    expect(await detectFileType(new File([csv], "export", { type: "text/csv" }))).toBe("csv");
  });

  it("rejects other files and missing input", async () => {
    expect(await detectFileType(new File(["\x89PNG"], "photo.png", { type: "image/png" }))).toBeNull();
    expect(await detectFileType(new File(["fake"], "fake.pdf", { type: "application/pdf" }))).toBeNull();
    expect(await detectFileType(null)).toBeNull();
  });
});
