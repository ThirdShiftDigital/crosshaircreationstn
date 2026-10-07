import { getDatabase } from "@netlify/database";

// One place for every outbound text/email. Each send:
//   - has a hard timeout so a slow provider can't hang the caller,
//   - checks the provider's HTTP status and response body,
//   - is written to message_log (sent / queued / failed / skipped + error).

export const BUSINESS_NAME = "Crosshair Creations";
export const BUSINESS_PHONE = "(615) 549-5067";
const SEND_TIMEOUT_MS = 8000;

export type Channel = "sms" | "email";
export type Audience = "customer" | "team";

export type SendResult = {
  ok: boolean;
  status: string;          // sent | queued | accepted | failed | skipped
  providerId: string | null;
  error: string | null;
};

export type LogContext = {
  requestId?: number | null;
  audience: Audience;
  actorName?: string | null;
  baseUrl?: string | null;  // public site URL, used for the Twilio status callback
};

export function normalizeUsPhone(raw: string): string | null {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // not a recognizable US number: skip rather than guess
}

// Customer texts always identify the business and carry opt-out language (10DLC / CTIA).
export function formatCustomerSms(text: string): string {
  let t = (text || "").trim();
  if (!/^crosshair creations/i.test(t)) t = `${BUSINESS_NAME}: ${t}`;
  if (!/\bSTOP\b/.test(t)) t = `${t} Reply STOP to opt out.`;
  return t;
}

export function formatCustomerEmail(name: string, text: string): string {
  return `Hi ${name || "there"},\n\n${(text || "").trim()}\n\nQuestions? Call or text us at ${BUSINESS_PHONE}.\n\n— ${BUSINESS_NAME}`;
}

function describeError(e: unknown, provider: string): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `${provider} did not answer within ${SEND_TIMEOUT_MS / 1000}s`;
  }
  return `${provider} request failed: ${err?.message || String(e)}`;
}

export function twilioStatusCallbackUrl(baseUrl?: string | null): string | null {
  const base = (Netlify.env.get("PUBLIC_SITE_URL") || baseUrl || "").replace(/\/+$/, "");
  return base.startsWith("https://") ? `${base}/api/twilio-status` : null;
}

export async function sendSms(to: string, body: string, baseUrl?: string | null): Promise<SendResult> {
  const accountSid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Netlify.env.get("TWILIO_PHONE_NUMBER");
  if (!accountSid || !authToken || !fromNumber) {
    return { ok: false, status: "skipped", providerId: null, error: "Texting is not configured (TWILIO_* env vars missing)" };
  }
  if (!to) return { ok: false, status: "skipped", providerId: null, error: "No valid phone number" };

  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const callback = twilioStatusCallbackUrl(baseUrl);
  if (callback) params.set("StatusCallback", callback);

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = [data.code && `code ${data.code}`, data.message].filter(Boolean).join(": ");
      return { ok: false, status: "failed", providerId: data.sid || null, error: `Twilio HTTP ${res.status}${detail ? ` (${detail})` : ""}` };
    }
    if (data.error_code || data.status === "failed" || data.status === "undelivered") {
      return { ok: false, status: "failed", providerId: data.sid || null, error: `Twilio error ${data.error_code || ""} ${data.error_message || ""}`.trim() };
    }
    return { ok: true, status: data.status || "queued", providerId: data.sid || null, error: null };
  } catch (e) {
    return { ok: false, status: "failed", providerId: null, error: describeError(e, "Twilio") };
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!resendKey) return { ok: false, status: "skipped", providerId: null, error: "Email is not configured (RESEND_API_KEY missing)" };
  if (!to) return { ok: false, status: "skipped", providerId: null, error: "No email address" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${BUSINESS_NAME} <alerts@crosshaircreationstn.com>`,
        to: [to],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      return { ok: false, status: "failed", providerId: null, error: `Resend HTTP ${res.status}${data.message ? ` (${data.message})` : ""}` };
    }
    return { ok: true, status: "sent", providerId: data.id, error: null };
  } catch (e) {
    return { ok: false, status: "failed", providerId: null, error: describeError(e, "Resend") };
  }
}

export async function logMessage(
  channel: Channel, recipient: string, subject: string | null, body: string, result: SendResult, ctx: LogContext,
): Promise<void> {
  try {
    const db = getDatabase();
    await db.sql`
      INSERT INTO message_log (request_id, audience, channel, recipient, subject, body, status, provider_id, error, actor_name)
      VALUES (${ctx.requestId ?? null}, ${ctx.audience}, ${channel}, ${recipient}, ${subject}, ${body},
              ${result.status}, ${result.providerId}, ${result.error}, ${ctx.actorName ?? null})
    `;
  } catch (e) {
    console.error("message_log insert failed", e);
  }
}

// Send one message and record the outcome. Never throws.
export async function sendAndLog(
  channel: Channel, recipient: string, body: string, subject: string | null, ctx: LogContext,
): Promise<SendResult> {
  let result: SendResult;
  try {
    result = channel === "sms"
      ? await sendSms(recipient, body, ctx.baseUrl)
      : await sendEmail(recipient, subject || BUSINESS_NAME, body);
  } catch (e) {
    result = { ok: false, status: "failed", providerId: null, error: describeError(e, channel) };
  }
  if (!result.ok) console.error(`[${channel}] to ${recipient} ${result.status}: ${result.error}`);
  await logMessage(channel, recipient, subject, body, result, ctx);
  return result;
}
