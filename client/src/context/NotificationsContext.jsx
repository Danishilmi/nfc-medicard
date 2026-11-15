import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import api from "../lib/api.js";

const NotificationsContext = createContext(null);

// The bell's unread count, checked every 20 s while someone is logged in.
export function NotificationsProvider({ children }) {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!profile) return;
    api
      .get("/notifications/unread-count")
      .then((res) => setCount(res.data.count))
      .catch(() => {});
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setCount(0);
      return;
    }
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => clearInterval(interval);
  }, [profile, refresh]);

  return <NotificationsContext.Provider value={{ count, refresh }}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
