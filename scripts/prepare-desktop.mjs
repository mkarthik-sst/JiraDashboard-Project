// Copies the Next.js standalone build into desktop/app so Electron can ship it.  Run: npm run build && npm run desktop:prepare
import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const out = path.join(root, "desktop", "app");
if (!fs.existsSync(path.join(standalone, "server.js"))) {
  console.error("Missing .next/standalone/server.js - run `npm run build` first (next.config.mjs must have output: 'standalone').");
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true, dereference: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (fs.existsSync(path.join(root, "public"))) fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
if (fs.existsSync(path.join(root, "attachments"))) fs.cpSync(path.join(root, "attachments"), path.join(out, "attachments"), { recursive: true });   // sample attachment files
// Next's file tracer misses files behind the Node "module-sync" export condition (e.g. generator-function/require.mjs,
// async-function/require.mjs - transitive deps of exceljs). Top up every traced package with its complete source so the
// bundle cannot crash at runtime. force:false => never overwrites what the tracer already copied.
const nm = path.join(out, "node_modules");
const merge = (rel) => fs.cpSync(path.join(root, "node_modules", rel), path.join(nm, rel), { recursive: true, force: false, dereference: true });
for (const name of fs.readdirSync(nm)) {
  if (name.startsWith(".") || ["next", "react", "react-dom", "caniuse-lite", "@swc"].includes(name)) continue; // Next/React are traced correctly
  if (name === "@next") continue;
  if (name.startsWith("@")) for (const sub of fs.readdirSync(path.join(nm, name))) { if (fs.existsSync(path.join(root, "node_modules", name, sub))) merge(`${name}/${sub}`); }
  else if (fs.existsSync(path.join(root, "node_modules", name))) merge(name);
}
// never ship secrets or demo data
for (const f of [".env.local", ".env"]) fs.rmSync(path.join(out, f), { force: true });
fs.rmSync(path.join(out, "data"), { recursive: true, force: true });
console.log("desktop/app prepared:", out);
