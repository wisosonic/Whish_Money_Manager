import { describe, expect, it } from "vitest";
import { matchesReceiver, matchesSearch, normalizeSearchText, receiverDisplay } from "@/lib/transactionSearch";

// Shapes taken from real stored rows: imported phone transfers have an empty receiver_name
// and the number in phone/customer_number (which the table shows in the receiver column).
const phoneTransfer = {
  type: "cash_out",
  sender_name: "Vicario",
  receiver_name: "",
  phone: "+96171389296",
  customer_number: "71389296",
  service: "W2W",
  note: "",
  reference_number: "tr:427834925",
  amount: 1500,
};
const namedCredit = {
  type: "cash_in",
  sender_name: "MOUNIR TOSKA",
  receiver_name: "Vicario",
  phone: "96171588017",
  customer_number: "71588017",
  service: "",
  note: "paid in cash",
  reference_number: "tr:626203096",
  amount: 50,
};

describe("normalizeSearchText", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalizeSearchText("  QR   TOPUP ")).toBe("qr topup");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(42)).toBe("42");
  });
});

describe("matchesSearch", () => {
  it("matches everything for an empty or blank search", () => {
    expect(matchesSearch(phoneTransfer, "")).toBe(true);
    expect(matchesSearch(phoneTransfer, "   ")).toBe(true);
  });

  it("matches names, reference and note case-insensitively", () => {
    expect(matchesSearch(namedCredit, "mounir")).toBe(true);
    expect(matchesSearch(namedCredit, "  Toska ")).toBe(true);
    expect(matchesSearch(namedCredit, "626203096")).toBe(true);
    expect(matchesSearch(namedCredit, "IN CASH")).toBe(true);
  });

  it("matches the customer number shown in the receiver column", () => {
    expect(matchesSearch(phoneTransfer, "71389296")).toBe(true);
  });

  it("matches phone numbers however they are typed", () => {
    expect(matchesSearch(phoneTransfer, "+961 71 389 296")).toBe(true);
    expect(matchesSearch(phoneTransfer, "71-389-296")).toBe(true);
    expect(matchesSearch(phoneTransfer, "071389296")).toBe(true);
    expect(matchesSearch(namedCredit, "(961) 71588017")).toBe(true);
  });

  it("matches the service", () => {
    expect(matchesSearch(phoneTransfer, "w2w")).toBe(true);
  });

  it("matches the amount written with or without $, commas and decimals", () => {
    expect(matchesSearch(phoneTransfer, "1500")).toBe(true);
    expect(matchesSearch(phoneTransfer, "$1,500")).toBe(true);
    expect(matchesSearch(phoneTransfer, "1,500.00")).toBe(true);
    expect(matchesSearch(namedCredit, "50.00")).toBe(true);
  });

  it("does not match unrelated text or amounts", () => {
    expect(matchesSearch(phoneTransfer, "mounir")).toBe(false);
    expect(matchesSearch(namedCredit, "$51")).toBe(false);
    expect(matchesSearch(namedCredit, "xyz")).toBe(false);
  });

  it("tolerates missing fields", () => {
    expect(matchesSearch({ amount: 10 }, "10")).toBe(true);
    expect(matchesSearch({}, "abc")).toBe(false);
  });
});

describe("receiverDisplay", () => {
  it("shows the receiver name when there is one", () => {
    expect(receiverDisplay(namedCredit)).toBe("Vicario");
    expect(receiverDisplay({ receiver_name: "ALI", customer_number: "70000000" })).toBe("ALI");
  });

  it("shows the customer number when the receiver was stored as a phone", () => {
    expect(receiverDisplay(phoneTransfer)).toBe("71389296");
    expect(receiverDisplay({ receiver_name: "+9613915112", customer_number: "3915112" })).toBe("3915112");
    expect(receiverDisplay({ receiver_name: "+9613915112" })).toBe("+9613915112");
    expect(receiverDisplay({ phone: "+96170000000" })).toBe("+96170000000");
    expect(receiverDisplay({})).toBe("");
  });
});

describe("matchesReceiver", () => {
  it("never matches an empty query", () => {
    expect(matchesReceiver(namedCredit, "")).toBe(false);
    expect(matchesReceiver(namedCredit, "  ")).toBe(false);
  });

  it("matches the receiver name, case-insensitively", () => {
    expect(matchesReceiver(namedCredit, "vicario")).toBe(true);
    expect(matchesReceiver({ receiver_name: "Salam  Issa" }, " salam issa ")).toBe(true);
  });

  it("does not match the sender", () => {
    expect(matchesReceiver(namedCredit, "mounir")).toBe(false);
    expect(matchesReceiver(phoneTransfer, "vicario")).toBe(false);
  });

  it("matches a receiver stored as a phone by its number in any format", () => {
    expect(matchesReceiver(phoneTransfer, "71389296")).toBe(true);
    expect(matchesReceiver(phoneTransfer, "+961 71 389 296")).toBe(true);
    expect(matchesReceiver(phoneTransfer, "071389296")).toBe(true);
    expect(matchesReceiver({ receiver_name: "+9613915112" }, "3915112")).toBe(true);
  });

  it("ignores phone/customer_number that belong to the sender (named receiver)", () => {
    // Cash-in from "MOUNIR TOSKA - 96171588017": the number is the sender's.
    expect(matchesReceiver(namedCredit, "71588017")).toBe(false);
  });
});
