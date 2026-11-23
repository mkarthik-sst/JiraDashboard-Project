import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "smartShift Defect Hub", description: "smartShift Technologies - defect ingestion, deduplication, approval and Jira automation" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
