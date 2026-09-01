export function normalizeUsPhone(raw: string): string | null {
  const digits = (raw || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // not a recognizable US number — skip rather than guess
}

export async function sendSms(to: string, body: string): Promise<void> {
  const accountSid = Netlify.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Netlify.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Netlify.env.get("TWILIO_PHONE_NUMBER");

  if (!accountSid || !authToken || !fromNumber || !to) return;

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch {
    // never let an SMS failure block the calling function
  }
}
