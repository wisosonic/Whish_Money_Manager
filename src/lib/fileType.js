const CSV_MIME_TYPES = ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"];

// MIME type alone isn't reliable (Windows reports .csv as application/vnd.ms-excel or ""),
// so PDFs are recognised by their "%PDF-" signature and CSVs by extension or MIME type.
export const detectFileType = async (file) => {
  if (!file) return null;
  const signature = await file.slice(0, 5).text();
  if (signature === "%PDF-") return "pdf";
  if (/\.csv$/i.test(file.name) || CSV_MIME_TYPES.includes(file.type)) return "csv";
  return null;
};
