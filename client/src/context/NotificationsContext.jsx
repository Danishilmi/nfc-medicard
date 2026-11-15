import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import api from "../lib/api.js";
import { describeNotification } from "../lib/notificationText.js";
import { t } from "../i18n/index.js";
import logo from "../assets/logo.png";

const NotificationsContext = createContext(null);

const TONES = {
  info: "bg-brand-50 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  alert: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
};

// Browser pop-ups (outside the page) are only possible on the website, and
// only after the person has allowed them once.
export function canAskForPopups() {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "default";
}

// The bell's unread count, checked every 15 s while someone is logged in.
// Anything new also pops up: a card inside the app, and a browser
// notification when the page is in the background and that is allowed.
export function NotificationsProvider({ children }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [popups, setPopups] = useState([]);
  const lastSeen = useRef(null); // newest createdAt already known; null until the first check
  const prevCount = useRef(0);

  const markRead = (id) => api.post("/notifications/read", { ids: [id] }).catch(() => {});

  const dismiss = useCallback((id) => setPopups((list) => list.filter((p) => p.id !== id)), []);

  const open = useCallback(
    (n) => {
      dismiss(n.id);
      markRead(n.id).then(() => setCount((c) => Math.max(0, c - 1)));
      if (n.link) navigate(n.link);
    },
    [dismiss, navigate]
  );

  const showNew = useCallback(
    (fresh) => {
      setPopups((list) => [...fresh.slice(0, 3), ...list].slice(0, 3));
      fresh.slice(0, 3).forEach((n) => {
        setTimeout(() => dismiss(n.id), 7000);
        if ("Notification" in window && Notification.permission === "granted" && document.visibilityState === "hidden") {
          const d = describeNotification(n);
          const sys = new Notification(d.title, { body: d.body, icon: logo, tag: n.id });
          sys.onclick = () => {
            window.focus();
            open(n);
            sys.close();
          };
        }
      });
    },
    [dismiss, open]
  );

  const refresh = useCallback(async () => {
    if (!profile) return;
    try {
      const { data } = await api.get("/notifications/unread-count");
      const first = lastSeen.current === null;
      if (first || data.count > prevCount.current) {
        const { data: list } = await api.get("/notifications");
        const newest = list[0]?.createdAt || "";
        if (!first) showNew(list.filter((n) => !n.read && n.createdAt > lastSeen.current));
        if (first || newest > lastSeen.current) lastSeen.current = newest;
      }
      prevCount.current = data.count;
      setCount(data.count);
    } catch {
      // offline or logged out: try again on the next tick
    }
  }, [profile, showNew]);

  useEffect(() => {
    lastSeen.current = null;
    prevCount.current = 0;
    setPopups([]);
    if (!profile) {
      setCount(0);
      return;
    }
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [profile]);

  return (
    <NotificationsContext.Provider value={{ count, refresh }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end">
        {popups.map((n) => {
          const d = describeNotification(n);
          const Icon = d.icon;
          return (
            <div
              key={n.id}
              className="pointer-events-auto flex w-full max-w-sm animate-fade-in items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/15 dark:border-slate-700 dark:bg-slate-800"
            >
              <button type="button" onClick={() => open(n)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${TONES[d.tone]}`}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{d.title}</span>
                  {d.body && <span className="block break-words text-xs text-slate-500 dark:text-slate-400">{d.body}</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label={t("Close")}
                className="flex-shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
