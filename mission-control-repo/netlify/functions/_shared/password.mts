import crypto from "node:crypto";

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, "hex");
    if (candidate.length !== stored.length) return false;
    return crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 200;

// Returns an error message, or null if the new password is acceptable.
export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!password.trim()) return "New password can't be only spaces.";
  return null;
}
