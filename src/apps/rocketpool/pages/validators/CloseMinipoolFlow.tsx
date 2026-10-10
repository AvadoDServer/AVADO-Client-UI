import { useState } from "react";
import { shortAddress } from "../../lib/units";
import { TransactionFlow } from "../../tx/TransactionFlow";
import { closeMinipoolFlow, distributeFeeDistributorFlow } from "./actions";

/**
 * Close an exited minipool. When the fee distributor holds ETH it is paid
 * out first, so both are paid at the right commission:
 *   1) `node/distribute` (a normal transaction), then
 *   2) `minipool/close` with `bundle=false`.
 * Each step has its own check, fee and confirm. Step 2 opens only after
 * step 1 went through; cancelling step 1 ends it. (Smartnode's one-block
 * bundle is an Advanced option: at the normal tip it is often not included.)
 */
export function CloseMinipoolFlow({
  address,
  feeDistributorHasBalance,
  onClose,
  onDone,
}: {
  address: string;
  feeDistributorHasBalance: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"distribute" | "close">(feeDistributorHasBalance ? "distribute" : "close");
  const [distributed, setDistributed] = useState(false);

  if (step === "distribute") {
    const f = distributeFeeDistributorFlow(undefined, `Step 1 of 2: pay out your minipools' block rewards`);
    return (
      <TransactionFlow
        key="distribute"
        open
        {...f}
        summary={
          <div className="flex flex-col gap-2">
            {f.summary}
            <p>
              These rewards are paid out before minipool {shortAddress(address)} is closed, so you get the right share of both. Step 2
              closes the minipool (a second transaction with its own fee).
            </p>
          </div>
        }
        onDone={() => {
          setDistributed(true);
          onDone();
        }}
        onClose={() => (distributed ? setStep("close") : onClose())}
      />
    );
  }

  const f = closeMinipoolFlow(address, feeDistributorHasBalance ? { title: `Step 2 of 2: close minipool ${shortAddress(address)}` } : {});
  return <TransactionFlow key="close" open {...f} onDone={onDone} onClose={onClose} />;
}
