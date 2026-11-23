import { cn } from "@/lib/utils";
const tones = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200", blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200", amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200", violet: "bg-violet-50 text-violet-700 ring-violet-200", sky: "bg-sky-50 text-sky-700 ring-sky-200",
};
export function Badge({ tone = "slate", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}
export const priorityTone = (p: string) => {
  const v = p.toLowerCase();
  return (/highest|critical|attention|blocker/.test(v) ? "violet" : v === "high" ? "red" : v === "medium" ? "amber" : "slate") as keyof typeof tones;
};
