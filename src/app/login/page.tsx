"use client";
import { Loader2, Mail } from "lucide-react";
import { useState } from "react";

export default function Login() {
  const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") ? { ok: false, text: "That sign-in link has expired or was already replaced. Please request a new one." } : null));
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/auth/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const j = await r.json().catch(() => ({}));
      setMsg({ ok: r.ok, text: r.ok ? j.message : j.error ?? "Something went wrong" });
    } catch { setMsg({ ok: false, text: "Cannot reach the server" }); } finally { setBusy(false); }
  }
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <form onSubmit={go} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-7 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/smartshift-logo.png" alt="smartShift Technologies" className="mx-auto h-14 w-auto" />
        <h1 className="mt-5 text-center text-lg font-semibold text-slate-800">Defect Hub</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Enter your work e-mail. We will send you a link to sign in.</p>
        <label className="mt-5 block text-xs font-medium text-slate-700">E-mail address
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@smartshift.com" className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
        </label>
        <button disabled={busy || !email} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-700 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Send me a sign-in link
        </button>
        {msg && <p role="status" className={`mt-3 rounded-md p-2.5 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      </form>
    </main>
  );
}
