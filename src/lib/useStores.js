import { useEffect, useState } from "react";
import { api } from "@/api/apiClient";
import { useAuth } from "@/lib/AuthContext";
import { PERMISSIONS } from "@/lib/permissions";

// The stores the signed-in user can choose between. Only the Admin (stores:all) chooses: everyone
// else always works in their own store, which the server applies without being told. With a single
// store there's nothing to choose either (`multiStore` false), and the app behaves as before stores.
export const useStoreList = () => {
  const { can } = useAuth();
  const seesAll = can(PERMISSIONS.STORES_ALL);
  const [stores, setStores] = useState([]);
  const [loaded, setLoaded] = useState(!seesAll);
  useEffect(() => {
    if (!seesAll) return undefined;
    let current = true;
    Promise.resolve()
      .then(() => api.stores.list())
      .then((list) => { if (current) setStores(Array.isArray(list) ? list : []); })
      .catch(() => {}) // without the list: one store assumed; the server still applies the rules
      .finally(() => { if (current) setLoaded(true); });
    return () => { current = false; };
  }, [seesAll]);
  return { stores, loaded, seesAll, multiStore: seesAll && stores.length > 1 };
};

// API arguments with the store added at the end, only when one was picked (see above).
export const withStoreArg = (storeId) => (...args) => (storeId ? [...args, storeId] : args);
