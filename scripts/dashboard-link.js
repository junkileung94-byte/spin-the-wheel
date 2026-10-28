// Prints a one-click sign-in link for the dashboard.
//
//   npm run dashboard-link                                  -> http://127.0.0.1:<PORT>/login?token=…
//   npm run dashboard-link -- https://my-pc.example.ts.net  -> that address instead
//
// The link contains the operator token. Open it yourself or send it privately to the
// person running the wheel; anyone holding it can use the dashboard.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env: defaults apply */
}

const dataDir = process.env.DATA_DIR || path.join(ROOT, "data");
let token = process.env.CONTROL_TOKEN;
if (!token) {
  try {
    token = JSON.parse(fs.readFileSync(path.join(dataDir, "secrets.json"), "utf8")).controlToken;
  } catch {
    /* handled below */
  }
}
if (!token) {
  console.error("No dashboard token yet. Start the wheel once (npm start), then run this again.");
  process.exit(1);
}

const base = (process.argv[2] || `http://127.0.0.1:${process.env.PORT || 21030}`).replace(/\/+$/, "");
console.log("Open this link to sign in to the dashboard (keep it private):");
console.log(`${base}/login?token=${encodeURIComponent(token)}`);
