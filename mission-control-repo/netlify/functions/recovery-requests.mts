import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { getSessionUser, unauthorized, forbidden, type SessionUser } from "./_shared/session.mts";
import {
  formatCustomerEmail, formatCustomerSms, normalizeUsPhone, sendAndLog, type SendResult,
} from "./_shared/messaging.mts";
import {
  ACTIVE_STATUSES, CUSTOMER_TEMPLATES, STATUS_FLOW, STATUS_LABELS, STATUS_RANK, animalWord, checkTransition,
} from "./_shared/recovery-flow.mts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const MAX_MESSAGE_LENGTH = 640;
const MAX_NOTE_LENGTH = 2000;

function siteBaseUrl(req: Request, context: Context): string {
  return (context.site?.url || new URL(req.url).origin || "").replace(/\/+$/, "");
}

function channelsFor(r: any) {
  const phone = normalizeUsPhone(r.phone || "");
  return {
    sms: { available: !!(r.sms_consent && phone), to: phone, reason: !phone ? "No valid US phone number" : (!r.sms_consent ? "Customer did not opt in to texts" : null) },
    email: { available: !!r.email, to: r.email || null, reason: r.email ? null : "No email on file" },
  };
}

async function loadDetail(db: any, id: number) {
  const rows = await db.sql`SELECT * FROM recovery_requests WHERE id = ${id}`;
  if (!rows.length) return null;
  const request = rows[0];
  const events = await db.sql`SELECT * FROM recovery_events WHERE request_id = ${id} ORDER BY created_at ASC, id ASC`;
  const messages = await db.sql`SELECT * FROM message_log WHERE request_id = ${id} ORDER BY created_at ASC, id ASC`;
  return { request, events, messages, channels: channelsFor(request) };
}

async function addEvent(db: any, requestId: number, kind: string, user: SessionUser, fields: { from?: string | null; to?: string | null; note?: string | null }) {
  await db.sql`
    INSERT INTO recovery_events (request_id, kind, from_status, to_status, note, actor_user_id, actor_name)
    VALUES (${requestId}, ${kind}, ${fields.from ?? null}, ${fields.to ?? null}, ${fields.note ?? null}, ${user.id}, ${user.name || user.email})
  `;
}

// Sends the staff-approved message on the channels they ticked (and that are allowed).
async function sendCustomerMessage(request: any, notify: any, user: SessionUser, baseUrl: string) {
  const out: { channel: string; result: SendResult }[] = [];
  if (!notify || typeof notify !== "object") return out;
  const text = String(notify.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return out;
  const ch = channelsFor(request);
  const ctx = { requestId: request.id, audience: "customer" as const, actorName: user.name || user.email, baseUrl };
  const jobs: Promise<void>[] = [];
  if (notify.sms && ch.sms.available && ch.sms.to) {
    jobs.push(sendAndLog("sms", ch.sms.to, formatCustomerSms(text), null, ctx).then(result => { out.push({ channel: "sms", result }); }));
  }
  if (notify.email && ch.email.available && ch.email.to) {
    const subject = String(notify.subject || "").trim().slice(0, 150)
      || `Update on your ${animalWord(request.recovery_type)} recovery request`;
    jobs.push(sendAndLog("email", ch.email.to, formatCustomerEmail(request.name, text), subject, ctx).then(result => { out.push({ channel: "email", result }); }));
  }
  await Promise.allSettled(jobs);
  return out;
}

export default async (req: Request, context: Context) => {
  const user = await getSessionUser(req);
  if (!user) return unauthorized();
  if (!user.is_owner && !user.can_view_recovery_requests) return forbidden();

  const db = getDatabase();
  const url = new URL(req.url);
  const idParam = url.searchParams.get("id");
  const id = idParam && /^\d+$/.test(idParam) ? Number(idParam) : null;

  if (req.method === "GET" && !id) {
    const filter = url.searchParams.get("filter") || "all";
    const rows = await db.sql`
      SELECT r.*,
        (SELECT COUNT(*)::int FROM message_log m WHERE m.request_id = r.id AND m.status IN ('failed','undelivered')) AS failed_messages,
        GREATEST(r.created_at::timestamptz, r.status_changed_at,
          (SELECT MAX(e.created_at) FROM recovery_events e WHERE e.request_id = r.id)) AS last_activity_at
      FROM recovery_requests r
      ORDER BY r.created_at DESC
    `;
    const filtered = filter === "active" ? rows.filter((r: any) => ACTIVE_STATUSES.includes(r.status))
      : filter === "closed" ? rows.filter((r: any) => !ACTIVE_STATUSES.includes(r.status))
      : rows;
    return json(filtered);
  }

  if (req.method === "GET" && id) {
    const detail = await loadDetail(db, id);
    if (!detail) return json({ error: "Not found" }, 404);
    return json({ ...detail, templates: CUSTOMER_TEMPLATES, labels: STATUS_LABELS, flow: STATUS_FLOW, ranks: STATUS_RANK });
  }

  if (req.method === "PUT" && id) {
    const b = await req.json().catch(() => ({}));
    const action = b.action || "status";
    const existingRows = await db.sql`SELECT * FROM recovery_requests WHERE id = ${id}`;
    const existing = existingRows[0];
    if (!existing) return json({ error: "Not found" }, 404);
    const baseUrl = siteBaseUrl(req, context);

    if (action === "note") {
      const note = String(b.note || "").trim().slice(0, MAX_NOTE_LENGTH);
      if (!note) return json({ error: "Write a note first." }, 400);
      await addEvent(db, id, "note", user, { note });
      return json(await loadDetail(db, id));
    }

    if (action === "message") {
      const sent = await sendCustomerMessage(existing, b.notify, user, baseUrl);
      if (!sent.length) return json({ error: "Nothing was sent. Pick a channel the customer can receive and write a message." }, 400);
      await addEvent(db, id, "message", user, { note: `Sent a message by ${sent.map(s => s.channel === "sms" ? "text" : "email").join(" and ")}.` });
      return json({ ...(await loadDetail(db, id)), sent });
    }

    if (action !== "status") return json({ error: "Unknown action" }, 400);

    const to = String(b.status || "");
    const from = existing.status || "new";
    const check = checkTransition(from, to, b.confirm_backward === true);
    if (!check.ok) return json({ error: check.error, needs_confirm: !!check.needsConfirm }, check.status);

    // Step-specific details
    let pilot: string | null = existing.assigned_pilot;
    let eta: string | null = existing.eta_text;
    let hours: number | null = existing.hours_worked === null || existing.hours_worked === undefined ? null : Number(existing.hours_worked);
    let outcome: string | null = existing.outcome;

    if (b.pilot !== undefined) pilot = String(b.pilot || "").trim().slice(0, 100) || null;
    if (b.eta !== undefined) eta = String(b.eta || "").trim().slice(0, 100) || null;
    if (to === "assigned" && !pilot) return json({ error: "Enter the pilot's name to assign this request." }, 400);
    if (to === "found" || to === "not_found") outcome = to;
    if (STATUS_RANK[to] < 5 && check.backward) outcome = null; // moved back before the outcome step
    if (to === "closed") {
      const h = Number(b.hours_worked);
      if (b.hours_worked === undefined || b.hours_worked === "" || !Number.isFinite(h) || h < 0 || h > 72) {
        return json({ error: "Enter the hours worked (0 if nobody flew) to close this request." }, 400);
      }
      hours = Math.round(h * 4) / 4; // quarter hours
    }

    const [row] = await db.sql`
      UPDATE recovery_requests SET
        status = ${to},
        assigned_pilot = ${pilot},
        eta_text = ${eta},
        outcome = ${outcome},
        hours_worked = ${hours},
        status_changed_at = NOW(),
        closed_at = ${to === "closed" ? new Date().toISOString() : null}
      WHERE id = ${id}
      RETURNING *
    `;

    const details: string[] = [];
    if (to === "assigned" || to === "en_route") {
      if (pilot) details.push(`Pilot: ${pilot}`);
      if (eta) details.push(`ETA: ${eta}`);
    }
    if (to === "closed") details.push(`Hours worked: ${hours}`);
    if (check.backward) details.push("Moved back (confirmed).");
    const note = String(b.note || "").trim().slice(0, MAX_NOTE_LENGTH);
    if (note) details.push(note);
    await addEvent(db, id, "status", user, { from, to, note: details.join("\n") || null });

    const sent = await sendCustomerMessage(row, b.notify, user, baseUrl);
    return json({ ...(await loadDetail(db, id)), sent });
  }

  if (req.method === "DELETE" && id) {
    await db.sql`DELETE FROM recovery_requests WHERE id = ${id}`;
    return json({ ok: true });
  }

  return json({ error: "Bad request" }, 400);
};

export const config: Config = {
  path: "/api/recovery-requests",
};
