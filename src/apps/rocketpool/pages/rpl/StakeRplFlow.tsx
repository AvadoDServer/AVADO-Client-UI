import { useEffect, useState } from "react";
import { Button, Modal, Spinner } from "../../../../components/ui";
import { plainError } from "../../api/errors";
import { useRocketpoolApi } from "../../api/RocketpoolApiProvider";
import { getRplAllowance } from "../../api/sn";
import { formatRpl, toBigInt } from "../../lib/units";
import { CAN_RULES } from "../../tx/rules";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { Callout } from "../common";

type Step = { k: "checking" } | { k: "error"; message: string } | { k: "approve" } | { k: "stake"; approved: boolean };

/**
 * Staking RPL takes two transactions when Rocket Pool may not take that much
 * RPL yet: 1) allow it (exactly this amount, never "unlimited"), 2) stake.
 * Each is its own check, fee and confirm; step 2 never starts by itself
 * unless step 1 went through, and it still needs its own confirm.
 */
export function StakeRplFlow({ amount, onClose, onDone }: { amount: bigint; onClose: () => void; onDone: () => void }) {
  const api = useRocketpoolApi();
  const [step, setStep] = useState<Step>({ k: "checking" });
  const [approveMined, setApproveMined] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRplAllowance(api)
      .then((r) => {
        if (cancelled) return;
        const allowance = toBigInt(r.allowance) ?? 0n;
        setStep(allowance >= amount ? { k: "stake", approved: false } : { k: "approve" });
      })
      .catch((e) => !cancelled && setStep({ k: "error", message: plainError(e) }));
    return () => {
      cancelled = true;
    };
  }, [api, amount]);

  const wei = amount.toString();

  if (step.k === "approve") {
    return (
      <TransactionFlow
        key="approve"
        open
        title={`Step 1 of 2: allow Rocket Pool to take ${formatRpl(amount)}`}
        summary={
          <div className="flex flex-col gap-2">
            <p>
              Before RPL can be staked, the RPL token needs your permission for Rocket Pool's staking contract to take it. This
              allows exactly {formatRpl(amount)}, nothing more.
            </p>
            <p>After this is confirmed, step 2 stakes it (a second transaction with its own fee).</p>
          </div>
        }
        tx={{
          canRoute: "node/get-stake-rpl-approval-gas",
          route: "node/stake-rpl-approve-rpl",
          params: { amountWei: wei },
          txHashField: "approveTxHash",
        }}
        confirmLabel="Allow"
        onDone={() => setApproveMined(true)}
        onClose={() => (approveMined ? setStep({ k: "stake", approved: true }) : onClose())}
      />
    );
  }

  if (step.k === "stake") {
    return (
      <TransactionFlow
        key="stake"
        open
        title={step.approved ? `Step 2 of 2: stake ${formatRpl(amount)}` : `Stake ${formatRpl(amount)}`}
        summary={
          <p>
            Stakes {formatRpl(amount)} from the node wallet on your node (megapool RPL). Staked RPL earns a share of the RPL
            rewards. Getting it back takes an unstaking period (28 days today).
          </p>
        }
        tx={{
          canRoute: "node/can-stake-rpl",
          route: "node/stake-rpl",
          params: { amountWei: wei },
          txHashField: "stakeTxHash",
          blockedReason: CAN_RULES["node/can-stake-rpl"],
        }}
        confirmLabel="Stake"
        onDone={onDone}
        onClose={onClose}
      />
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Stake ${formatRpl(amount)}`}
      size="md"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {step.k === "checking" ? (
        <p className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" label="Checking" /> Checking how much RPL Rocket Pool may take…
        </p>
      ) : (
        <Callout tone="danger" title="Could not check" role="alert">
          <p>{step.message}</p>
        </Callout>
      )}
    </Modal>
  );
}
