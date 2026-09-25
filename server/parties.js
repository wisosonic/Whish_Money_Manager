// Who a transaction's sender / receiver is, as the app shows it. Shared by the transactions table
// (src/lib/transactionSearch.js re-exports these) and the admin reports (server/reports.js).

// A value that is a bare phone number ("96171588017", "+96171…").
export const isPhoneLike = (value) => /^\+?\d{7,}$/.test(String(value ?? "").trim());

// The receiver as the transactions table shows it: the name, or the customer number when the
// receiver was stored as a phone (imported phone transfers have an empty receiver_name).
export const receiverDisplay = (t) => {
  const name = String(t.receiver_name ?? "").trim();
  const customerNumber = String(t.customer_number ?? "").trim();
  if (name && !isPhoneLike(name)) return name;
  return customerNumber || name || String(t.phone ?? "").trim();
};

// The same rule for the sender. Only meaningful where the phone belongs to the sender (a cash-in
// from "NAME - 961…"); on a cash-out the phone / customer number are the receiver's.
export const senderDisplay = (t) => {
  const name = String(t.sender_name ?? "").trim();
  const customerNumber = String(t.customer_number ?? "").trim();
  if (name && !isPhoneLike(name)) return name;
  return customerNumber || name || String(t.phone ?? "").trim();
};

// A phone number in one comparable form: digits only, without 00 / 961 / a leading 0
// ("+961 71 588 017", "0096171588017" and "71588017" are the same wallet).
export const normalizePhone = (value) => {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("961") && digits.length > 9) digits = digits.slice(3);
  return digits.replace(/^0+/, "");
};
