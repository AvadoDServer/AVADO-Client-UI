# AVADO Client UI — shared consensus-client web UI

Status: approved by the owner on 2026-09-23 ("implement it"). Nimbus first. Teku, Prysm and Lighthouse follow; Lighthouse also gets an upgrade to the latest client release.

Research this spec builds on (local only): `~/Documents/AVADO-reports/{nimbus,teku-prysm-beacon,lighthouse,dependents}.md`.

## 1. Goals

- One web UI codebase for every AVADO consensus client. It replaces the copy-pasted `build/wizard` React apps, which have drifted apart.
- It looks and behaves like the AVADO Admin (10.0.53+):
  - "Appliance" tokens, Sen and Public Sans fonts.
  - Light, dark and match-computer themes.
  - Simple and Advanced modes.
  - Plain-language copy.
- **Existing users migrate by a normal package update, with no action and no issues.**

## 2. Migration contract (must not break)

A UI release of a client package changes only the static web files, plus the removals listed in §6. Everything below stays as it is today:

1. **Package identity:** package names and manifest `links.OnboardingWizard` URLs (`http://<pkg>.my.ava.do`).
2. **Ports and roles:** port 80 serves the SPA; port 9999 is the backend JSON API.
3. **Backend routes:** `/ping`, `/network`, `/name`, `/settings` (GET/POST), `/defaultsettings`, `/service/{start,stop,restart,status}`, and the `/rest/*` and `/keymanager/*` proxies with the server-side bearer token.
   - Rocket Pool and other packages call these, so none are renamed or removed. The only exception is the beaconcha.in pass-throughs (§6).
4. **Persistent data:** the `/data` volume is untouched:
   - `settings.json`
   - `data-<network>/db` (its existence is the checkpoint-sync guard)
   - `keymanagertoken` (never rotated)
   - validator keys, secrets and slashing DB (reached only through the keymanager API)
5. **`settings.json` writes:** always full-object writes, because the backend overwrites the file. The UI therefore does read-modify-write:
   - It GETs the current file right before saving.
   - It changes only the fields the user edited.
   - It keeps every field it doesn't know, and POSTs the whole object.
   - Old files that lack a field still load, with defaults shown but not written until the user saves.
6. **DAPPMANAGER contracts:**
   - WAMP at `ws://wamp.my.ava.do:8080/ws`, realm `dappnode_admin`.
   - Procedures `listPackages` and `logPackage` with the `{success, result}` JSON envelope.
7. **No stale UI after an update:** `index.html` is served no-cache and assets are content-hashed.
8. **Safe rollback:** UI releases never change the client binary version in the same release, so installing the previous version remains a safe rollback. Client-version upgrades (such as Lighthouse) ship as separate releases with their own upgrade test.
9. **Upgrade test on the test box before any store release:**
   - Install the version users run, import inactive keys, set a fee recipient and settings.
   - Update to the new version, then check:
     - same keys in the keymanager list
     - validator process running
     - `settings.json` identical apart from deliberate edits
     - slashing DB and `keymanagertoken` unchanged (checksums)
     - Admin chain strip, Rocket Pool assumptions and Prometheus scrape still OK
   - Then roll back to the previous version and check again.
   - Staging store first; production only when the owner says so.

## 3. Architecture

- **This repo:** Vite, React 18, TypeScript, Tailwind 3, Vitest and Testing Library. Tokens are copied from `DNP_ADMIN/build/src/src/theme.css`. Yarn 1 with a committed `yarn.lock` and `--frozen-lockfile`.
- **Output:** a static SPA (`dist/`) that works from any path.
- **Runtime client config:**
  - The SPA loads `./client-config.json` (served next to `index.html`), with this shape:
    `{ client: "nimbus"|"teku"|"prysm"|"lighthouse", network, packageName, apiUrl, backend: "deno"|"monitor", features: {...} }`
  - Each client's Dockerfile writes this file at image build time from its `NETWORK` build arg.
  - The same UI build therefore serves every client and network.
- **Consumption:**
  - Each client Dockerfile has a builder stage that clones this repo at a pinned tag (`ARG CLIENT_UI_VERSION`), then runs `yarn install --frozen-lockfile && yarn build`.
  - It copies `dist/` to the directory the existing static server serves (`/usr/local/wizard`).
- **Adapters:** `src/api/` has:
  - one typed client for the package backend
  - one for the beacon REST API (through `/rest`)
  - one for the keymanager API (through `/keymanager`)
  - one for DAPPMANAGER over WAMP

  The backend differences between `deno` (Nimbus, Lighthouse) and `monitor` (Teku, Prysm) sit behind one interface, selected by `backend`. Feature flags come from `features`.
- **Polling:** one hook that pauses when the tab is hidden and backs off after errors. Defaults:
  - node status: 12 s
  - validators: 60 s
  - service status and logs: 5 s, only while that view is open

## 4. UI (Nimbus scope; the shell is shared)

Layout matches the Admin: a sidebar with the client identity, and a footer with the theme and mode toggles. On phones the sidebar collapses to a top bar.

- **Status strip:**
  - health shown in plain words (synced, syncing with %, not ready)
  - peers and client version
  - Advanced adds inbound/outbound peers and head slot
- **Problems banners:**
  - no default fee recipient
  - no execution client installed or reachable
  - testnet notice
  - wrong configuration

  Each banner has a fix button.
- **Validators (home):**
  - Empty state with a clear "Add validators" call to action.
  - Table (cards on phones) showing:
    - status in plain words
    - balance and effective balance
    - fee recipient (default or override)
    - withdrawal credentials state (0x00 needs update; 0x01/0x02 set)
  - A link to beaconcha.in for each validator.
- **Validator actions:**
  - Set or clear the fee-recipient override.
  - Remove, which automatically downloads the slashing-protection export and asks for confirmation.
  - Voluntary exit, a guarded flow that requires typing to confirm and shows the irreversible warning.
- **Add validators:**
  - Drag-and-drop one or many keystore files, with the password (one for all, or one per file).
  - Optional slashing-protection file.
  - Per-key result: imported, duplicate or error.
- **Settings (full-object read-modify-write):**
  - Default fee recipient.
  - Graffiti (max 32 bytes).
  - Execution client: candidates per network, marked installed or not installed.
  - MEV-Boost toggle, enabled only when the MEV-Boost package is installed.
  - Advanced adds the peer limit and the checkpoint-sync URL.
  - Saving tells the user the client restarts and roughly how long it takes.
- **Advanced:** service start/stop/restart with a confirmation, process status, and live logs.

Removed: the Rocket Pool lookup (beaconcha.in API needs a key and fails with 401), `/checksync`, `/welcome`, and the dead WAMP helpers.

## 5. Visual system

Same tokens and components as the Admin: Button, Card, StatusPill, Badge, Modal, Input, Tabs and Table. AA contrast in both themes, visible focus, reduced motion respected, sentence case. Theme and mode are stored per origin in localStorage. The theme defaults to match computer and the mode defaults to Simple.

## 6. Client-package changes (Nimbus release 0.0.51)

- The Dockerfile builds the shared UI instead of `build/wizard`, and `build/wizard` is deleted. It writes `client-config.json`.
- `wizard-server.ts` serves any existing file under the web root (hashed assets, fonts, `client-config.json`) and falls back to `index.html`. `index.html` stays no-cache.
- `server.ts` loses the two beaconcha.in/checkpointz pass-through routes. Nothing else changes.
- The version bumps to 0.0.51. `NIMBUS_VERSION` is unchanged (v26.8.0). Only the mainnet package is released. The Holesky and Prater variants are not released (their networks are sunset).

## 7. Quick fixes shipped in parallel

Teku and the Prysm beacon chain drop the Rocket Pool beaconcha.in lookup: the `RocketPoolLink` component and the monitor proxy/logging that only served it. This stops the 401 log spam. Each ships as a small release with no other change.

## 8. Testing

- **Unit and component tests (Vitest):**
  - settings read-modify-write keeps unknown fields
  - the adapter shapes
  - validator status mapping (0x00/0x01/0x02)
  - add-validator result tallies
  - banner conditions
  - polling pause
- **Contrast tests** for the tokens in both themes.
- **The upgrade test from §2.9** on the box.
