# Spin the Wheel

A self-hosted wheel for streams, game nights and choosing from a list. Runs on your own computer with Node.js or Docker. Includes a transparent OBS overlay, saved wheels, spin history, sound effects and a separate operator panel.

**Private use only:** anyone who can reach the main page can change entries, settings and saved wheels, and start spins. The operator token only protects the advanced controls. Keep the app on your computer or behind an authenticated private-network proxy. Do not port-forward it or expose it directly to the internet.

**Outcome controls:** the operator panel supports forced results, queues, weights and exclusions. Those settings are not shown on the main wheel or overlay. Disclose controlled outcomes to participants. This is not a certified random draw or a tool for regulated prize draws.

## Option 1: run with Node.js

Works with Node.js **22.9 or newer**. Node.js 22 and 24 are the CI targets. No database, paid service or build step is needed.

1. Install Node.js from <https://nodejs.org/>. Confirm `node --version` and `npm --version` work in a new terminal.
2. On this repository's GitHub page, choose **Code > Download ZIP**, then extract the folder. Alternatively, clone the repository with Git.
3. Open a terminal in the extracted folder. Run:

   ```sh
   npm ci --ignore-scripts
   npm start
   ```

4. Open <http://127.0.0.1:21030> in your browser. Keep the terminal running. Press **Ctrl+C** to stop the server and flush pending changes to disk.

On Windows, open PowerShell in the extracted folder. If PowerShell blocks `npm.ps1`, use `npm.cmd ci --ignore-scripts` and `npm.cmd start` instead of changing your execution policy.

### Optional configuration

Copy `.env.example` to `.env` with your file manager, then edit it before starting. `npm start` and `npm run dev` load `.env` automatically. Environment variables already set in your terminal take priority.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `21030` | HTTP and WebSocket port |
| `BIND` | `127.0.0.1` | Listen only on this computer |
| `DATA_DIR` | `data` beside the server's project folder | Persistent JSON storage; use an absolute path to override |
| `CONTROL_TOKEN` | Generated on first start | Optional operator credential override |
| `OVERLAY_KEY` | Generated on first start | Optional OBS credential override |

If you change `PORT`, use that port in all browser and OBS URLs. Keep custom data directories outside `public/`. Never commit `.env`, credentials, backups or your data folder.

## Option 2: run with Docker

Install Docker Desktop on macOS/Windows, or Docker Engine with the Compose plugin on Linux. Start Docker, download/extract this repository and open a terminal in its folder.

```sh
docker compose up -d --build --wait
```

Open <http://127.0.0.1:21030>. The container runs as a non-root user, starts again after a Docker restart, and stores data in a named volume. The published port is restricted to your computer.

```sh
docker compose ps                    # Service and health status
docker compose logs --tail=50 wheel  # Diagnostic messages, not credentials
docker compose stop                 # Stop without removing data
docker compose start --wait          # Start again
```

To change the host port, add `HOST_PORT=21031` to `.env` and recreate the container with `docker compose up -d --wait`. Open port 21031 instead. The container still listens internally on 21030. The Node.js `.env` settings are not passed into the container by this Compose file.

## Use the wheel

1. In **Entries**, type one entry per line. You need at least two entries to spin.
2. Click **SPIN**, or use the wheel's keyboard shortcuts after clicking the page. Browser sound may require an initial click.
3. Use **Wheels** to save and reload lists. Settings and recent results persist automatically.
4. In **Settings**, adjust spin duration, sound, pointer position and winner removal.

All tabs connected to one server share one wheel. A second independent wheel needs a separate server, port and data directory.

## Operator panel and OBS

### Get operator access

The first start generates `controlToken` and `overlayKey` in the private `data/secrets.json` file. They are not printed in server logs. Open the file locally in an editor, keep the values private, and paste `controlToken` into <http://127.0.0.1:21030/control> when prompted. If you set `CONTROL_TOKEN` yourself, use that value instead.

For Docker, copy the credentials file to your own machine without printing it in logs:

```sh
docker compose cp wheel:/app/data/secrets.json ./operator-secrets.json
```

Open that local file in an editor. Keep it private and out of source control. On shared machines, restrict access using your operating system's file permissions. Remove your temporary copy when you no longer need it.

### Add the OBS overlay

1. Open the operator panel and copy the Browser Source URL from its overlay section. It contains a private overlay key.
2. In OBS, add **Sources > Browser**. Paste the copied URL. Start with a width of **800** and height of **900**, then adjust for your layout.
3. Keep the server running. Use the wheel page to spin; OBS follows the same spin over WebSocket.
4. Keep the operator panel and keyed URL out of your screen capture. The overlay key assigns a read-only WebSocket role; it is not an operator password or a privacy barrier for wheel contents. The main page and unkeyed display remain reachable by anyone with network access.

The default URL works when OBS runs on the same computer. For another computer, use an authenticated private connection that both browsers and OBS can reach. `127.0.0.1` on another device points to that device, not your server. Do not solve this by publicly forwarding the app's port.

## Save, back up and restore

The private data directory holds entries/settings (`state.json`), saved wheels (`wheels.json`), recent history (`history.json`), operator outcome settings (`rig.json`) and credentials (`secrets.json`). Back up the whole directory, not just the wheel list. Files appear as their features are used or when the app shuts down.

**Node.js:** stop with Ctrl+C, copy the entire `data/` directory to a private backup location, then start again. To restore, stop the server, preserve the current directory, replace it with your backup and start again. Use your custom `DATA_DIR` if configured.

**Docker:** take a consistent backup by stopping the container first:

```sh
docker compose stop
docker compose cp wheel:/app/data ./wheel-backup
docker compose start --wait
```

To restore into an existing stopped container, first preserve the current data as a separate backup, then:

```sh
docker compose stop
docker compose cp ./wheel-backup/. wheel:/app/data
docker compose run --rm --no-deps --user root wheel chown -R node:node /app/data
docker compose start --wait
```

Use a complete backup from this app and keep the backup private. Restoring credentials restores the old operator login and OBS URL. Do not remove the Docker data volume when updating or rebuilding.

## Updates

Back up first. If you used Git, pull the new version. If you downloaded a ZIP, extract the new version into a separate folder and copy your private data and optional `.env` across before starting it. Do not run both copies against the same data directory.

For Node.js, stop the app, run `npm ci --ignore-scripts`, then `npm start`. For Docker, keep the same project folder and run `docker compose up -d --build --wait`; Compose reuses its named volume. When moving a Docker installation to a different project folder or computer, restore your backup into the new installation.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Address already in use | Stop the other copy, or change Node's `PORT` / Docker's `HOST_PORT`. |
| Page stays on “connecting” | Check that the server is running. A proxy must support WebSocket upgrades at `/ws`. |
| Overlay is blank | Use the complete keyed URL from the operator panel. Check the overlay is visible in its controls. |
| Wrong operator token | Use `controlToken`, not `overlayKey`; check whether `CONTROL_TOKEN` overrides the file. |
| Data disappears after restart | Check the data path, Docker volume and write permissions. Avoid changing Compose project folders without migrating data. |
| No sound | Click the page first, enable sound and check browser/OBS audio settings. |

Health endpoint: <http://127.0.0.1:21030/api/health>. It should return `ok: true` while the server is ready.

## Development and security notes

```sh
npm ci --ignore-scripts
npm test
npm audit --omit=dev
npm run dev
```

Tests use disposable data, not the running wheel. CI exercises Node.js 22/24 on Linux, macOS and Windows, plus a Docker startup check. Inspect each run's actual result before treating a platform as verified.

The app is a single Node.js process using Express, WebSockets and JSON files. It is not a multi-user SaaS service. Run one process per data directory. The main editor has no login or per-user permissions. Any reverse proxy must authenticate access to the **entire app**, including static pages, API and WebSocket routes. Use HTTPS outside loopback, keep dependencies current and treat all data backups as private.

For customization, edit `public/css/theme.css` and replace `public/assets/wheel.svg` with your own artwork. The app uses system fonts and bundled artwork.
