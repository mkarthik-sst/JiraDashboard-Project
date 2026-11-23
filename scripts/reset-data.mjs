// Clears the Hub's LOCAL working copy (the ./data folder and ./mail-sink) so the dashboard starts empty.
// Stop the Hub first. If SYNC_MODE=gdrive, also delete state/store.json from the Google Drive folder (or the Hub restores it from there on the next start).
import { rmSync, existsSync } from "node:fs";
for (const d of ["data", "mail-sink"]) { if (existsSync(d)) { rmSync(d, { recursive: true, force: true }); console.log("removed ./" + d); } }
console.log("Done. Start the Hub again with: npm start");
