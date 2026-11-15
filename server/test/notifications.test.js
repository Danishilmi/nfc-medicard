import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createSupabaseMock, chain } from "./mocks/supabaseMock.js";

const mockSupabase = createSupabaseMock();

vi.mock("../src/lib/supabase.js", () => ({
  supabase: mockSupabase,
}));

const DOCTOR = { uid: "doctor1", role: "doctor", name: "Dr. Sarah Jenkins", email: "doctor@medicard.dev" };
const PATIENT = { uid: "p1", role: "patient", name: "Ahmad Faiz", email: "patient@medicard.dev" };
let currentUser = PATIENT;

vi.mock("../src/middleware/auth.js", async () => {
  const actual = await vi.importActual("../src/middleware/auth.js");
  return {
    ...actual,
    requireAuth: (req, _res, next) => {
      req.user = currentUser;
      next();
    },
  };
});

const { default: notificationsRouter } = await import("../src/routes/notifications.js");
const { default: nfcRouter } = await import("../src/routes/nfc.js");
const { resetReminderThrottle } = await import("../src/lib/notify.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/nfc", nfcRouter);
  return app;
}

// Answer each table with its own result, and keep every query made so tests
// can check what was written.
function tables(results) {
  const made = [];
  mockSupabase.from.mockImplementation((table) => {
    const q = chain(results[table] ?? { data: null, error: null });
    made.push({ table, q });
    return q;
  });
  return (table) => made.filter((m) => m.table === table).map((m) => m.q);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.from.mockReset();
  resetReminderThrottle();
  currentUser = PATIENT;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/notifications", () => {
  it("returns only the logged-in user's notifications, newest first", async () => {
    const q = tables({
      notifications: { data: [{ id: "n1", type: "lab.new", data: { test: "Lipid profile" }, link: "/patient/labs", read: false, created_at: "2026-11-15T01:00:00Z" }], error: null },
      appointments: { data: [], error: null },
      medications: { data: [], error: null },
    });

    const res = await request(buildApp()).get("/api/notifications");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "n1", type: "lab.new", data: { test: "Lipid profile" }, link: "/patient/labs", read: false, createdAt: "2026-11-15T01:00:00Z" }]);
    const list = q("notifications").at(-1);
    expect(list.eq).toHaveBeenCalledWith("user_id", "p1");
  });

  it("creates a one-time reminder for an appointment tomorrow (Malaysian time)", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-15T04:00:00Z"), toFake: ["Date"] }); // 12:00 noon in Malaysia
    const q = tables({
      appointments: { data: [{ id: "a1", date: "2026-11-16", start_time: "15:30:00", doctor_name: "Dr. Sarah Jenkins" }], error: null },
      medications: { data: [], error: null },
      notifications: { data: [], error: null },
    });

    await request(buildApp()).get("/api/notifications");

    const reminder = q("notifications").find((n) => n.upsert.mock.calls.length);
    expect(reminder.upsert).toHaveBeenCalledWith(
      [{ user_id: "p1", type: "appointment.reminder", data: { doctor: "Dr. Sarah Jenkins", date: "2026-11-16", time: "15:30", when: "tomorrow" }, link: "/patient/appointments", ref: "appt-day:a1" }],
      { onConflict: "user_id,ref", ignoreDuplicates: true },
    );
  });

  it("warns about a medication that runs out within 3 days", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-15T04:00:00Z"), toFake: ["Date"] });
    const q = tables({
      appointments: { data: [], error: null },
      medications: { data: [{ id: "m1", name: "Metformin", end_date: "2026-11-17", renewal_frequency: "monthly" }], error: null },
      notifications: { data: [], error: null },
    });

    await request(buildApp()).get("/api/notifications");

    const reminder = q("notifications").find((n) => n.upsert.mock.calls.length);
    expect(reminder.upsert.mock.calls[0][0][0]).toMatchObject({ type: "medication.due", data: { name: "Metformin", when: "soon" }, ref: "med-soon:m1:2026-11-17" });
  });

  it("gives a doctor a summary of today's appointments", async () => {
    currentUser = DOCTOR;
    vi.useFakeTimers({ now: new Date("2026-11-15T00:30:00Z"), toFake: ["Date"] });
    const q = tables({ appointments: { data: null, count: 4, error: null }, notifications: { data: [], error: null } });

    await request(buildApp()).get("/api/notifications");

    const reminder = q("notifications").find((n) => n.upsert.mock.calls.length);
    expect(reminder.upsert.mock.calls[0][0][0]).toMatchObject({ user_id: "doctor1", type: "appointments.today", data: { count: 4 }, ref: "daily:2026-11-15" });
  });
});

describe("POST /api/notifications/read", () => {
  it("marks only the logged-in user's chosen notifications as read", async () => {
    const q = tables({ notifications: { data: null, error: null } });

    const res = await request(buildApp()).post("/api/notifications/read").send({ ids: ["n1", "n2"] });

    expect(res.status).toBe(200);
    const upd = q("notifications")[0];
    expect(upd.update).toHaveBeenCalledWith({ read: true });
    expect(upd.eq).toHaveBeenCalledWith("user_id", "p1");
    expect(upd.in).toHaveBeenCalledWith("id", ["n1", "n2"]);
  });
});

describe("notifications from actions", () => {
  it("tells the patient when their card is scanned, with the doctor and hospital", async () => {
    currentUser = DOCTOR;
    const q = tables({
      patients: { data: { id: "p1", card_uid: "04A3B2C1", name: "Ahmad Faiz", allergies: [], chronic_illnesses: [] }, error: null },
      doctors: { data: { hospital: "Hospital Kuala Lumpur" }, error: null },
      notifications: { data: null, error: null },
    });

    const res = await request(buildApp()).get("/api/nfc/04A3B2C1?method=nfc");

    expect(res.status).toBe(200);
    expect(q("notifications")[0].insert).toHaveBeenCalledWith([
      { user_id: "p1", type: "card.scanned", data: { by: "Dr. Sarah Jenkins", hospital: "Hospital Kuala Lumpur", method: "nfc" }, link: "/patient/profile", ref: null },
    ]);
  });

  it("alerts the admins when an unregistered card is scanned", async () => {
    currentUser = DOCTOR;
    const q = tables({
      patients: { data: null, error: null },
      profiles: { data: [{ id: "admin1" }, { id: "admin2" }], error: null },
      notifications: { data: null, error: null },
    });

    const res = await request(buildApp()).get("/api/nfc/DEADBEEF");

    expect(res.status).toBe(404);
    const rows = q("notifications")[0].insert.mock.calls[0][0];
    expect(rows.map((r) => [r.user_id, r.type])).toEqual([["admin1", "card.unknown"], ["admin2", "card.unknown"]]);
  });
});
