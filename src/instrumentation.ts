/** Runs once when the Hub server starts (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSink } = await import("./lib/sink");
    await startSink();
    const { configWarnings } = await import("./lib/config-check");
    for (const w of configWarnings()) console.warn(`[config ${w.level}] ${w.text}`);
  }
}
