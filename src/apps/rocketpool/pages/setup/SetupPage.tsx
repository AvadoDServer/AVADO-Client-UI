import { useEffect, useRef } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button, Card, CardTitle, StatusDot, cn, type StatusTone } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import { useNodeReadable, useNodeStatus } from "../../data/nodeReads";
import { useAppStatus } from "../../status/AppStatus";
import { FundStep } from "./FundStep";
import { RegisterStep } from "./RegisterStep";
import { SmoothingStep } from "./SmoothingStep";
import {
  SETUP_STEPS,
  blockingStep,
  firstOpenStep,
  isSetupStepId,
  nextStepId,
  stepStatuses,
  type SetupStepId,
  type StepStatus,
} from "./steps";
import { ValidatorsStep } from "./ValidatorsStep";
import { WalletStep } from "./WalletStep";
import { WithdrawalStep } from "./WithdrawalStep";

const STATUS_TEXT: Record<StepStatus, { tone: StatusTone; label: string }> = {
  done: { tone: "success", label: "Done" },
  pending: { tone: "accent", label: "Waiting for you" },
  open: { tone: "warning", label: "To do" },
  optional: { tone: "neutral", label: "Optional" },
  locked: { tone: "neutral", label: "Later" },
  unknown: { tone: "neutral", label: "Checking" },
};

const titleOf = (id: SetupStepId) => SETUP_STEPS.find((s) => s.id === id)!.title;

/**
 * The setup wizard (spec §4.1): wallet → ETH → register → withdrawal
 * address → smoothing pool → first validators. Each step reads its state
 * from the node, so the wizard can be left and resumed, and later fixes
 * (withdrawal address, more ETH) link straight to their step.
 */
export default function SetupPage() {
  const { step } = useParams();
  const { avado, daemonReady, avadoFailed, refresh } = useAppStatus();
  const readable = useNodeReadable();
  const nodePoll = useNodeStatus(readable);
  const walletReady = !!avado?.walletFilePresent && !!avado?.passwordFilePresent;
  const node = readable ? nodePoll.data : undefined;
  const statuses = stepStatuses({ walletReady, node });
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step) headingRef.current?.focus();
  }, [step]);

  if (!step) {
    // Wait for the package status before choosing where to start.
    if (!avado) return <Intro />;
    // …and, with a wallet, for the node's first answer.
    if (walletReady && readable && nodePoll.data === undefined && nodePoll.error === undefined) return <Intro />;
    return <Navigate to={`/setup/${firstOpenStep(statuses)}`} replace />;
  }
  if (!isSetupStepId(step)) return <Navigate to="/setup" replace />;

  const current = step;
  const index = SETUP_STEPS.findIndex((s) => s.id === current);
  const status = statuses[current];
  const blocker = blockingStep(current, statuses);
  const next = nextStepId(current);
  const onChanged = () => {
    void nodePoll.refresh();
    void refresh();
  };

  let body;
  if (!avado) {
    body = <p className="text-sm text-fg-muted">Checking your node…</p>;
  } else if (avadoFailed || !daemonReady) {
    body = (
      <p className="text-sm text-fg">
        Rocket Pool isn't ready yet (see the message above). Setup continues here once it is running.
      </p>
    );
  } else if (blocker) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg">First finish “{titleOf(blocker)}”.</p>
        <div>
          <Button as={Link} to={`/setup/${blocker}`} variant="primary">
            Go to {titleOf(blocker)}
          </Button>
        </div>
      </div>
    );
  } else {
    const nodeError = walletReady && nodePoll.error !== undefined && !nodePoll.data ? plainError(nodePoll.error) : null;
    body = (
      <>
        {nodeError && current !== "wallet" && (
          <p className="mb-4 text-sm text-danger-text" role="alert">
            Could not read your node: {nodeError}
          </p>
        )}
        {current === "wallet" && <WalletStep walletReady={walletReady} address={node?.accountAddress} />}
        {current === "fund" && <FundStep address={node?.accountAddress} node={node} />}
        {current === "register" && <RegisterStep node={node} onChanged={onChanged} />}
        {current === "withdrawal" && <WithdrawalStep node={node} onChanged={onChanged} />}
        {current === "smoothing" && <SmoothingStep node={node} onChanged={onChanged} />}
        {current === "validators" && <ValidatorsStep node={node} onChanged={onChanged} />}
      </>
    );
  }

  const canGoNext = next && statuses[next] !== "locked" && (status === "done" || status === "pending" || status === "optional" || current === "fund");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Set up your node</h1>
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Setup steps">
          <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {SETUP_STEPS.map((s, i) => {
              const st = STATUS_TEXT[statuses[s.id]];
              const here = s.id === current;
              return (
                <li key={s.id} className="flex-shrink-0 lg:flex-shrink">
                  <Link
                    to={`/setup/${s.id}`}
                    aria-current={here ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors focus:outline-none focus-visible:shadow-focus",
                      here ? "border-accent bg-accent-subtle" : "border-transparent hover:bg-surface-hover",
                    )}
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-fg ring-1 ring-border">
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="whitespace-nowrap font-semibold text-fg">{s.title}</span>
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
                        <StatusDot tone={st.tone} />
                        {st.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
        <Card as="section" aria-labelledby="setup-step-title" className="flex min-w-0 flex-col gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Step {index + 1} of {SETUP_STEPS.length}
            </p>
            <h2 id="setup-step-title" ref={headingRef} tabIndex={-1} className="mt-1 font-display text-2xl font-bold text-fg focus:outline-none">
              {titleOf(current)}
            </h2>
          </div>
          {body}
          {canGoNext && next && (
            <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              <Button as={Link} to={`/setup/${next}`} variant={status === "done" ? "primary" : "secondary"}>
                Next: {titleOf(next)}
              </Button>
            </div>
          )}
          {!next && status === "done" && (
            <div className="flex flex-wrap gap-3 border-t border-border pt-4">
              <Button as={Link} to="/" variant="primary">
                Go to Home
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Intro() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl font-bold tracking-tight text-fg">Set up your node</h1>
      <Card className="flex flex-col gap-2">
        <CardTitle>Checking your node…</CardTitle>
      </Card>
    </div>
  );
}
