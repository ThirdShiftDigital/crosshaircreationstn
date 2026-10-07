import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { notifyOptedInUsers } from "./_shared/notify.mts";
import {
  BUSINESS_PHONE, formatCustomerEmail, formatCustomerSms, normalizeUsPhone, sendAndLog,
} from "./_shared/messaging.mts";

const PET_INSTRUCTIONS = [
  "Stay in the area if it's safe to do so — pets often circle back to where they were last seen.",
  "Don't chase if you spot them; sudden movement can send a scared animal running further. Crouch down, stay calm, and call gently.",
  "Leave something familiar out — their bed, a worn piece of your clothing, or food — near where they were last seen.",
  "Try to pin down the exact spot and time they were last seen, and which direction they were headed.",
  "Keep your phone nearby and charged. We'll call you directly to coordinate the flight.",
];

const DEER_INSTRUCTIONS = [
  "Stop tracking and stay put once you've marked the last sign — continuing to push forward can drive the deer further and disturb the trail.",
  "Mark your GPS location (drop a pin, hang flagging tape, or note landmarks) at the last blood sign or the shot location.",
  "Note the direction the deer traveled, if known.",
  "If it's after dark or the terrain is thick, wait for us rather than continuing on foot — the thermal camera covers ground far faster and won't miss what's hard to see at night.",
  "Keep your phone nearby and charged. We'll call you directly to coordinate the flight.",
];

// A repeat request for the same phone + type inside this window is treated as the same request.
const DUPLICATE_WINDOW_MINUTES = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function cleanSubmissionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return /^[A-Za-z0-9-]{8,100}$/.test(v) ? v : null;
}

function siteBaseUrl(req: Request, context: Context): string {
  return (context.site?.url || new URL(req.url).origin || "").replace(/\/+$/, "");
}

// Runs after the customer already has their answer.
async function sendNotifications(row: any, instructions: string[], baseUrl: string) {
  const type = row.recovery_type === "deer" ? "deer" : "pet";
  const typeTitle = type === "deer" ? "Deer" : "Pet";
  const mapLink = (row.latitude !== null && row.longitude !== null)
    ? `\n\nGet directions: https://www.google.com/maps/dir/?api=1&destination=${row.latitude},${row.longitude}`
    : "";

  const tasks: Promise<unknown>[] = [];

  // 1) Team alert (email + text to everyone opted in).
  tasks.push(notifyOptedInUsers(
    "recovery",
    `🚨 New ${typeTitle} Recovery Request — ${row.name}`,
    `New recovery request just came in.\n\nName: ${row.name}\nPhone: ${row.phone}\nEmail: ${row.email || "not provided"}\nType: ${typeTitle} Recovery\nLocation: ${row.location_description || "not provided"}\nDetails: ${row.details || "none"}${mapLink}\n\nView it in Mission Control: ${baseUrl || "https://crosshaircreationstn.com"}/dashboard`,
    { requestId: row.id, baseUrl },
  ));

  // 2) "We got your request" to the customer: text only if they opted in, email if given.
  const ctx = { requestId: row.id, audience: "customer" as const, actorName: "Automatic", baseUrl };
  const phone = normalizeUsPhone(row.phone || "");
  if (row.sms_consent && phone) {
    tasks.push(sendAndLog("sms", phone, formatCustomerSms(
      `We received your ${type} recovery request and our team has been alerted. We'll call you at this number shortly. Can't wait? Call ${BUSINESS_PHONE}. Msg & data rates may apply.`,
    ), null, ctx));
  }
  if (row.email) {
    tasks.push(sendAndLog("email", row.email, formatCustomerEmail(row.name,
      `We received your ${type} recovery request and our team has been alerted. We'll call you at ${row.phone} shortly to coordinate.\n\nWhile you wait:\n- ${instructions.join("\n- ")}`,
    ), `We received your ${type} recovery request`, ctx));
  }

  await Promise.allSettled(tasks);
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 200);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const email = String(body.email || "").trim().slice(0, 200);
  const recoveryType = body.recovery_type === "deer" ? "deer" : "pet";
  const locationDescription = String(body.location_description || "").trim().slice(0, 500);
  const details = String(body.details || "").trim().slice(0, 4000);
  const agreedToDisclaimer = body.agreed_to_disclaimer === true;
  const smsConsent = body.sms_consent === true;
  const latitude = typeof body.latitude === "number" && Number.isFinite(body.latitude) ? body.latitude : null;
  const longitude = typeof body.longitude === "number" && Number.isFinite(body.longitude) ? body.longitude : null;
  const submissionId = cleanSubmissionId(body.submission_id);
  const ipAddress = context.ip || null;

  if (!name || !phone) return json({ error: "Name and phone number are required." }, 400);
  if (!agreedToDisclaimer) return json({ error: "You must agree to the disclaimer before submitting." }, 400);

  const instructions = recoveryType === "deer" ? DEER_INSTRUCTIONS : PET_INSTRUCTIONS;
  const db = getDatabase();

  // --- Duplicate checks: same submission id, or same phone + type a few minutes ago ---
  const phoneDigits = phone.replace(/[^0-9]/g, "").slice(-10);
  let existing: any = null;
  let duplicateReason = "";
  if (submissionId) {
    const rows = await db.sql`SELECT id, created_at FROM recovery_requests WHERE submission_id = ${submissionId}`;
    if (rows.length) { existing = rows[0]; duplicateReason = "resubmitted the same form"; }
  }
  if (!existing && phoneDigits.length >= 7) {
    const rows = await db.sql`
      SELECT id, created_at FROM recovery_requests
      WHERE recovery_type = ${recoveryType}
        AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${phoneDigits}
        AND created_at > NOW() - make_interval(mins => ${DUPLICATE_WINDOW_MINUTES})
      ORDER BY id DESC LIMIT 1
    `;
    if (rows.length) { existing = rows[0]; duplicateReason = `sent another ${recoveryType} request from the same phone within ${DUPLICATE_WINDOW_MINUTES} minutes`; }
  }

  let row: any = null;
  if (!existing) {
    const inserted = await db.sql`
      INSERT INTO recovery_requests (name, phone, email, recovery_type, location_description, details,
        agreed_to_disclaimer, latitude, longitude, sms_consent, ip_address, submission_id, status_changed_at)
      VALUES (${name}, ${phone}, ${email || null}, ${recoveryType}, ${locationDescription || null}, ${details || null},
        ${agreedToDisclaimer}, ${latitude}, ${longitude}, ${smsConsent}, ${ipAddress}, ${submissionId}, NOW())
      ON CONFLICT (submission_id) DO NOTHING
      RETURNING *
    `;
    if (inserted.length) {
      row = inserted[0];
    } else {
      // Lost a race with an identical submit that landed a split second earlier.
      const rows = await db.sql`SELECT id, created_at FROM recovery_requests WHERE submission_id = ${submissionId}`;
      existing = rows[0];
      duplicateReason = "resubmitted the same form";
    }
  }

  if (existing) {
    // Keep anything new the customer typed, but don't create a second job or re-alert everyone.
    const extra = [
      locationDescription && `Location: ${locationDescription}`,
      details && `Details: ${details}`,
      latitude !== null && longitude !== null && `Pin: ${latitude}, ${longitude}`,
    ].filter(Boolean).join("\n");
    try {
      await db.sql`
        INSERT INTO recovery_events (request_id, kind, note, actor_name)
        VALUES (${existing.id}, 'duplicate', ${`Customer ${duplicateReason}. No new request created.${extra ? `\n${extra}` : ""}`}, 'Website')
      `;
    } catch (e) { console.error("duplicate event insert failed", e); }
    return json({ ok: true, id: existing.id, duplicate: true, instructions }, 200);
  }

  try {
    await db.sql`
      INSERT INTO recovery_events (request_id, kind, to_status, note, actor_name)
      VALUES (${row.id}, 'created', 'new', ${smsConsent ? "Customer opted in to texts." : "Customer did not opt in to texts (call only)."}, 'Website')
    `;
  } catch (e) { console.error("created event insert failed", e); }

  // Answer the customer right away; alerts finish in the background.
  const work = sendNotifications(row, instructions, siteBaseUrl(req, context))
    .catch(e => console.error("recovery notifications failed", e));
  const waitUntil = (context as any)?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil.call(context, work);
  } else {
    await work; // older runtimes: still bounded by the per-send timeouts
  }

  return json({ ok: true, id: row.id, duplicate: false, instructions }, 201);
};

export const config: Config = {
  path: "/api/recovery-request",
};
