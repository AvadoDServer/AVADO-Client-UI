# AVADO Client UI

One web UI for every AVADO consensus-client package (Nimbus first, then Teku,
Prysm and Lighthouse). It looks and behaves like the AVADO Admin: the same
tokens, Sen and Public Sans, light/dark/match-computer themes, and Simple and
Advanced modes.

## Develop

Yarn 1 only (never npm), Node 20.

```sh
yarn install --frozen-lockfile
VITE_MOCK=1 yarn dev   # in-memory mock API: validators, settings, logs
yarn test              # Vitest + Testing Library
yarn lint              # tsc --noEmit + eslint, 0 errors, 0 warnings
yarn build             # static SPA in dist/, works from any path
```

With `VITE_MOCK=1` every adapter comes from `src/api/mock.ts`: five
validators (0x01, 0x02, 0x00 credentials, one queued for activation, one the
beacon node does not know yet), Nimbus-schema settings, a running
supervisord, installed packages and log lines. In the mock, an import password
of `wrong` (or empty) gives an error result.

## Apps

The repo builds three apps on the same design system:

| App | Entry | Build | Output |
| --- | --- | --- | --- |
| Client UI (Nimbus, Teku, Prysm, Lighthouse) | `index.html` → `src/main.tsx` | `yarn build` | `dist/` |
| Rocket Pool | `src/apps/rocketpool/index.html` → `main.tsx` | `yarn build:rocketpool` | `dist-rocketpool/` |
| Qtum Staking | `src/apps/qtum/index.html` → `main.tsx` | `yarn build:qtum` | `dist-qtum/` |

`VITE_MOCK=1 yarn dev:rocketpool` runs the Rocket Pool app on its in-memory
adapters (`src/apps/rocketpool/api/mock.ts`) with a demo node from
`src/apps/rocketpool/api/fixtures.ts`: add `?scenario=minipool`, `mixed`
(the default), `fresh` (no wallet), `wallet-found` (no wallet where the app
looks, but two copies found elsewhere on the AVADO), `unregistered` (wallet, not registered),
`new-node` (registered, no validators), `keys-attention` (every key-check
state), `daemon-failed` or `exits` (a minipool ready to close, megapool
validators exiting, a debt, a refund, credit and unstaking RPL) to the
address, e.g. `http://localhost:5173/?scenario=fresh#/setup`. In `fresh`,
creating or restoring a wallet leads on to `unregistered`, and registering
that leads on to `new-node`, so the whole setup wizard can be walked through.
In `wallet-found`, "Use this wallet" leads on to `minipool` (the backup with
validator keys) or `unregistered` (the old folder). Its own Vite and Tailwind
configs (`vite.rocketpool.config.ts`, `tailwind.rocketpool.config.ts`) keep
it out of the client build: `tailwind.config.ts` skips `src/apps/**`, so
`dist/` is the same with or without it. All apps use the shared shell
(`src/components/shell/ShellFrame.tsx`: sidebar, top bar, drawer, banners)
with their own identity and pages.

The Qtum Staking app is the Qtum package's page (`qtum.my.ava.do`). It talks
to the package's monitor (`/monitor/*`) and to the Qtum node's JSON-RPC
through the package's nginx (`/rpc`, same origin only; nginx adds the RPC
password). Home shows the wallet, whether it stakes (and why not) and the
rewards; Wallet has the addresses, unlocking a wallet with a password for
staking, the backup download and restore; Settings the delegation fee and
minimum and a node restart; Advanced (Advanced mode) private keys, key
import, the node log and the Qtum Web Wallet link. The wallet banners
(upgrade, rebuild, restore, fresh backup) keep the old wizard's wording.
`VITE_MOCK=1 yarn dev:qtum` runs it on its in-memory package
(`src/apps/qtum/api/mock.ts`, scenarios in `src/apps/qtum/api/fixtures.ts`):
add `?scenario=staking` (the default), `fresh` (the node starting),
`syncing`, `locked` (a wallet with a password; the demo password is
`demo password`), `upgrade-failed`, `needs-password`, `rebuilding`,
`rebuilt`, `restoring` or `backup-required` to the address, e.g.
`http://localhost:5173/?scenario=upgrade-failed#/`. Wallet tasks started in
the demo (retry, rebuild, restore, key import, restart) finish by themselves
after 4 seconds. Like the Rocket Pool app it has its own Vite and Tailwind
configs (`vite.qtum.config.ts`, `tailwind.qtum.config.ts`), so `dist/` is the
same with or without it.

## Runtime config

The SPA reads `/client-config.json`, served next to `index.html` at the web
root of the package host (the build uses an absolute `base: "/"`, so deep
links like `/settings/` load too). Each
client package's Dockerfile writes it at image build time:

```json
{
  "client": "nimbus",
  "network": "mainnet",
  "packageName": "nimbus.avado.dnp.dappnode.eth",
  "apiUrl": "http://nimbus.my.ava.do:9999",
  "backend": "deno",
  "features": { "batchImport": true, "backup": false, "zeroSync": false }
}
```

- `client`: `nimbus` | `teku` | `prysm` | `lighthouse`
- `network`: `mainnet` | `holesky` | `prater` | `gnosis` | `hoodi`
- `backend`: `deno` (Nimbus, Lighthouse) or `monitor` (Teku, Prysm)

Every field is optional except `client` and `network`. Missing ones come
from `client` and `network` via the package prefix: `<client>` on mainnet,
`<client>-<network>` elsewhere, and always `prysm-beacon-chain-<network>`
for Prysm (mainnet included). `packageName = <prefix>.avado.dnp.dappnode.eth`,
`apiUrl = http://<prefix>.my.ava.do:9999`. If the file is missing, the UI
guesses from the hostname (`teku-holesky.my.ava.do`), then falls back to
Nimbus on mainnet.

`useClientConfigStatus()` returns `{config, source, problems}`: `source` is
`file`, `hostname` or `default`, and `problems` lists every missing file,
unknown client or network and invalid field. The shell shows a "wrong
configuration" banner when `problems` is not empty. `useClientConfig()`
returns just the config.

`public/client-config.json` is a dev sample; the build removes it from
`dist/` so a package can't ship it by accident.

## Use in a client package

In the client Dockerfile, a builder stage clones this repo at a pinned tag
(`ARG CLIENT_UI_VERSION`), runs `yarn install --frozen-lockfile && yarn
build`, and copies `dist/` into the directory the package's static server
serves (`/usr/local/wizard`), then writes `client-config.json` there.
Serve `index.html` with `Cache-Control: no-cache`; assets are content-hashed.

## Layout

- `src/theme.css`: design tokens copied from the Admin (keep in sync by hand).
  `src/theme/__tests__/contrast.test.ts` checks AA contrast in both themes.
- `src/components/ui/`: the UI kit ported from the Admin (Button, Card,
  StatusPill, Badge, Modal, ConfirmDialog, Input/Select, Tabs, Table,
  Spinner, Skeleton, `cn`). Tokens only, no raw hex.
- `src/theme/ThemeProvider.tsx` (`avado.theme` in localStorage) and
  `src/settings/ModeProvider.tsx` (`avado.mode`, default simple).
- `src/config/`: `loadClientConfig()`, `loadClientConfigResult()`, `ClientConfigProvider`,
  `useClientConfig()`, `useClientConfigStatus()`.
- `src/api/types.ts`: adapter interfaces; `src/api/ApiProvider.tsx`:
  `ApiProvider` and `useApi()`; `src/api/mock.ts`: in-memory adapters.
