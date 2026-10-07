// Dispatch statuses for recovery requests, in the order a job normally moves.
export const STATUS_FLOW = [
  "new", "acknowledged", "assigned", "en_route", "on_scene", "found", "not_found", "closed",
] as const;
export type RecoveryStatus = typeof STATUS_FLOW[number];

export const STATUS_LABELS: Record<string, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  assigned: "Pilot assigned",
  en_route: "En route",
  on_scene: "On scene / searching",
  found: "Found",
  not_found: "Not found",
  closed: "Closed",
  // statuses written by the old dashboard
  contacted: "Acknowledged (old)",
  resolved: "Closed (old)",
};

// Position in the flow. found and not_found are the same step (the outcome).
export const STATUS_RANK: Record<string, number> = {
  new: 0, acknowledged: 1, contacted: 1, assigned: 2, en_route: 3, on_scene: 4,
  found: 5, not_found: 5, resolved: 6, closed: 6,
};

export const ACTIVE_STATUSES = ["new", "acknowledged", "contacted", "assigned", "en_route", "on_scene", "found", "not_found"];

// Default customer message for each step. The dashboard shows these in an
// editable preview before anything is sent. Placeholders: {animal} {pilot} {eta}
export const CUSTOMER_TEMPLATES: Record<string, string> = {
  new: "",
  acknowledged: "We received your {animal} recovery request and we're reviewing it now. We'll call you shortly to coordinate.",
  assigned: "{pilot} is assigned to your {animal} recovery.{eta} We'll let you know when they're on the way.",
  en_route: "{pilot} is on the way to you now.{eta}",
  on_scene: "{pilot} is on site and the thermal search has started. We'll update you as soon as we know more.",
  found: "Good news: we've located your {animal}. {pilot} will walk you through next steps.",
  not_found: "We weren't able to locate your {animal} on this search. {pilot} will go over the area we covered and any next steps with you.",
  closed: "Your recovery request is now closed. Thank you for trusting Crosshair Creations.",
};

export function isKnownStatus(s: string): s is RecoveryStatus {
  return (STATUS_FLOW as readonly string[]).includes(s);
}

export type TransitionCheck =
  | { ok: true; backward: boolean }
  | { ok: false; status: number; error: string; needsConfirm?: boolean };

export function checkTransition(from: string, to: string, confirmBackward: boolean): TransitionCheck {
  if (!isKnownStatus(to)) {
    return { ok: false, status: 400, error: `Unknown status "${to}".` };
  }
  const fromRank = STATUS_RANK[from] ?? 0;
  const toRank = STATUS_RANK[to];
  const sameStep = from === to;
  // Re-saving the same step is only meaningful where it carries details.
  if (sameStep && !["assigned", "en_route", "closed"].includes(to)) {
    return { ok: false, status: 409, error: `This request is already "${STATUS_LABELS[to]}".` };
  }
  const backward = !sameStep && (toRank < fromRank || (toRank === fromRank && from !== to));
  if (backward && !confirmBackward) {
    return {
      ok: false, status: 409, needsConfirm: true,
      error: `Moving from "${STATUS_LABELS[from] || from}" back to "${STATUS_LABELS[to]}" needs confirmation.`,
    };
  }
  return { ok: true, backward };
}

export function animalWord(recoveryType: string): string {
  return recoveryType === "deer" ? "deer" : "pet";
}
