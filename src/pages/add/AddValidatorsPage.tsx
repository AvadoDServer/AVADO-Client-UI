import { useId, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../api/ApiProvider";
import { isApiError } from "../../api/errors";
import type { ImportResult } from "../../api/types";
import { Badge, Button, Card, CardDescription, CardTitle, Input, cn, type BadgeVariant } from "../../components/ui";
import { useClientConfig } from "../../config/ClientConfigProvider";
import { shortHex } from "../validators/statusText";
import { classifyFile, importErrorText, readFileText, tally, tallyText, type DroppedKind } from "./keystoreFiles";

interface Entry {
  id: number;
  name: string;
  kind: Exclude<DroppedKind, "slashing">;
  text: string;
  pubkey?: string;
  reason?: string;
  password: string;
  result?: ImportResult;
  /**
   * The import request timed out: the node may still be importing this key.
   * Cleared once the key shows up in the node's list (`found`).
   */
  unknown?: boolean;
  /** Seen in the node's key list after a timed-out import. */
  found?: boolean;
}

type PasswordMode = "same" | "each";

const isDone = (e: Entry) => e.found === true || e.result?.status === "imported" || e.result?.status === "duplicate";
const isPending = (e: Entry) => e.kind === "keystore" && !isDone(e);

function resultBadge(e: Entry): { variant: BadgeVariant; label: string } | null {
  if (e.kind !== "keystore") return { variant: "warning", label: "Skipped" };
  if (e.found) return { variant: "success", label: "On this node" };
  if (e.unknown) return { variant: "warning", label: "Unknown" };
  if (!e.result) return null;
  if (e.result.status === "imported") return { variant: "success", label: "Imported" };
  if (e.result.status === "duplicate") return { variant: "neutral", label: "Already on this node" };
  return { variant: "danger", label: importErrorText(e.result.message) === "Wrong password" ? "Wrong password" : "Not imported" };
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function PasswordField({ label, value, onChange, hint, error }: { label: string; value: string; onChange: (v: string) => void; hint?: string; error?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        hint={hint}
        error={error}
        className="[&_input]:pr-20"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-pressed={show}
        aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        className="absolute right-2 top-[1.9rem] rounded-md px-2 py-1.5 text-xs font-semibold text-fg-muted hover:bg-fg/[0.06] hover:text-fg focus:outline-none focus-visible:shadow-focus"
      >
        {show ? "Hide" : "Show"}
      </button>
    </div>
  );
}

/** Import one or many keystore files through the keymanager. */
export default function AddValidatorsPage() {
  const { keymanager } = useApi();
  const { features } = useClientConfig();
  const multiple = features.batchImport;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [slashing, setSlashing] = useState<{ name: string; text: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [mode, setMode] = useState<PasswordMode>("same");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{ text: string; failed: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(1);
  // The latest list, for the async file reader (state may be stale there).
  const entriesRef = useRef<Entry[]>([]);
  entriesRef.current = entries;
  const slashingRef = useRef<{ name: string; text: string } | null>(null);
  slashingRef.current = slashing;
  const inputId = useId();
  const slashingInputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const newNotes: string[] = [];
    const read = await Promise.all(
      files.map(async (f) => {
        try {
          return { f, text: await readFileText(f) };
        } catch {
          return { f, text: "" };
        }
      }),
    );
    let foundSlashing: { name: string; text: string } | null = null;
    const incoming: Entry[] = [];
    for (const { f, text } of read) {
      const c = classifyFile(text);
      if (c.kind === "slashing") {
        const previous = foundSlashing?.name ?? slashingRef.current?.name;
        foundSlashing = { name: f.name, text };
        newNotes.push(
          previous && previous !== f.name
            ? `${f.name} is a slashing-protection file. It replaces ${previous}.`
            : `${f.name} is a slashing-protection file, so it was added as that.`,
        );
        continue;
      }
      incoming.push({ id: nextId.current++, name: f.name, kind: c.kind, text, pubkey: c.pubkey, reason: c.reason, password: "" });
    }
    if (foundSlashing) setSlashing(foundSlashing);
    const seen = new Set(entriesRef.current.flatMap((e) => (e.pubkey ? [e.pubkey] : [])));
    let list = [...entriesRef.current];
    for (const e of incoming) {
      if (e.pubkey && seen.has(e.pubkey)) {
        newNotes.push(`${e.name} has the same key as a file already in the list, so it was left out.`);
        continue;
      }
      if (e.pubkey) seen.add(e.pubkey);
      list.push(e);
    }
    if (!multiple) {
      const keystores = list.filter(isPending);
      if (keystores.length > 1) {
        newNotes.push("This client imports one keystore at a time. Only the last one is kept.");
        const keep = keystores[keystores.length - 1];
        list = list.filter((e) => !isPending(e) || e === keep);
      }
    }
    entriesRef.current = list;
    setEntries(list);
    setNotes(newNotes);
    setSummary(null);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void addFiles(files);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer?.files ?? []));
  };

  const onSlashingPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const text = await readFileText(f).catch(() => "");
    if (classifyFile(text).kind !== "slashing") {
      setNotes([`${f.name} isn't a slashing-protection file. It should be the slashing-protection .json exported from your old node.`]);
      return;
    }
    const previous = slashingRef.current?.name;
    setNotes(previous && previous !== f.name ? [`${f.name} replaces ${previous} as the slashing-protection file.`] : []);
    setSlashing({ name: f.name, text });
  };

  const removeEntry = (id: number) => setEntries((prev) => prev.filter((e) => e.id !== id));
  const setEntryPassword = (id: number, pw: string) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, password: pw } : e)));

  const pending = entries.filter(isPending);
  const passwordsReady = mode === "same" ? password !== "" : pending.every((e) => e.password !== "");
  const canImport = pending.length > 0 && passwordsReady && !busy;

  const doImport = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!canImport) return;
    const batch = pending;
    setBusy(true);
    setSummary(null);
    let results: ImportResult[];
    try {
      results = await keymanager.importKeystores({
        keystores: batch.map((e) => e.text),
        passwords: batch.map((e) => (mode === "same" ? password : e.password)),
        ...(slashing ? { slashing_protection: slashing.text } : {}),
      });
    } catch (err) {
      if (isApiError(err) && err.kind === "timeout") {
        // No answer in time doesn't mean nothing was imported: the node may
        // still be working through the keystores. Say so per file, then look
        // at the node's key list.
        const ids = new Set(batch.map((e) => e.id));
        const next = entriesRef.current.map((e) => (ids.has(e.id) ? { ...e, result: undefined, unknown: true } : e));
        entriesRef.current = next;
        setEntries(next);
        setSummary(null);
        setBusy(false);
        await refreshFromNode();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      results = batch.map(() => ({ status: "error", message: msg }));
    }
    const byId = new Map(batch.map((e, i) => [e.id, results[i] ?? { status: "error" as const, message: "The node didn't report a result for this file" }]));
    setEntries((prev) => prev.map((e) => (byId.has(e.id) ? { ...e, result: byId.get(e.id) } : e)));
    const t = tally([...byId.values()]);
    setSummary({ text: tallyText(t), failed: t.error > 0 });
    setBusy(false);
  };

  /** After a timed-out import: mark the files whose key is on the node now. */
  const refreshFromNode = async () => {
    setChecking(true);
    try {
      const onNode = new Set((await keymanager.listKeystores()).map((k) => k.validating_pubkey.toLowerCase()));
      const next = entriesRef.current.map((e) =>
        e.unknown && e.pubkey && onNode.has(e.pubkey.toLowerCase()) ? { ...e, unknown: false, found: true } : e,
      );
      entriesRef.current = next;
      setEntries(next);
    } catch {
      /* the node is still busy or restarting: the files stay "Unknown" */
    } finally {
      setChecking(false);
    }
  };

  const unknownCount = entries.filter((e) => e.unknown).length;
  const keystoreCount = entries.filter((e) => e.kind === "keystore").length;
  const failedWrongPassword = entries.some((e) => e.result?.status === "error" && importErrorText(e.result.message) === "Wrong password");
  const allDone = keystoreCount > 0 && pending.length === 0;

  return (
    <div className="min-w-0">
      <header className="mb-6 flex flex-col gap-1 border-b border-border pb-5">
        <Link to="/" className="text-sm font-medium">
          ← Validators
        </Link>
        <h1 className="mb-0 font-display text-4xl font-bold tracking-tight text-fg">Add validators</h1>
        <p className="mb-0 max-w-2xl text-sm text-fg-muted">
          Add the keystore files you made for your deposit. They go straight to this box and never leave it.
        </p>
      </header>

      <form onSubmit={doImport} className="flex max-w-3xl flex-col gap-5" noValidate>
        <Card>
          <CardTitle>1. Keystore files</CardTitle>
          <CardDescription>
            {multiple
              ? "The files are called keystore-m_12381_3600_… .json. You can add many at once."
              : "The file is called keystore-m_12381_3600_… .json."}
          </CardDescription>
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="dropzone"
            className={cn(
              "mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:shadow-focus",
              dragging ? "border-accent bg-accent/[0.06]" : "border-border-strong hover:border-accent hover:bg-fg/[0.02]",
            )}
          >
            <span className="text-fg-muted">
              <UploadIcon />
            </span>
            <span className="font-semibold text-fg">{multiple ? "Drop keystore files here" : "Drop a keystore file here"}</span>
            <span className="text-sm text-fg-muted">
              or <span className="font-semibold text-accent">choose {multiple ? "files" : "a file"}</span>
            </span>
            <input
              id={inputId}
              type="file"
              accept=".json,application/json"
              multiple={multiple}
              onChange={onPick}
              className="sr-only"
              aria-label={multiple ? "Choose keystore files" : "Choose a keystore file"}
            />
          </label>

          {notes.length > 0 && (
            <ul role="status" className="mt-3 flex flex-col gap-1 text-sm text-fg-muted">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {entries.length > 0 && (
            <ul aria-label="Selected files" className="mt-4 flex flex-col divide-y divide-border rounded-lg border border-border">
              {entries.map((e) => {
                const badge = resultBadge(e);
                const editable = isPending(e) && !busy;
                return (
                  <li key={e.id} data-file={e.name} className="flex flex-col gap-3 px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="break-all text-sm font-medium text-fg">{e.name}</span>
                        <span className="font-mono text-xs text-fg-muted">{e.pubkey ? shortHex(e.pubkey, 8, 6) : e.reason}</span>
                        {e.unknown && (
                          <span className="break-words text-xs text-warning-text">
                            Unknown — the node may still be importing; refresh the list
                          </span>
                        )}
                        {e.result?.status === "error" && importErrorText(e.result.message) !== "Wrong password" && (
                          <span className="break-words text-xs text-danger-text">{importErrorText(e.result.message)}</span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {badge && (
                          <Badge variant={badge.variant} title={e.result?.message}>
                            {badge.label}
                          </Badge>
                        )}
                        {!isDone(e) && (
                          <Button size="sm" variant="ghost" onClick={() => removeEntry(e.id)} disabled={busy} aria-label={`Remove ${e.name} from the list`}>
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    {mode === "each" && editable && (
                      <PasswordField label={`Password for ${e.name}`} value={e.password} onChange={(v) => setEntryPassword(e.id, v)} />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>2. Password</CardTitle>
          <CardDescription>The password you chose when you created the keys.</CardDescription>
          {multiple && (
            <fieldset className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-6">
              <legend className="sr-only">Passwords</legend>
              {(
                [
                  ["same", "One password for all files"],
                  ["each", "A password for each file"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name="password-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="h-4 w-4 accent-[rgb(var(--accent))]"
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          {mode === "same" ? (
            <div className="mt-4">
              <PasswordField label="Keystore password" value={password} onChange={setPassword} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-fg-muted">Enter each password next to its file above.</p>
          )}
        </Card>

        <Card>
          <CardTitle>3. Slashing protection (optional)</CardTitle>
          <CardDescription>
            Only needed if these validators ran on another machine before. Adding its slashing-protection file keeps them
            from signing something twice.
          </CardDescription>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {slashing ? (
              <>
                <span className="break-all text-sm font-medium text-fg">{slashing.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setSlashing(null)} disabled={busy}>
                  Remove
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => slashingInputRef.current?.click()} disabled={busy}>
                Choose slashing-protection file
              </Button>
            )}
            <input
              ref={slashingInputRef}
              type="file"
              accept=".json,application/json"
              onChange={(e) => void onSlashingPick(e)}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose slashing-protection file"
            />
          </div>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" size="lg" disabled={!canImport} loading={busy}>
            {pending.length > 1 ? `Import ${pending.length} keys` : "Import key"}
          </Button>
          {summary && (
            <p role="status" className={cn("text-sm font-medium", summary.failed ? "text-danger-text" : "text-fg")}>
              {summary.text}.
            </p>
          )}
        </div>
        {unknownCount > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-warning-text">
            <p>
              The node didn&apos;t answer in time. It may still be importing{" "}
              {unknownCount === 1 ? "this key" : `these ${unknownCount} keys`}; refresh the list in a minute.
            </p>
            <Button size="sm" variant="secondary" onClick={() => void refreshFromNode()} loading={checking} disabled={busy}>
              Refresh the list
            </Button>
          </div>
        )}
        {summary?.failed && (
          <p className="text-sm text-fg-muted">
            The keys that were imported stay imported. Fix the failed files and import again.
            {failedWrongPassword && mode === "same" && multiple && " If the files have different passwords, choose “A password for each file”."}
          </p>
        )}
        {allDone && (
          <p className="text-sm">
            <Link to="/" className="font-semibold">
              See your validators
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
