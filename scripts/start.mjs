// Starts the Hub on PORT (default 3000), listening on all network cards. Works the same on Windows, macOS, Linux and cloud hosts.
import { spawn } from "node:child_process"; import { createRequire } from "node:module";
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const port = process.env.PORT || "3000";
const child = spawn(process.execPath, [next, "start", "-p", port, "-H", "0.0.0.0"], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
