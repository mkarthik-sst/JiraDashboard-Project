import { NextResponse, type NextRequest } from "next/server";
import { authMode, authSecret, COOKIE, isAdmin, verifyToken } from "./lib/auth";

/** Only active with AUTH_MODE=email: everything except the login page needs the signed session cookie. */
const PUBLIC = [/^\/login$/, /^\/api\/auth\//, /^\/_next\//, /^\/smartshift-logo/, /^\/favicon/, /^\/icon/];
const ADMIN_ONLY = [/^\/api\/sync/, /^\/api\/jira/, /^\/api\/notify/];

export async function middleware(req: NextRequest) {
  if (authMode() === "none") return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const isApi = pathname.startsWith("/api/");
  if (!authSecret()) return NextResponse.json({ error: "AUTH_MODE=email needs AUTH_SECRET in the settings" }, { status: 503 });
  // local test mailbox (built-in catcher) is readable without sign-in so the sign-in mail can be opened during local tests
  if (pathname.startsWith("/api/mail-sink") && /^(127\.0\.0\.1|localhost|::1)$/i.test((process.env.SMTP_HOST ?? "").trim())) return NextResponse.next();
  const t = await verifyToken(req.cookies.get(COOKIE)?.value ?? "", "session");
  if (!t) {
    if (isApi) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    const url = req.nextUrl.clone(); url.pathname = "/login"; url.search = "";
    return NextResponse.redirect(url);
  }
  if (ADMIN_ONLY.some((r) => r.test(pathname)) && !isAdmin(t.e)) return NextResponse.json({ error: "Only administrators can do this" }, { status: 403 });
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
