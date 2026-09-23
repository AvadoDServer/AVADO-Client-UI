# AVADO Client UI

One web UI for every AVADO consensus-client package (Nimbus first, then Teku,
Prysm and Lighthouse). It looks and behaves like the AVADO Admin: the same
tokens, Sen and Public Sans, light/dark/match-computer themes, and Simple and
Advanced modes.

Spec: [`docs/specs/2026-09-23-shared-client-ui-design.md`](docs/specs/2026-09-23-shared-client-ui-design.md).
Plan: [`docs/plans/2026-09-23-shared-client-ui-nimbus.md`](docs/plans/2026-09-23-shared-client-ui-nimbus.md).

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
