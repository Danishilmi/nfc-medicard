import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellRing, CheckCheck } from "lucide-react";
import api from "../lib/api.js";
import { useNotifications, canAskForPopups } from "../context/NotificationsContext.jsx";
import { describeNotification, timeAgo } from "../lib/notificationText.js";
import { t } from "../i18n/index.js";

const TONES = {
  info: "bg-brand-50 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200",
  warn: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  alert: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300",
};

// The bell and its panel. `variant` "bar" sits in the phone's top bar (the
// panel then spans the screen width); "side" sits in the sidebar footer and
// opens upwards, lined up with `align`.
export default function NotificationBell({ variant = "side", align = "start", className = "" }) {
  const navigate = useNavigate();
  const { count, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [askPopups, setAskPopups] = useState(canAskForPopups);
  const rootRef = useRef(null);

  const load = () =>
    api
      .get("/notifications")
      .then((res) => setItems(res.data))
      .catch(() => setItems([]));

  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (ids) => {
    await api.post("/notifications/read", ids ? { ids } : {}).catch(() => {});
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)));
    refresh();
  };

  const openItem = (n) => {
    setOpen(false);
    if (!n.read) markRead([n.id]);
    if (n.link) navigate(n.link);
  };

  const bar = variant === "bar";
  const panelPos = bar
    ? "fixed inset-x-3 top-16 origin-top"
    : `absolute bottom-full mb-2 w-[22rem] ${align === "end" ? "right-0 origin-bottom-right" : "left-0 origin-bottom-left"}`;
  const unread = items?.filter((n) => !n.read).length ?? count;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? t("Notifications ({count} unread)", { count }) : t("Notifications")}
        title={t("Notifications")}
        className={`relative inline-flex items-center justify-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
          bar
            ? "h-10 w-10 rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            : "rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        } ${open ? "text-brand-700 dark:text-brand-300" : ""}`}
      >
        <Bell size={bar ? 18 : 16} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-slate-900">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <div
        role="dialog"
        aria-label={t("Notifications")}
        className={`z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 ring-1 ring-black/5 transition duration-200 ease-out dark:border-slate-700 dark:bg-slate-800 dark:shadow-black/40 ${panelPos} ${
          open ? "visible scale-100 opacity-100" : "invisible scale-95 opacity-0"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Notifications")}</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markRead(null)}
              className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              <CheckCheck size={14} /> {t("Mark all as read")}
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items === null && <p className="px-4 py-6 text-center text-sm text-slate-400">{t("Loading...")}</p>}
          {items?.length === 0 && (
            <div className="flex flex-col items-center px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
              <Bell size={22} className="mb-2" />
              {t("No notifications yet")}
            </div>
          )}
          {items?.map((n) => {
            const d = describeNotification(n);
            const Icon = d.icon;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-700/60 ${
                  n.read ? "" : "bg-brand-50/50 dark:bg-brand-900/20"
                }`}
              >
                <span className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${TONES[d.tone]}`}>
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block break-words text-sm text-slate-800 dark:text-slate-100 ${n.read ? "font-medium" : "font-semibold"}`}>
                    {d.title}
                  </span>
                  {d.body && <span className="block break-words text-xs text-slate-500 dark:text-slate-400">{d.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-slate-400 dark:text-slate-500">{timeAgo(n.createdAt)}</span>
                </span>
                {!n.read && <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-brand-600" aria-label={t("Unread")} />}
              </button>
            );
          })}
        </div>
        {askPopups && (
          <button
            type="button"
            onClick={() => Notification.requestPermission().finally(() => setAskPopups(canAskForPopups()))}
            className="flex items-center justify-center gap-1.5 border-t border-slate-100 px-4 py-2.5 text-xs font-semibold text-brand-700 hover:bg-brand-50 dark:border-slate-700 dark:text-brand-300 dark:hover:bg-slate-700/60"
          >
            <BellRing size={14} /> {t("Turn on pop-up alerts on this device")}
          </button>
        )}
      </div>
    </div>
  );
}
