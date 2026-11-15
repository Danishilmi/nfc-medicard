import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { createDueReminders } from "../lib/notify.js";

const router = Router();

function toJson(row) {
  return {
    id: row.id,
    type: row.type,
    data: row.data || {},
    link: row.link,
    read: row.read,
    createdAt: row.created_at,
  };
}

// The logged-in user's latest 50 notifications, newest first.
router.get("/", requireAuth, async (req, res) => {
  await createDueReminders(req.user);
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", req.user.uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(toJson));
});

// For the red badge on the bell; the app asks every 20 s.
router.get("/unread-count", requireAuth, async (req, res) => {
  await createDueReminders(req.user);
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", req.user.uid)
    .eq("read", false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});

// Mark the given notifications (ids) as read, or all of them when no ids are sent.
// Only ever touches the logged-in user's own notifications.
router.post("/read", requireAuth, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  let query = supabase.from("notifications").update({ read: true }).eq("user_id", req.user.uid).eq("read", false);
  if (ids) query = query.in("id", ids);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
