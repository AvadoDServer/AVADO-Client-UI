import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, cn } from "../../../../components/ui";
import { isOutcomeUnknown, isRpApiError } from "../../api/errors";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { Address, Notice } from "../../components/common";
import { isAddress } from "../../lib/explorer";
import { CONFIRM_WORD_COUNT, mnemonicProblem, mnemonicWords, ordinal, pickConfirmPositions, wrongPositions } from "../../lib/mnemonic";
import { sameAddress } from "../../lib/units";
import { SUPPORT_EMAIL } from "../../status/problems";
import { useAppStatus } from "../../status/AppStatus";
import { ensureWalletPassword, newWallet, saveWallet, walletError } from "./walletCalls";

/** Shown instead of any way to replace a wallet (owner ruling: support handles wallet changes). */
export function WalletExists({ address }: { address?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="success" title="Your node wallet is ready">
        {address && (
          <p>
            Its address: <Address value={address} />
          </p>
        )}
        <p>
          This AVADO keeps one Rocket Pool wallet, and this page never replaces it. If you need to change it, contact{" "}
          <a className="font-semibold text-accent underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </Notice>
    </div>
  );
}

type Mode = "choose" | "create" | "restore";

/** Step 1: create a new node wallet or restore one; never replaces an existing wallet. */
export function WalletStep({ walletReady, address }: { walletReady: boolean; address?: string }) {
  const [mode, setMode] = useState<Mode>("choose");
  /** This page just created or restored the wallet: keep showing its outcome. */
  const [saved, setSaved] = useState(false);
  if (walletReady && !saved) return <WalletExists address={address} />;
  if (mode === "create") return <CreateWallet onCancel={() => setMode("choose")} onSaved={() => setSaved(true)} />;
  if (mode === "restore") return <RestoreWallet onCancel={() => setMode("choose")} onSaved={() => setSaved(true)} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        Rocket Pool needs a wallet on this AVADO: the <strong>node wallet</strong>. It pays network fees and holds your node's
        validator keys. Its recovery phrase is the only way to restore it if this AVADO breaks.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceButton
          title="Create a new wallet"
          text="For a new Rocket Pool node. You'll write down its 24-word recovery phrase."
          onClick={() => setMode("create")}
        />
        <ChoiceButton
          title="Restore a wallet"
          text="You already have a Rocket Pool node wallet and its recovery phrase, for example from an earlier AVADO."
          onClick={() => setMode("restore")}
        />
      </div>
    </div>
  );
}

function ChoiceButton({ title, text, onClick }: { title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-surface-hover focus:outline-none focus-visible:shadow-focus"
    >
      <span className="text-[0.9375rem] font-semibold text-fg">{title}</span>
      <span className="text-sm text-fg-muted">{text}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

type CreatePhase =
  | { k: "intro"; error?: string }
  | { k: "show" }
  | { k: "confirm"; wrong?: number[] }
  | { k: "saving" }
  | { k: "save-failed"; message: string; unclear: boolean }
  | { k: "done"; address: string; mismatch: boolean };

/**
 * set-password (random) → init (a new phrase, not saved) → the owner writes
 * it down (shown once) → types back 3 random words → recover with
 * skipValidatorKeyRecovery=true, which saves it. The phrase lives only in
 * this component's memory and is dropped when it is saved or abandoned.
 */
function CreateWallet({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const api = useRocketpoolApi();
  const { avado, refresh } = useAppStatus();
  const [phase, setPhase] = useState<CreatePhase>({ k: "intro" });
  const [busy, setBusy] = useState(false);
  /** The phrase and the address Smartnode derived from it; secret, memory only. */
  const secret = useRef<{ words: string[]; address: string } | null>(null);
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [written, setWritten] = useState(false);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLParagraphElement>(null);

  // Forget the phrase when leaving the page.
  useEffect(
    () => () => {
      secret.current = null;
    },
    [],
  );
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase.k]);

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await ensureWalletPassword(api, avado?.passwordFilePresent ?? false);
      const res = await newWallet(api);
      const words = mnemonicWords(res.mnemonic);
      if (mnemonicProblem(res.mnemonic) !== null) throw new Error("not a phrase");
      secret.current = { words, address: res.accountAddress };
      setPositions(pickConfirmPositions(words.length));
      setAnswers(Array(CONFIRM_WORD_COUNT).fill(""));
      setWritten(false);
      setPhase({ k: "show" });
    } catch (e) {
      secret.current = null;
      setPhase({ k: "intro", error: walletError(e) });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const startOver = () => {
    secret.current = null;
    setAnswers([]);
    setPhase({ k: "intro" });
  };

  const save = async () => {
    const s = secret.current;
    if (!s || inFlight.current) return;
    const wrong = wrongPositions(s.words, positions, answers);
    if (wrong.length > 0) return setPhase({ k: "confirm", wrong });
    inFlight.current = true;
    setBusy(true);
    setPhase({ k: "saving" });
    const phrase = s.words.join(" ");
    try {
      const res = await saveWallet(api, phrase, { withValidatorKeys: false });
      secret.current = null;
      setAnswers([]);
      setPhase({ k: "done", address: res.accountAddress, mismatch: !sameAddress(res.accountAddress, s.address) });
      onSaved();
      await refresh();
    } catch (e) {
      const unclear = isOutcomeUnknown(e);
      setPhase({ k: "save-failed", message: walletError(e, phrase), unclear });
      if (unclear || (isRpApiError(e) && e.status === 409)) void refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const heading = (text: string) => (
    <p ref={headingRef} tabIndex={-1} className="text-[0.9375rem] font-semibold text-fg focus:outline-none">
      {text}
    </p>
  );

  if (phase.k === "intro") {
    return (
      <div className="flex flex-col gap-4">
        {heading("Create a new node wallet")}
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg">
          <li>Next you'll see the wallet's recovery phrase: 24 words. Have paper and a pen ready.</li>
          <li>Write the words down in order and keep the paper somewhere safe. Don't take a photo and don't store them on a computer.</li>
          <li>The words are shown only once. AVADO does not keep a copy you can see later.</li>
          <li>Anyone who has these words controls the node wallet and its funds.</li>
        </ul>
        {phase.error && (
          <Notice tone="danger" title="Could not create the wallet" live>
            <p>{phase.error}</p>
          </Notice>
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={start} loading={busy}>
            Show my recovery phrase
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  if (phase.k === "show" && secret.current) {
    const words = secret.current.words;
    return (
      <div className="flex flex-col gap-4">
        {heading("Write down your recovery phrase")}
        <Notice tone="warning" title="This is the only time these words are shown">
          <p>Write all {words.length} words on paper, in this order. You'll be asked for three of them next.</p>
        </Notice>
        <ol
          className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-bg-subtle p-4 sm:grid-cols-3 md:grid-cols-4"
          aria-label="Recovery phrase"
          data-testid="recovery-phrase"
        >
          {words.map((w, i) => (
            <li key={i} className="flex items-baseline gap-2 rounded-lg bg-surface px-2.5 py-1.5">
              <span className="w-6 text-right text-xs tabular-nums text-fg-muted" aria-hidden="true">
                {i + 1}.
              </span>
              <span className="font-mono text-sm font-medium text-fg" aria-label={`Word ${i + 1}: ${w}`}>
                {w}
              </span>
            </li>
          ))}
        </ol>
        <label className="flex items-start gap-3 text-sm text-fg">
          <input type="checkbox" className="mt-1 h-4 w-4 flex-shrink-0 accent-[rgb(var(--accent))]" checked={written} onChange={(e) => setWritten(e.target.checked)} />
          <span>I have written down all {words.length} words in order, on paper.</span>
        </label>
        <div>
          <Button variant="primary" onClick={() => setPhase({ k: "confirm" })} disabled={!written}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  if ((phase.k === "confirm" || phase.k === "saving") && secret.current) {
    const wrong = phase.k === "confirm" ? (phase.wrong ?? []) : [];
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {heading("Check your written copy")}
        <p className="text-sm text-fg">
          Type these words from your paper. The words are no longer shown here, so this checks that your copy is right.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {positions.map((p, i) => (
            <Input
              key={p}
              label={`${ordinal(p + 1)} word`}
              value={answers[i] ?? ""}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                setAnswers(next);
              }}
              error={wrong.includes(p) ? "Doesn't match" : undefined}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          ))}
        </div>
        {wrong.length > 0 && (
          <Notice tone="danger" title="Some words don't match your recovery phrase" live>
            <p>
              Check the {wrong.map((p) => ordinal(p + 1)).join(", ")} {wrong.length === 1 ? "word" : "words"} on your paper. If your copy is
              wrong, start again: you'll get a new recovery phrase, and nothing has been saved yet.
            </p>
          </Notice>
        )}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={busy} disabled={answers.some((a) => !a.trim())}>
            Save the wallet
          </Button>
          <Button variant="secondary" onClick={startOver} disabled={busy}>
            Start again with a new phrase
          </Button>
        </div>
      </form>
    );
  }

  if (phase.k === "save-failed") {
    return (
      <div className="flex flex-col gap-4">
        {heading(phase.unclear ? "We don't know yet if the wallet was saved" : "The wallet was not saved")}
        <Notice tone={phase.unclear ? "warning" : "danger"} title={phase.message} live>
          {phase.unclear ? (
            <p>
              Keep your written recovery phrase. This page updates by itself once the wallet shows up. You can also try saving again:
              if the wallet was already saved, nothing changes.
            </p>
          ) : (
            <p>Nothing was changed. Keep your written recovery phrase and try again.</p>
          )}
        </Notice>
        <div className="flex flex-wrap gap-3">
          {secret.current && (
            <Button variant="primary" onClick={save} loading={busy}>
              Try saving again
            </Button>
          )}
          {!phase.unclear && (
            <Button variant="secondary" onClick={startOver} disabled={busy}>
              Start again with a new phrase
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase.k === "done") {
    return (
      <div className="flex flex-col gap-4">
        {heading("Your node wallet is ready")}
        {phase.mismatch ? (
          <Notice tone="danger" title="The saved wallet has a different address than expected" live>
            <p>Don't send ETH to it yet. Contact {SUPPORT_EMAIL}.</p>
          </Notice>
        ) : (
          <Notice tone="success" title="Saved" live>
            <p>
              Node wallet address: <Address value={phase.address} />
            </p>
            <p>Keep your written recovery phrase safe. Next, add ETH to this address.</p>
          </Notice>
        )}
      </div>
    );
  }

  // The phrase is gone (e.g. the page was reloaded): start over.
  return (
    <div className="flex flex-col gap-4">
      <Notice tone="neutral" title="Nothing was saved">
        <p>Start again to get a new recovery phrase.</p>
      </Notice>
      <div>
        <Button variant="primary" onClick={startOver}>
          Start again
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Restore                                                             */
/* ------------------------------------------------------------------ */

/**
 * Restores an existing node wallet from its phrase with `wallet/recover`
 * (or `search-and-recover` when the owner gives the node address). Restored
 * validator keys are not loaded until the owner approves them on Home.
 */
function RestoreWallet({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const api = useRocketpoolApi();
  const { avado, refresh } = useAppStatus();
  const [phrase, setPhrase] = useState("");
  const [withKeys, setWithKeys] = useState(true);
  const [nodeAddress, setNodeAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: true; address: string; keys: number } | { ok: false; message: string; unclear: boolean } | null>(null);
  const inFlight = useRef(false);
  const phraseId = useId();

  useEffect(() => () => setPhrase(""), []);

  const problem = mnemonicProblem(phrase);
  const addressProblem = nodeAddress.trim() && !isAddress(nodeAddress.trim()) ? "Not an Ethereum address (0x followed by 40 characters)." : null;

  const restore = async () => {
    setTouched(true);
    if (problem || addressProblem || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setResult(null);
    const typed = phrase;
    try {
      await ensureWalletPassword(api, avado?.passwordFilePresent ?? false);
      const res = await saveWallet(api, typed, { withValidatorKeys: withKeys, nodeAddress: nodeAddress.trim() || undefined });
      setPhrase("");
      setResult({ ok: true, address: res.accountAddress, keys: res.validatorKeys?.length ?? 0 });
      onSaved();
      await refresh();
    } catch (e) {
      const unclear = isOutcomeUnknown(e);
      setResult({ ok: false, message: walletError(e, typed), unclear });
      if (unclear || (isRpApiError(e) && e.status === 409)) void refresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (result?.ok) {
    return (
      <Notice tone="success" title="Your node wallet is restored" live>
        <p>
          Node wallet address: <Address value={result.address} />
        </p>
        {withKeys && (
          <p>
            {result.keys > 0
              ? `${result.keys} validator key${result.keys === 1 ? " was" : "s were"} restored. `
              : "Validator keys were restored if this wallet has any. "}
            They are not started yet: Home asks you to approve loading them, once you're sure they don't run anywhere else.
          </p>
        )}
      </Notice>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void restore();
      }}
    >
      <p className="text-[0.9375rem] font-semibold text-fg">Restore your node wallet</p>
      <Notice tone="warning" title="Never run the same validators in two places">
        <p>
          If this wallet's validators still run on another machine or service, stop them there first and remove their keys. Running a key
          in two places gets it slashed.
        </p>
      </Notice>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={phraseId} className="text-sm font-medium text-fg-muted">
          Recovery phrase
        </label>
        <textarea
          id={phraseId}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          rows={4}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={touched && !!problem ? true : undefined}
          aria-describedby={`${phraseId}-hint`}
          className={cn(
            "w-full rounded-control border bg-surface px-3.5 py-2.5 font-mono text-sm text-fg focus:outline-none focus-visible:border-accent focus-visible:shadow-focus",
            touched && problem ? "border-danger" : "border-border",
          )}
        />
        <span id={`${phraseId}-hint`} className={cn("text-xs", touched && problem ? "text-danger-text" : "text-fg-muted")}>
          {touched && problem ? problem : "The words separated by spaces, in order. It is sent to your AVADO only and is not stored by this page."}
        </span>
      </div>
      <label className="flex items-start gap-3 text-sm text-fg">
        <input type="checkbox" className="mt-1 h-4 w-4 flex-shrink-0 accent-[rgb(var(--accent))]" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} />
        <span>
          Also restore my validator keys
          <span className="block text-fg-muted">Needed if this wallet already has validators. They only start after you approve them.</span>
        </span>
      </label>
      <details className="text-sm text-fg">
        <summary className="cursor-pointer font-medium text-fg-muted">The wallet was made with another app (optional)</summary>
        <Input
          className="mt-3"
          label="Node address"
          hint="Your node's address, if you know it. Rocket Pool then searches the usual wallet formats for it."
          value={nodeAddress}
          onChange={(e) => setNodeAddress(e.target.value)}
          error={addressProblem ?? undefined}
          autoComplete="off"
          spellCheck={false}
        />
      </details>
      {result && !result.ok && (
        <Notice tone={result.unclear ? "warning" : "danger"} title={result.unclear ? "We don't know yet if the wallet was restored" : "Not restored"} live>
          <p>{result.message}</p>
          {result.unclear && <p>This page updates by itself once the wallet shows up. Trying again is safe: an existing wallet is never replaced.</p>}
        </Notice>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="primary" loading={busy}>
          Restore wallet
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Back
        </Button>
      </div>
    </form>
  );
}

export default WalletStep;
