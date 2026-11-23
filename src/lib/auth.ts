/**
 * Optional sign-in for a shared (public) URL. AUTH_MODE=email: a user types their e-mail on /login, the Hub mails a one-time link,
 * the link sets a signed cookie. Nothing is stored on the server; tokens are HMAC-signed (Web Crypto, so the same code runs in the
 * Next.js middleware and in the API routes). AUTH_MODE=none (default) = no sign-in, exactly like local testing.
 */
const enc = new TextEncoder();
const env = (k: string, d = "") => (process.env[k] ?? d).trim();
const list = (v: string) => v.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

export const COOKIE = "sdh_session";
export const authMode = (): "none" | "email" => (env("AUTH_MODE", "none").toLowerCase() === "email" ? "email" : "none");
export const authSecret = () => env("AUTH_SECRET");
export const adminEmails = () => list(env("ADMIN_EMAILS"));
export const allowedDomains = () => list(env("AUTH_ALLOWED_DOMAINS")).map((d) => d.replace(/^@/, ""));
export const allowedEmails = () => list(env("AUTH_ALLOWED_EMAILS"));
export const sessionHours = () => Math.max(1, Number(env("AUTH_SESSION_HOURS", "12")) || 12);
export const linkMinutes = () => Math.max(2, Number(env("AUTH_LINK_MINUTES", "15")) || 15);
export const enforceOwner = () => env("AUTH_ENFORCE_OWNER", "false").toLowerCase() === "true";
/** Who sees the "Open Drive folder" link (and Google Drive file links). "*" = everybody. Default: administrators only. OPEN_REPO_USERS is still read as an old name. */
export const driveUsers = () => { const v = env("OPEN_DRIVE_USERS") || env("OPEN_REPO_USERS"); return v ? (v.trim().startsWith("*") ? ["*"] : list(v)) : adminEmails(); };

const b64 = (bytes: ArrayBuffer | Uint8Array) => { const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ""; a.forEach((c) => (s += String.fromCharCode(c))); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64 = (s: string) => { const t = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4); const bin = atob(t); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
async function key(secret: string) { return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }

export interface Token { t: "login" | "session"; e: string; exp: number }
export async function signToken(p: Token, secret = authSecret()): Promise<string> {
  const body = b64(enc.encode(JSON.stringify(p)));
  return `${body}.${b64(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)))}`;
}
export async function verifyToken(token: string, kind: Token["t"], secret = authSecret()): Promise<Token | null> {
  try {
    const [body, sig] = token.split("."); if (!body || !sig || !secret) return null;
    if (!(await crypto.subtle.verify("HMAC", await key(secret), unb64(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(body))) as Token;
    return p.t === kind && p.exp > Date.now() && typeof p.e === "string" ? p : null;
  } catch { return null; }
}

export const isAdmin = (email: string) => adminEmails().includes(email.toLowerCase());
export function emailAllowed(email: string): boolean {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return false;
  return isAdmin(e) || allowedEmails().includes(e) || allowedDomains().includes(e.split("@")[1]);
}
export const canOpenDrive = (email: string) => { const u = driveUsers(); return u.includes("*") || (!!email && u.includes(email.toLowerCase())); };

export function cookieOf(header: string | null, name = COOKIE): string {
  for (const part of (header ?? "").split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); }
  return "";
}
export interface Session { email: string; admin: boolean }
/** The signed-in user of a request, or null. With AUTH_MODE=none everybody is an anonymous administrator (local testing). */
export async function sessionOf(req: Request): Promise<Session | null> {
  if (authMode() === "none") return { email: "", admin: true };
  const t = await verifyToken(cookieOf(req.headers.get("cookie")), "session");
  return t ? { email: t.e, admin: isAdmin(t.e) } : null;
}
export async function actorOf(req: Request): Promise<string> { return (await sessionOf(req))?.email ?? ""; }
