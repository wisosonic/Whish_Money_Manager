import { useEffect, useState } from "react";
import { api } from "@/api/apiClient";

// The dashboard's sender / receiver report, asked of the server (every day, not just what the page
// loaded): { rows (at most 10,000), totals (over every match), total, truncated, loading }.
// Waits for a short pause in typing, and ignores an answer that arrives after the query changed.
const TYPING_PAUSE_MS = 250;
const EMPTY = { rows: [], totals: { count: 0, deposits: 0, withdrawals: 0, commissions: 0 }, total: 0, truncated: false };

export const usePartyReport = ({ party, query, from, to, storeId }) => {
  const [result, setResult] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = String(query ?? "").trim();
    if (!q) {
      setResult(EMPTY);
      setLoading(false);
      return undefined;
    }
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api.dashboard.party({ party, q, from, to, storeId })
        .then((answer) => { if (current) setResult({ rows: answer.transactions, totals: answer.totals, total: answer.total, truncated: answer.truncated }); })
        .catch(() => { if (current) setResult(EMPTY); })
        .finally(() => { if (current) setLoading(false); });
    }, TYPING_PAUSE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [party, query, from, to, storeId]);
  return { ...result, loading };
};
