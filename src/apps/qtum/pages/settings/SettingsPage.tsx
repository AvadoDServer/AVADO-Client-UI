import { useEffect, useState, type FormEvent } from "react";
import { Button, ConfirmDialog, Input } from "../../../../components/ui";
import { isQtumApiError, plainError } from "../../api/errors";
import { useQtumApi } from "../../api/QtumApiProvider";
import { LoadingLines, Notice, PageHeader, SectionCard, TechDetails } from "../../components/common";
import { useAppStatus } from "../../status/AppStatus";
import { changes, formFrom, validate, type DelegationForm } from "./form";

type Outcome = { tone: "success" | "danger" | "accent"; text: string; error?: unknown } | null;

const saveError = (err: unknown) => (isQtumApiError(err) && err.kind === "http" && err.detail ? err.detail : `The settings could not be saved. ${plainError(err)}`);

function Delegation() {
  const api = useQtumApi();
  const { settings, refreshSettings, refreshWallet } = useAppStatus();
  const [form, setForm] = useState<DelegationForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  // Fill the form from the saved settings until the owner starts typing.
  useEffect(() => {
    if (settings && !dirty) setForm(formFrom(settings));
  }, [settings, dirty]);

  const errors = form ? validate(form) : {};
  const patch = form && settings && !errors.fee && !errors.min ? changes(form, settings) : {};
  const nothingToSave = Object.keys(patch).length === 0;

  const edit = (field: keyof DelegationForm, value: string) => {
    setDirty(true);
    setOutcome(null);
    setForm((f) => (f ? { ...f, [field]: value } : f));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || errors.fee || errors.min || nothingToSave) return;
    setWorking(true);
    setOutcome(null);
    try {
      await api.saveSettings(patch);
      setDirty(false);
      setOutcome({ tone: "success", text: "Saved. The Qtum node restarts with the new settings; staking pauses for a few minutes." });
      await Promise.all([refreshSettings(), refreshWallet()]);
    } catch (error) {
      setOutcome({ tone: "danger", text: saveError(error), error });
    } finally {
      setWorking(false);
    }
  };

  return (
    <SectionCard
      title="Delegation"
      description="Other Qtum holders can let your node stake their coins for them (offline staking). Your node keeps this fee from the rewards it earns for them."
      testId="delegation"
    >
      {!form ? (
        <LoadingLines />
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Delegation fee (%)"
              inputMode="numeric"
              value={form.fee}
              onChange={(e) => edit("fee", e.target.value)}
              error={dirty ? errors.fee : undefined}
              hint="A whole number from 0 to 100."
            />
            <Input
              label="Minimum delegation (QTUM)"
              inputMode="decimal"
              value={form.min}
              onChange={(e) => edit("min", e.target.value)}
              error={dirty ? errors.min : undefined}
              hint="Smaller delegations are not accepted."
            />
          </div>
          <p className="text-sm text-fg-muted">Saving a change restarts the Qtum node, so staking pauses for a few minutes.</p>
          <div>
            <Button type="submit" loading={working} disabled={nothingToSave || !!errors.fee || !!errors.min}>
              Save
            </Button>
          </div>
        </form>
      )}
      {outcome && (
        <Notice tone={outcome.tone} live testId="delegation-outcome">
          <p>{outcome.text}</p>
          {outcome.error !== undefined && <TechDetails error={outcome.error} />}
        </Notice>
      )}
    </SectionCard>
  );
}

function Restart() {
  const api = useQtumApi();
  const { refreshWallet, refreshNode } = useAppStatus();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const restart = async () => {
    setWorking(true);
    setOutcome(null);
    try {
      await api.restartNode();
      setOutcome({ tone: "accent", text: "The Qtum node is restarting. This takes a few minutes; the status is shown at the top of the page." });
      void Promise.all([refreshWallet(), refreshNode()]);
    } catch (error) {
      setOutcome({ tone: "danger", text: `The node could not be restarted. ${plainError(error)}`, error });
    } finally {
      setWorking(false);
      setAsking(false);
    }
  };

  return (
    <SectionCard title="Restart the node" description="Stops the Qtum node and starts it again. Try this when the node seems stuck." testId="restart">
      <div>
        <Button variant="secondary" onClick={() => setAsking(true)} disabled={working}>
          Restart the node
        </Button>
      </div>
      {outcome && (
        <Notice tone={outcome.tone} live testId="restart-outcome">
          <p>{outcome.text}</p>
          {outcome.error !== undefined && <TechDetails error={outcome.error} />}
        </Notice>
      )}
      <ConfirmDialog
        open={asking}
        title="Restart the Qtum node?"
        confirmLabel="Restart"
        tone="primary"
        loading={working}
        onConfirm={() => void restart()}
        onCancel={() => setAsking(false)}
      >
        The node stops and starts again. Staking pauses for a few minutes while it starts. If your wallet has a password, unlock it for staking again
        afterwards.
      </ConfirmDialog>
    </SectionCard>
  );
}

/** Settings (spec): the delegation fee and minimum, and restarting the node. */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      <Delegation />
      <Restart />
    </div>
  );
}
