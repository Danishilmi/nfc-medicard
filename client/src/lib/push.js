import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import api from "./api.js";

// Phone push notifications (Android app only), through Firebase. Switched on
// at build time with VITE_ENABLE_PUSH=true, once android/app/google-services.json
// is in place: without that file, asking Firebase for a token would crash the app.
const enabled = Capacitor.isNativePlatform() && import.meta.env.VITE_ENABLE_PUSH === "true";

let token = null;
let lang = "en";
let onOpen = null;
let listening = false;

function sendToken() {
  if (token) api.post("/notifications/devices", { token, platform: "android", lang }).catch(() => {});
}

// After login (and when the language changes): ask permission once, then
// register this phone with the server in the current language.
export async function startPush({ language, openLink }) {
  if (!enabled) return;
  lang = language;
  onOpen = openLink;
  try {
    if (!listening) {
      listening = true;
      // "your turn" gets its own loud, heads-up channel; everything else is normal
      await PushNotifications.createChannel({ id: "turn", name: "Your turn", description: "When it's your turn to go in", importance: 5, visibility: 1, vibration: true });
      await PushNotifications.createChannel({ id: "general", name: "Notifications", description: "Messages, results and appointments", importance: 4, visibility: 1, vibration: true });
      await PushNotifications.addListener("registration", (t) => {
        token = t.value;
        sendToken();
      });
      await PushNotifications.addListener("registrationError", (e) => console.warn("Push registration failed:", e.error));
      // tapping a push opens the right page
      await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
        const link = a.notification?.data?.link;
        if (link) onOpen?.(link);
      });
    }
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    if (token) sendToken();
    else await PushNotifications.register();
  } catch (err) {
    console.warn("Push notifications unavailable:", err?.message || err);
  }
}

// Before logout: stop pushing to this phone (it may be shared).
export async function stopPush() {
  if (!enabled || !token) return;
  await api.post("/notifications/devices/remove", { token }).catch(() => {});
}
