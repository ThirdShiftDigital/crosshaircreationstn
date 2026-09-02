import type { Context, Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { notifyOptedInUsers } from "./_shared/notify.mts";

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

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { "content-type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const email = (body.email || "").trim();
  const recoveryType = body.recovery_type === "deer" ? "deer" : "pet";
  const locationDescription = (body.location_description || "").trim();
  const details = (body.details || "").trim();
  const agreedToDisclaimer = body.agreed_to_disclaimer === true;
  const latitude = typeof body.latitude === "number" ? body.latitude : null;
  const longitude = typeof body.longitude === "number" ? body.longitude : null;

  if (!name || !phone) {
    return new Response(JSON.stringify({ error: "Name and phone number are required." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  if (!agreedToDisclaimer) {
    return new Response(JSON.stringify({ error: "You must agree to the disclaimer before submitting." }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  const db = getDatabase();
  const [row] = await db.sql`
    INSERT INTO recovery_requests (name, phone, email, recovery_type, location_description, details, agreed_to_disclaimer, latitude, longitude)
    VALUES (${name}, ${phone}, ${email || null}, ${recoveryType}, ${locationDescription || null}, ${details || null}, ${agreedToDisclaimer}, ${latitude}, ${longitude})
    RETURNING id, created_at
  `;

  const mapLink = (latitude !== null && longitude !== null)
    ? `\n\nGet directions: https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`
    : "";

  await notifyOptedInUsers(
    "recovery",
    `🚨 New ${recoveryType === "deer" ? "Deer" : "Pet"} Recovery Request — ${name}`,
    `New recovery request just came in.\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email || "not provided"}\nType: ${recoveryType === "deer" ? "Deer Recovery" : "Pet Recovery"}\nLocation: ${locationDescription || "not provided"}\nDetails: ${details || "none"}${mapLink}\n\nView it in Mission Control: https://crosshaircreationstn.com/dashboard`
  );

  const instructions = recoveryType === "deer" ? DEER_INSTRUCTIONS : PET_INSTRUCTIONS;

  return new Response(JSON.stringify({ ok: true, id: row.id, instructions }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/recovery-request",
};
