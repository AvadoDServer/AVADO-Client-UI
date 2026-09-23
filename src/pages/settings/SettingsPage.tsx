import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useApi } from "../../api/ApiProvider";
import type { Settings } from "../../api/types";
import { Badge, Button, Card, CardDescription, CardHeader, CardTitle, Input, Skeleton } from "../../components/ui";
import type { ClientName } from "../../config/clientConfig";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { executionClientsForNetwork } from "../../config/executionClients";
import { useMode } from "../../settings/ModeProvider";
import { ExecutionClientField } from "./ExecutionClientField";
import { buildPatch, graffitiByteLength, toFormState, validateForm, type SettingsFormErrors, type SettingsFormState } from "./formState";
import { saveSettingsMerged } from "./saveMerged";

const MEVBOOST_PACKAGE = "mevboost.avado.dnp.dappnode.eth";

const CLIENT_LABEL: Record<ClientName, string> = {
  nimbus: "Nimbus",
  teku: "Teku",
  prysm: "Prysm",
  lighthouse: "Lighthouse",
};

const FIELD_LABELS: Record<keyof SettingsFormErrors, string> = {
  feeRecipient: "Default fee recipient",
  graffiti: "Graffiti",
  peerLimit: "Peer limit",
  checkpointUrl: "Checkpoint sync URL",
};

type SaveState = "idle" | "saving" | "saved" | "error";

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function focusField(ref: RefObject<HTMLInputElement>) {
  ref.current?.focus();
  // Not every environment implements scrollIntoView (e.g. jsdom in tests); focus() alone still works.
  ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

/**
 * Settings page (spec §4): default fee recipient, graffiti, execution
 * client, MEV-Boost, and — in Advanced mode — the peer limit and
 * checkpoint-sync URL. Saves with `saveSettingsMerged`, sending only the
 * fields the owner changed and keeping every field this page doesn't know
 * about (spec §2.5).
 */
export default function SettingsPage() {
  const api = useApi();
  const { client, network } = useClientConfig();
  const { isAdvanced } = useMode();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [installedPackages, setInstalledPackages] = useState<string[] | null>(null);
  const [packagesError, setPackagesError] = useState<string | null>(null);

  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const feeRecipientRef = useRef<HTMLInputElement>(null);
  const graffitiRef = useRef<HTMLInputElement>(null);
  const peerLimitRef = useRef<HTMLInputElement>(null);
  const checkpointUrlRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<keyof SettingsFormErrors, RefObject<HTMLInputElement>> = {
    feeRecipient: feeRecipientRef,
    graffiti: graffitiRef,
    peerLimit: peerLimitRef,
    checkpointUrl: checkpointUrlRef,
  };

  useEffect(() => {
    let cancelled = false;

    api.backend
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setForm(toFormState(s));
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorMessage(e));
      });

    api.backend
      .getDefaultSettings()
      .then((s) => {
        if (!cancelled) setDefaults(s);
      })
      .catch(() => {
        /* hint text just won't show a default; not fatal */
      });

    api.dappmanager
      .listPackages()
      .then((pkgs) => {
        if (!cancelled) {
          setInstalledPackages(pkgs);
          setPackagesError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          // Safe default: nothing shows as installed rather than the page hanging on "Checking…" forever.
          setInstalledPackages([]);
          setPackagesError(errorMessage(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const baseline = useMemo(() => (settings ? toFormState(settings) : null), [settings]);

  // Peer limit and checkpoint URL are only rendered (and editable) in Advanced
  // mode. The instant Advanced mode is left, discard any edit to just those
  // two fields back to `baseline` — otherwise a still-invalid value typed
  // right before switching to Simple mode would sit in `form`, off-screen,
  // indefinitely blocking Save with no visible reason (and, before this
  // fix, could reach a save at all once validation stopped checking a field
  // it could no longer see).
  const wasAdvancedRef = useRef(isAdvanced);
  useEffect(() => {
    if (wasAdvancedRef.current && !isAdvanced) {
      setForm((f) => (f && baseline ? { ...f, peerLimit: baseline.peerLimit, checkpointUrl: baseline.checkpointUrl } : f));
    }
    wasAdvancedRef.current = isAdvanced;
  }, [isAdvanced, baseline]);

  const patch = useMemo(() => (form && baseline ? buildPatch(form, baseline) : {}), [form, baseline]);
  const dirty = Object.keys(patch).length > 0;
  // Validated against `baseline`, not against the current mode: a field is
  // only checked once the owner has actually edited it away from what's on
  // the box (see `validateForm`'s doc comment for why that's the fix for
  // both the mode-switch hole and the "missing from an old file" ruling).
  const errors = useMemo(() => (form && baseline ? validateForm(form, baseline) : {}), [form, baseline]);
  const errorFields = Object.keys(errors) as (keyof SettingsFormErrors)[];
  const hasErrors = errorFields.length > 0;

  const candidates = useMemo(() => executionClientsForNetwork(network), [network]);
  const clientLabel = CLIENT_LABEL[client];
  const mevBoostInstalled = (installedPackages ?? []).includes(MEVBOOST_PACKAGE);
  // Losing the package must not strand the toggle on: turning it off is
  // always allowed, only turning it on requires the package.
  const mevBoostDisabled = !mevBoostInstalled && !form?.mevBoost;
  const showMevBoost = network !== "gnosis";

  async function handleSave() {
    if (!settings || !form || !baseline || hasErrors || !dirty) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveSettingsMerged(api.backend, patch);
      // Re-derive the baseline through toFormState so it's byte-for-byte what
      // the form would show on a fresh load (e.g. "007" typed into the peer
      // limit reads back as "7"), instead of leaving `form` and `settings`
      // to drift apart and show a phantom "unsaved changes" after a save.
      const nextSettings: Settings = { ...settings, ...patch };
      setSettings(nextSettings);
      setForm(toFormState(nextSettings));
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(errorMessage(e));
    }
  }

  function handleRevert() {
    if (!baseline) return;
    setForm(baseline);
    setSaveState("idle");
    setSaveError(null);
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Settings</h1>
        <Card>
          <CardTitle>Settings could not be loaded</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </Card>
      </div>
    );
  }

  if (!form || !baseline) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Settings</h1>
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Settings</h1>
        {dirty && <Badge variant="warning">Unsaved changes</Badge>}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Default fee recipient</CardTitle>
            <CardDescription>
              Validators use this address unless it's overridden for an individual validator on the Validators page.
            </CardDescription>
          </div>
        </CardHeader>
        <Input
          ref={feeRecipientRef}
          label="Default fee recipient"
          value={form.feeRecipient}
          onChange={(e) => setForm({ ...form, feeRecipient: e.target.value })}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          error={errors.feeRecipient}
        />
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Graffiti</CardTitle>
            <CardDescription>Shown next to the blocks {clientLabel} proposes.</CardDescription>
          </div>
        </CardHeader>
        <Input
          ref={graffitiRef}
          label="Graffiti"
          value={form.graffiti}
          onChange={(e) => setForm({ ...form, graffiti: e.target.value })}
          placeholder={`Avado ${clientLabel}`}
          error={errors.graffiti}
          hint={errors.graffiti ? undefined : `${graffitiByteLength(form.graffiti)}/32 bytes`}
        />
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Execution client</CardTitle>
            <CardDescription>{clientLabel} needs an execution client to talk to.</CardDescription>
          </div>
        </CardHeader>
        {packagesError && (
          <p className="mb-3 text-xs text-fg-muted">
            Could not check which packages are installed ({packagesError}); assuming none are.
          </p>
        )}
        <ExecutionClientField
          candidates={candidates}
          value={form.executionEngine}
          installedPackages={installedPackages}
          onChange={(packageName) => setForm({ ...form, executionEngine: packageName })}
        />
      </Card>

      {showMevBoost && (
        <Card>
          <CardHeader>
            <CardTitle>MEV-Boost</CardTitle>
          </CardHeader>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.mevBoost}
              disabled={mevBoostDisabled}
              onChange={(e) => setForm({ ...form, mevBoost: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-border accent-accent disabled:cursor-not-allowed"
            />
            <span>
              <span className="block text-sm font-medium text-fg">Enable MEV-Boost</span>
              <span className="block text-xs text-fg-muted">Lets {clientLabel} build blocks through MEV-Boost for extra rewards.</span>
            </span>
          </label>
          {mevBoostDisabled && (
            <p className="mt-2 text-xs text-fg-muted">
              <a className="text-accent hover:underline" href="http://my.ava.do/#/installer">
                Install the MEV-Boost package
              </a>{" "}
              to enable this option.
            </p>
          )}
          {!mevBoostInstalled && form.mevBoost && (
            <p className="mt-2 text-xs text-warning-text">
              The MEV-Boost package is no longer installed. Turn this off, or reinstall it.
            </p>
          )}
        </Card>
      )}

      {isAdvanced && (
        <Card>
          <CardHeader>
            <CardTitle>Advanced</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-5">
            <Input
              ref={peerLimitRef}
              label="Peer limit"
              value={form.peerLimit}
              onChange={(e) => setForm({ ...form, peerLimit: e.target.value })}
              inputMode="numeric"
              error={errors.peerLimit}
              hint={
                errors.peerLimit
                  ? undefined
                  : `${clientLabel} refuses new peers past this count.${
                      typeof defaults?.p2p_peer_upper_bound === "number" ? ` The default is ${defaults.p2p_peer_upper_bound}.` : ""
                    }`
              }
            />
            <Input
              ref={checkpointUrlRef}
              label="Checkpoint sync URL"
              value={form.checkpointUrl}
              onChange={(e) => setForm({ ...form, checkpointUrl: e.target.value })}
              placeholder="https://…"
              spellCheck={false}
              autoComplete="off"
              error={errors.checkpointUrl}
              hint={
                errors.checkpointUrl
                  ? undefined
                  : "Used once, the first time this package starts, to sync from a recent checkpoint instead of genesis. Changing it later has no effect."
              }
            />
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!dirty || hasErrors}
          loading={saveState === "saving"}
          aria-describedby={hasErrors ? "settings-fix-fields" : undefined}
        >
          Save changes
        </Button>
        <Button variant="secondary" onClick={handleRevert} disabled={!dirty || saveState === "saving"}>
          Revert changes
        </Button>
      </div>

      {hasErrors && (
        // A field-level error can be scrolled out of view (e.g. the fee
        // recipient, while the owner is down at the MEV-Boost card), so this
        // names every blocking field again right next to the button that's
        // disabled because of it, with a link that jumps straight to each one.
        <p id="settings-fix-fields" className="text-sm text-danger-text">
          Fix the highlighted fields to save:{" "}
          {errorFields.map((key, i) => (
            <span key={key}>
              {i > 0 && ", "}
              <button
                type="button"
                onClick={() => focusField(fieldRefs[key])}
                className="underline underline-offset-2 hover:text-danger"
              >
                {FIELD_LABELS[key]}
              </button>
            </span>
          ))}
          .
        </p>
      )}

      {saveState === "saved" && (
        <p role="status" className="text-sm text-success-text">
          Settings saved. {clientLabel} is restarting to use them — this is usually under a minute, longer if it has to find the
          execution client again.
        </p>
      )}
      {saveState === "error" && (
        <p role="alert" className="text-sm text-danger-text">
          Could not save settings{saveError ? `: ${saveError}` : "."}
        </p>
      )}
    </div>
  );
}
