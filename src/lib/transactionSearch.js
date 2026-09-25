// The receiver as the table shows it (and the phone check behind it) is shared with the admin
// reports, so both group and label receivers the same way.
import { isPhoneLike, receiverDisplay } from "../../server/parties.js";

export { receiverDisplay };

export const normalizeSearchText = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

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

// Search every field the table shows: the receiver column often displays customer_number
// (receiver_name is empty for imported phone transfers), so phone/customer_number/service
// must be searched too. Phone numbers match regardless of spaces, "+", dashes or a leading 0,
// and amounts match typed as "50", "50.00" or "$1,500".
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
