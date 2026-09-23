# Shared client UI — Nimbus first — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the shared AVADO client UI in this repo and ship it in Nimbus 0.0.51. Existing Nimbus users update with no action and nothing breaks. Remove the Rocket Pool beaconcha.in lookup from Teku and Prysm.

**Architecture:** A Vite React TypeScript SPA configured at runtime by `client-config.json`. Typed adapters for the package backend (deno or monitor), beacon REST, keymanager and DAPPMANAGER WAMP. Client packages keep their backends and build this UI at a pinned tag.

**Tech stack:**
- Vite 5, React 18, TypeScript 5, Tailwind 3.4, react-router-dom 6 (HashRouter)
- Vitest 2 with Testing Library and jsdom
- autobahn-browser for WAMP
- Yarn 1 with a frozen lockfile

**Spec:** `docs/specs/2026-09-23-shared-client-ui-design.md`. It is the binding authority. Read §2, the migration contract, first.

## Global constraints

- Node 20 LTS (`node:20-bookworm-slim` in client Dockerfiles). Yarn 1 (`yarn install --frozen-lockfile`); never npm.
- Tokens only: no raw hex in components. Copy the token set, fonts and component look from `/Users/flisko/Documents/GitHub/DNP_ADMIN/build/src/src/theme.css`, `tailwind.config.js` and `components/ui/*`.
- AA contrast in both themes. Sentence case, plain verbs. Visible focus. Reduced motion respected.
- Commit trailer, exactly: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Settings are always read-modify-write with full-object POST, preserving unknown fields (spec §2.5).
- Never call beaconcha.in APIs; links to beaconcha.in pages are fine.
- `yarn test`, `yarn lint` (tsc --noEmit plus eslint, 0 errors) and `yarn build` pass before each commit.

## Review focus

1. An old `settings.json` missing fields (for example no `mev_boost` or `execution_engine`): it loads, and saving one field doesn't drop the others.
2. Keymanager or beacon REST unreachable while Nimbus restarts: the UI shows "Nimbus is starting", doesn't blank or crash, and recovers without a reload.
3. A validator that the beacon node doesn't know yet (404 from `/states/head/validators/:pk`) shows "Waiting for deposit / pending", not an error.
4. Batch import with a wrong password for some files: the per-file results are right and the successes are not rolled back.
5. Phone width 360 px: no horizontal page scroll, and the table becomes cards.

---

### Task 1: Scaffold, design system, config and API interfaces (this repo)

**Files:** repo root (`package.json`, `yarn.lock`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.js`, `.eslintrc.cjs`, `index.html`), `src/main.tsx`, `src/App.tsx`, `src/theme.css`, `src/theme/ThemeProvider.tsx`, `src/settings/ModeProvider.tsx`, `src/components/ui/*.tsx`, `src/config/clientConfig.ts`, `src/api/types.ts`, `src/api/mock.ts`, `public/client-config.json` (dev sample), `README.md`.

**Produces (later tasks rely on these exact names):**
- `loadClientConfig(): Promise<ClientConfig>`
  - `ClientConfig = { client: "nimbus"|"teku"|"prysm"|"lighthouse"; network: "mainnet"|"holesky"|"prater"|"gnosis"|"hoodi"; packageName: string; apiUrl: string; backend: "deno"|"monitor"; features: { batchImport: boolean; backup: boolean; zeroSync: boolean } }`
  - Missing fields fall back to defaults derived from `client` and `network`: `apiUrl = http://<client>[-<network>].my.ava.do:9999` unless mainnet, and `packageName = <client>[-<network>].avado.dnp.dappnode.eth`.
  - Provided via `ClientConfigProvider` and `useClientConfig()`.
- `src/api/types.ts` interfaces:
  - `PackageBackend { getSettings(): Promise<Settings>; saveSettings(s: Settings): Promise<void>; getDefaultSettings(): Promise<Settings>; service(action: "start"|"stop"|"restart"): Promise<void>; serviceStatus(): Promise<ProcessInfo[]> }`
  - `BeaconApi { health(): Promise<"ready"|"syncing"|"not_ready">; syncing(); peerCount(); peers(); version(); validator(pubkey): Promise<ValidatorState|null>; submitVoluntaryExit(msg) }`
  - `KeymanagerApi { listKeystores(); importKeystores({keystores, passwords, slashing_protection?}); deleteKeystores(pubkeys); getFeeRecipient(pk); setFeeRecipient(pk, addr); deleteFeeRecipient(pk); signVoluntaryExit(pk) }`
  - `DappManager { listPackages(): Promise<string[]>; logs(pkg, tail): Promise<string> }`
  - `Settings` = the Nimbus schema from the spec, plus an index signature for unknown fields.
- `ApiProvider` and `useApi(): { backend, beacon, keymanager, dappmanager }`. Task 1 wires `src/api/mock.ts` implementations when `import.meta.env.VITE_MOCK === "1"`; Task 2 adds the real ones.
- UI kit ported to TSX from the Admin: `Button` (variants primary/secondary/danger/ghost, `as`), `Card`, `StatusPill`, `Badge`, `Modal`, `ConfirmDialog`, `Input`, `Tabs`, `Table`, `Spinner`, `Skeleton`, `cn`.
- `ThemeProvider` exposes `{theme, preference, setPreference}` with `light|dark|system`, stored in localStorage `avado.theme`. `ModeProvider` exposes `{mode, setMode, isAdvanced}`, stored in `avado.mode`, default simple.
- A token contrast test like the Admin's.
- **Steps:**
  - [ ] Scaffold and install with Yarn 1.
  - [ ] Port the tokens and components, with tests.
  - [ ] Config loader, with tests for defaults and a missing file.
  - [ ] Types and mocks.
  - [ ] `yarn test`, `yarn lint` and `yarn build` green.
  - [ ] Commit.

### Task 2: Real adapters and polling (depends on Task 1)

**Files:** `src/api/backend.ts` (deno and monitor), `src/api/beacon.ts`, `src/api/keymanager.ts`, `src/api/dappmanager.ts` (autobahn-browser, WAMP `listPackages.dappmanager.dnp.dappnode.eth` and `logPackage.dappmanager.dnp.dappnode.eth` `{id, options:{tail}}`, `JSON.parse` then `{success, result}`), `src/api/settings.ts` (`saveSettingsMerged(backend, patch)`: GET, merge the patch, then POST the full object), `src/hooks/usePoll.ts` (pauses on `document.hidden`, backs off after errors, exposes `{data, error, loading, refresh}`), and tests with mocked fetch.

Endpoints follow spec §2 and `~/Documents/AVADO-reports/nimbus.md` §3–4. Keymanager calls go to `${apiUrl}/keymanager/eth/v1/...`, beacon calls to `${apiUrl}/rest/eth/v1/...`.

For monitor backends (Teku and Prysm), the shapes differ: see `~/Documents/AVADO-reports/teku-prysm-beacon.md` §1.1. Implement them now; they're tested later with those clients.

### Task 3: App shell, status strip, banners, routing (depends on Task 1)

**Files:** `src/App.tsx` routes, `src/components/shell/{Sidebar,SidebarFooter,TopBar,StatusStrip,Banners}.tsx`, `src/pages/NotFound.tsx`.

- Routes are `/` (validators), `/add`, `/settings` and `/advanced`, the last hidden from Simple nav.
- The status strip uses `usePoll` against the beacon API (spec §4).
- Banner rules (fee recipient empty; no execution client installed, matched by package name candidates per network; testnet; unknown network) each have a fix link.
- Client identity: logo per client from `src/assets/clients/`. Use the logos from `AVADO-DNP-Nimbus/build/wizard/src/assets`, recoloured only when needed.
- Tests cover the banner rules and Simple vs Advanced nav.

### Task 4: Validators, add validators, actions (depends on Task 1)

**Files:** `src/pages/validators/{ValidatorsPage,ValidatorRow,ValidatorCard,FeeRecipientDialog,RemoveDialog,ExitDialog,statusText}.tsx|ts`, `src/pages/add/AddValidatorsPage.tsx`.

- `statusText` maps beacon statuses to plain words, and withdrawal credentials 0x00/0x01/0x02 to "Needs a withdrawal address" or "Withdrawal address set".
- A beacon 404 maps to "Waiting for deposit".
- Remove downloads `slashing_protection` as `slashing-protection-<pk8>.json` before confirming success.
- Exit requires typing the validator index to confirm, then signs through the keymanager and submits through beacon.
- Import supports multiple files (drag and drop), one password for all or one per file, and optional slashing protection. It shows per-file results.
- Tests cover the Review focus items 3 and 4.

### Task 5: Settings (depends on Task 1)

**File:** `src/pages/settings/SettingsPage.tsx`.

- The form fields are listed in spec §4.
- Execution-client candidates per network come from `src/config/executionClients.ts`. The list must match `AVADO-DNP-Nimbus/build/startNimbus.sh:19-35`.
- MEV-Boost is enabled only when `mevboost.avado.dnp.dappnode.eth` is installed.
- Validation:
  - fee recipient `^0x[a-fA-F0-9]{40}$`
  - graffiti ≤ 32 bytes (UTF-8)
  - peers a positive integer
  - URL valid
- Save uses `saveSettingsMerged` with only the changed fields, then shows the restart message.
- Tests cover Review focus item 1 and validation.

### Task 6: Advanced page (depends on Task 1)

**File:** `src/pages/advanced/AdvancedPage.tsx`.

- Service start, stop and restart, with a confirm on stop.
- Process status table.
- Logs through DAPPMANAGER (5 s poll, only while open; ANSI rendered via `ansi_up` with escaping).
- A link to the Admin package page, `http://my.ava.do/#/packages/<packageName>`.
- Tests.

### Task 7: Nimbus package integration (repo `AVADO-DNP-Nimbus`, branch `client-ui`; depends on Tasks 1–6 being merged and tagged `v0.1.0`)

- `build/Dockerfile`:
  - Replace the wizard builder with `FROM node:20-bookworm-slim AS ui`, `ARG CLIENT_UI_VERSION=v0.1.0`, `git clone --depth 1 --branch $CLIENT_UI_VERSION https://github.com/AvadoDServer/AVADO-Client-UI`, then `yarn install --frozen-lockfile && yarn build`.
  - `COPY --from=ui /ui/dist /usr/local/wizard`.
  - Write `/usr/local/wizard/client-config.json` from `NETWORK` (`{"client":"nimbus","network":"$NETWORK","backend":"deno","features":{"batchImport":true,"backup":false,"zeroSync":false}}`).
- `build/wizard-server/wizard-server.ts`: serve any existing file under the root, fall back to `index.html`, keep `index.html` no-cache, and set long cache on `/assets/*`.
- `build/server/server.ts`: delete the checkpointz and beaconcha.in pass-through routes (lines ~108-127). Nothing else changes.
- Delete `build/wizard/`.
- Bump the version to 0.0.51 in `dappnode_package.json`, `dappnode_package-mainnet.json` and `build/docker-compose.yml`. `NIMBUS_VERSION` is unchanged.
- Local `docker build` must succeed.

### Task 8: Teku, remove the Rocket Pool lookup (repo `AVADO-DNP-Teku`, branch `drop-rp-lookup`; independent)

- Delete `build/wizard/src/components/shared/RocketPoolLink.tsx` and its mount.
- In `build/monitor/server.ts`, remove the beaconcha.in wildcard proxy routes, but only if nothing else uses them (grep; `CheckCheckPointSync` may). If something does, keep them but stop logging full axios errors (log one line: URL and status).
- Bump the version by a patch; the Teku binary is unchanged.
- Wizard and monitor builds pass.

### Task 9: Prysm beacon chain, remove the Rocket Pool lookup (repo `AVADO-DNP-Prysm-beacon-chain`, branch `drop-rp-lookup`; independent)

The same as Task 8 for that repo. The `RocketPoolLink` there calls beaconcha.in from the browser, and the monitor's `get()` logs full axios errors: make that a one-line log.

### Task 10: Box upgrade test and release (controller)

- Spec §2.9 on the test box (`ssh avado@10.10.10.2`).
- Release Nimbus 0.0.51, Teku and Prysm via PR → CI → merge, as for the other AVADO packages.
- Install the new versions on the test box through the IPFS hash.
