export const normalizeSearchText = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Search every field the table shows: the receiver column often displays customer_number
// (receiver_name is empty for imported phone transfers), so phone/customer_number/service
// must be searched too. Phone numbers match regardless of spaces, "+", dashes or a leading 0,
// and amounts match typed as "50", "50.00" or "$1,500".
const isPhoneLike = (value) => /^\+?\d{7,}$/.test(String(value ?? "").trim());

// The receiver as the transactions table shows it: the name, or the customer number when the
// receiver was stored as a phone (imported phone transfers have an empty receiver_name).
export const receiverDisplay = (t) => {
  const name = String(t.receiver_name ?? "").trim();
  const customerNumber = String(t.customer_number ?? "").trim();
  if (name && !isPhoneLike(name)) return name;
  return customerNumber || name || String(t.phone ?? "").trim();
};

// Receiver report matching: the receiver name, or — only when the receiver was stored as a phone,
// as in the table's receiver column — its phone / customer number in any format. (On e.g. a cash-in
// from "NAME - 961…", phone/customer_number belong to the sender, not the receiver.)
export const matchesReceiver = (t, query) => {
  const term = normalizeSearchText(query);
  if (!term) return false;

  const name = String(t.receiver_name ?? "").trim();
  const textFields = name && !isPhoneLike(name) ? [name] : [name, t.phone, t.customer_number];
  if (textFields.some((field) => normalizeSearchText(field).includes(term))) return true;

  if (/^[\d\s+\-().]+$/.test(term)) {
    const digits = term.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 3) {
      return textFields.some((field) => String(field ?? "").replace(/\D/g, "").includes(digits));
    }
  }
  return false;
};

export const matchesSearch = (t, search) => {
  const term = normalizeSearchText(search);
  if (!term) return true;

  const textFields = [t.sender_name, t.receiver_name, t.reference_number, t.note, t.service, t.phone, t.customer_number];
  if (textFields.some((field) => normalizeSearchText(field).includes(term))) return true;

  if (/^[\d\s+\-().]+$/.test(term)) {
    const digits = term.replace(/\D/g, "").replace(/^0+/, "");
    if (digits.length >= 3) {
      const numberFields = [t.phone, t.customer_number, t.receiver_name, t.sender_name];
      if (numberFields.some((field) => String(field ?? "").replace(/\D/g, "").includes(digits))) return true;
    }
  }

  const amountTerm = term.replace(/[$,\s]/g, "");
  if (/^\d+(\.\d+)?$/.test(amountTerm) && Number(t.amount) === Number(amountTerm)) return true;

  return false;
};
