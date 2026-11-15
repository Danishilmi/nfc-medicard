import { supabase } from "./supabase.js";
import { malaysiaNow, addDays } from "./time.js";
import { sendPush, PUSHED_TYPES } from "./push.js";

// In-app notifications (the bell). Each row belongs to one user and stores
// what happened as `type` + `data`; the app turns that into text in the
// reader's language. A notification must never break the action that caused
// it, so errors are logged and swallowed.
//
// `ref` is for reminders that must only be created once (e.g. "appointment
// tomorrow"): a second notify with the same user + ref is ignored.
export async function notify(userIds, type, data = {}, link = null, ref = null) {
  try {
    const ids = [...new Set([].concat(userIds).filter(Boolean))];
    if (!ids.length) return;
    const rows = ids.map((id) => ({ user_id: id, type, data, link, ref }));
    const { data: created, error } = ref
      ? await supabase.from("notifications").upsert(rows, { onConflict: "user_id,ref", ignoreDuplicates: true }).select("user_id")
      : await supabase.from("notifications").insert(rows).select("user_id");
    if (error) return console.error("Failed to create notification:", error.message);
    // also to their phones (only rows actually created, so a reminder is never pushed twice)
    const to = (created || []).map((r) => r.user_id);
    if (to.length && PUSHED_TYPES.has(type)) await sendPush(to, type, data, link);
  } catch (err) {
    console.error("Failed to create notification:", err.message);
  }
}

export async function adminIds() {
  const { data } = await supabase.from("profiles").select("id").eq("role", "admin");
  return (data || []).map((p) => p.id);
}

// Doctors who have written in this patient's history (their care team).
export async function careTeamIds(patientId) {
  const { data } = await supabase.from("medical_history").select("physician_id").eq("patient_id", patientId);
  return [...new Set((data || []).map((r) => r.physician_id).filter(Boolean))];
}

export async function patientName(patientId) {
  const { data } = await supabase.from("patients").select("name").eq("id", patientId).maybeSingle();
  return data?.name || "";
}

// Reminders depend on the clock rather than on an action, and the free Render
// server sleeps when idle, so instead of a timer they are created when the
// user next opens the app (their bell asks for notifications). At most once
// every 5 minutes per user.
const lastChecked = new Map();

export async function createDueReminders(user) {
  const last = lastChecked.get(user.uid) || 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  lastChecked.set(user.uid, Date.now());
  try {
    const now = malaysiaNow();
    const tomorrow = addDays(now.date, 1);
    const inAnHour = malaysiaNow(new Date(Date.now() + 60 * 60 * 1000)).time;

    if (user.role === "patient") {
      const { data: appts } = await supabase
        .from("appointments")
        .select("id, date, start_time, doctor_name")
        .eq("patient_id", user.uid)
        .gte("date", now.date)
        .lte("date", tomorrow);
      for (const a of appts || []) {
        const time = a.start_time ? a.start_time.slice(0, 5) : null;
        const data = { doctor: a.doctor_name, date: a.date, time };
        if (a.date === tomorrow) {
          await notify(user.uid, "appointment.reminder", { ...data, when: "tomorrow" }, "/patient/appointments", `appt-day:${a.id}`);
        } else if (time && time >= now.time && time <= inAnHour) {
          await notify(user.uid, "appointment.reminder", { ...data, when: "soon" }, "/patient/appointments", `appt-hour:${a.id}`);
        }
      }

      const { data: meds } = await supabase
        .from("medications")
        .select("id, name, end_date, renewal_frequency")
        .eq("patient_id", user.uid)
        .neq("renewal_frequency", "none")
        .lte("end_date", addDays(now.date, 3));
      for (const m of meds || []) {
        if (!m.end_date) continue;
        const due = m.end_date <= now.date;
        await notify(user.uid, "medication.due", { name: m.name, endDate: m.end_date, when: due ? "now" : "soon" },
          "/patient/medications", `${due ? "med-due" : "med-soon"}:${m.id}:${m.end_date}`);
      }
    }

    if (user.role === "doctor") {
      const { count } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("doctor_id", user.uid)
        .eq("date", now.date);
      if (count > 0) {
        await notify(user.uid, "appointments.today", { count }, "/doctor/appointments", `daily:${now.date}`);
      }
    }
  } catch (err) {
    console.error("Failed to create reminders:", err.message);
  }
}

// For tests: forget when each user was last checked.
export function resetReminderThrottle() {
  lastChecked.clear();
}
