/**
 * The Validators page's actions, each as the props of one TransactionFlow:
 * what it does in plain words, the check and write routes, and when it is
 * blocked. Exits are irreversible: they need the owner to type a code and
 * say so plainly.
 */
import type { ReactNode } from "react";
import type {
  CanDistributeMegapool,
  CanResponse,
  MegapoolValidator,
  MinipoolCloseDetailsResponse,
  MinipoolDistributeDetailsResponse,
} from "../../api/models";
import { validatorUrl } from "../../lib/explorer";
import { formatEth, sameAddress, shortAddress, toBigInt } from "../../lib/units";
import { pendingKey } from "../../tx/pending";
import { CAN_RULES } from "../../tx/rules";
import type { TransactionFlowProps } from "../../tx/TransactionFlow";
import { exitCodeForMinipool } from "./model";

/** One action's flow, without the page's open/close wiring. */
export type FlowConfig = Omit<TransactionFlowProps<CanResponse>, "open" | "onClose">;

/** The gas of the close bundle's second transaction (Smartnode's fixed `distributeBalanceBundleGasLimit`). */
export const CLOSE_BUNDLE_EXTRA_GAS = 600_000;

const WEI_32 = 32n * 10n ** 18n;

function ExitWarning({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="note" className="rounded-lg border border-danger/30 bg-danger-subtle p-3 text-danger-text">
        <strong className="font-semibold">An exit is permanent and can't be undone.</strong> The validator stops validating for
        good. To stake again you need a new validator and a new deposit.
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>Keep this node running until the validator has fully left. That can take from a day to several weeks.</li>
        {children}
      </ul>
    </div>
  );
}

function BeaconLink({ pubkey }: { pubkey: string }) {
  const href = validatorUrl(pubkey);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline-offset-2 hover:underline">
      Check the validator on beaconcha.in<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const exitOffChain = (pubkey: string) => ({
  sendingText: "Sending the signed exit request to the beacon chain…",
  doneTitle: "Exit requested",
  doneText: (
    <>
      <p>The beacon chain has the exit request. Within a few minutes the validator shows as exiting.</p>
      <p>Keep this node running until it has fully left.</p>
      <BeaconLink pubkey={pubkey} />
    </>
  ),
  checkText: (
    <p>
      If the validator shows as exiting on beaconcha.in, the request went through. <BeaconLink pubkey={pubkey} />
    </p>
  ),
});

/* ------------------------------------------------------------------ */
/* Minipools                                                           */
/* ------------------------------------------------------------------ */

export function exitMinipoolFlow(address: string, pubkey: string): FlowConfig {
  const code = exitCodeForMinipool(address);
  return {
    title: `Exit minipool ${shortAddress(address)}?`,
    summary: (
      <ExitWarning>
        <li>
          Once its ETH is back from the beacon chain, close the minipool here to pay out your bond and rewards to your withdrawal
          address.
        </li>
        <li>
          To confirm, type the last 6 characters of the minipool address: <span className="font-mono font-semibold text-fg">{code}</span>.
        </li>
      </ExitWarning>
    ),
    tx: {
      canRoute: "minipool/can-exit",
      route: "minipool/exit",
      params: { address: address.toLowerCase() },
      blockedReason: CAN_RULES["minipool/can-exit"],
      offChain: exitOffChain(pubkey),
    },
    confirmLabel: "Exit minipool",
    tone: "danger",
    requireText: code,
  };
}

export function distributeMinipoolFlow(address: string): FlowConfig {
  const find = (can: CanResponse) =>
    ((can as unknown as MinipoolDistributeDetailsResponse).details ?? []).find((d) => sameAddress(d.address, address));
  return {
    title: `Distribute the rewards of minipool ${shortAddress(address)}`,
    summary: (
      <p>
        Pays out the rewards that collected in this minipool: your share goes to your withdrawal address, the rest to Rocket
        Pool's stakers. The minipool keeps validating.
      </p>
    ),
    tx: {
      canRoute: "minipool/get-distribute-balance-details",
      route: "minipool/distribute-balance",
      params: { address: address.toLowerCase() },
      blockedReason: (can) => {
        const d = find(can);
        if (!d) return "Rocket Pool didn't report this minipool.";
        return d.canDistribute ? null : "There is nothing to distribute in this minipool right now.";
      },
      gasLimits: (can) => find(can)?.gasLimits,
      details: (can) => {
        const d = find(can);
        if (!d) return null;
        const yours = (toBigInt(d.nodeShareOfBalance) ?? 0n) + (toBigInt(d.refund) ?? 0n);
        return (
          <p>
            You receive about <strong>{formatEth(yours)}</strong> of the {formatEth(d.balance)} in the minipool.
          </p>
        );
      },
    },
    confirmLabel: "Distribute",
  };
}

/**
 * Close an exited minipool. When the fee distributor holds ETH, Smartnode
 * sends a bundle (empty the fee distributor, then close) so both are paid at
 * the right commission; the second transaction has a fixed gas limit.
 */
export function closeMinipoolFlow(address: string, feeDistributorHasBalance: boolean): FlowConfig {
  const find = (can: CanResponse) =>
    ((can as unknown as MinipoolCloseDetailsResponse).details ?? []).find((d) => sameAddress(d.address, address));
  const bundle = feeDistributorHasBalance;
  return {
    title: `Close minipool ${shortAddress(address)}`,
    summary: (
      <div className="flex flex-col gap-2">
        <p>Pays out this exited minipool: your bond and rewards go to your withdrawal address, and the minipool is closed.</p>
        {bundle && (
          <p>
            Your fee distributor also holds ETH, so it is paid out in the same step (two transactions sent together). If the
            network doesn't include them, nothing is paid and you can try again later.
          </p>
        )}
      </div>
    ),
    tx: {
      canRoute: "minipool/get-minipool-close-details-for-node",
      route: "minipool/close",
      params: { address: address.toLowerCase(), bundle: bundle ? "true" : "false" },
      blockedReason: (can) => {
        const r = can as unknown as MinipoolCloseDetailsResponse;
        if (r.isFeeDistributorInitialized === false) {
          return "Your fee distributor must be set up before minipools can be closed.";
        }
        const d = find(can);
        if (!d) return "Rocket Pool didn't report this minipool.";
        if (d.isFinalized) return "This minipool is already closed.";
        if (!d.canClose) {
          if (d.minipoolVersion < 3) return "This minipool uses an old contract version and can't be closed safely yet.";
          if ((toBigInt(d.balance) ?? 0n) < (toBigInt(d.refund) ?? 0n)) return "Its ETH hasn't fully arrived from the beacon chain yet.";
          return "Its ETH isn't back from the beacon chain yet. Exit it first and wait until it has been withdrawn.";
        }
        const distributable = (toBigInt(d.balance) ?? 0n) - (toBigInt(d.refund) ?? 0n);
        if (d.minipoolStatus !== "Dissolved" && distributable < (toBigInt(d.userDepositBalance) ?? 0n)) {
          return "Its balance is lower than the ETH it borrowed, so closing it now would cost your bond and RPL. Please contact AVADO support before closing it.";
        }
        return null;
      },
      gasLimits: (can) => find(can)?.gasLimits,
      details: (can) => {
        const d = find(can);
        if (!d) return null;
        const distributable = (toBigInt(d.balance) ?? 0n) - (toBigInt(d.refund) ?? 0n);
        const yours = d.minipoolStatus === "Dissolved" ? toBigInt(d.balance) ?? 0n : (toBigInt(d.nodeShare) ?? 0n) + (toBigInt(d.refund) ?? 0n);
        return (
          <div className="flex flex-col gap-2">
            <p>
              You receive about <strong>{formatEth(yours)}</strong> of the {formatEth(d.balance)} in the minipool.
            </p>
            {d.minipoolStatus !== "Dissolved" && distributable < WEI_32 && (
              <p role="note" className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-text">
                Its balance is below 32 ETH, so part of your bond covers the difference: you get back less than you put in.
              </p>
            )}
          </div>
        );
      },
      extraGas: bundle ? { gas: CLOSE_BUNDLE_EXTRA_GAS, label: "Second transaction (close)" } : undefined,
    },
    confirmLabel: "Close minipool",
  };
}

/* ------------------------------------------------------------------ */
/* Megapool                                                            */
/* ------------------------------------------------------------------ */

export function exitMegapoolValidatorFlow(v: MegapoolValidator, index: string): FlowConfig {
  const pubkey = v.pubKey;
  return {
    title: `Exit validator ${index}?`,
    summary: (
      <ExitWarning>
        <li>Rocket Pool settles its ETH automatically once it has left; your share then shows in your megapool.</li>
        <li>
          To confirm, type the validator index: <span className="font-mono font-semibold text-fg">{index}</span>.
        </li>
      </ExitWarning>
    ),
    tx: {
      canRoute: "megapool/can-exit-validator",
      route: "megapool/exit-validator",
      params: { validatorId: String(v.validatorId) },
      blockedReason: CAN_RULES["megapool/can-exit-validator"],
      offChain: exitOffChain(pubkey),
    },
    confirmLabel: "Exit validator",
    tone: "danger",
    requireText: index,
  };
}

export function leaveQueueFlow(v: MegapoolValidator): FlowConfig {
  const id = String(v.validatorId);
  return {
    title: "Take this validator out of the queue",
    summary: (
      <div className="flex flex-col gap-2">
        <p>
          Validator {id} stops waiting in the deposit queue and will not start. Its bond comes back to your node as credit, which
          you can use for a new validator or withdraw as rETH on the Rewards page.
        </p>
        <p>This can't be undone: to validate again you need a new deposit.</p>
      </div>
    ),
    tx: {
      canRoute: "megapool/can-exit-queue",
      route: "megapool/exit-queue",
      // Smartnode names the validator id "validatorIndex" on this route; the lock is by validator id like the others.
      params: { validatorIndex: id },
      lockKey: pendingKey("megapool/exit-queue", { validatorId: id }),
      blockedReason: CAN_RULES["megapool/can-exit-queue"],
    },
    confirmLabel: "Leave the queue",
  };
}

export function distributeMegapoolFlow(pendingNodeShare?: bigint | null): FlowConfig {
  return {
    title: "Distribute your megapool rewards",
    summary: (
      <p>
        Pays out the rewards collected in your megapool: your share goes to your withdrawal address, the rest to Rocket Pool's
        stakers and the protocol.
      </p>
    ),
    tx: {
      canRoute: "megapool/can-distribute",
      route: "megapool/distribute",
      blockedReason: (can) => {
        const c = can as CanDistributeMegapool;
        const base = CAN_RULES["megapool/can-distribute"](can);
        if (!base) return null;
        const why: string[] = [];
        if (c.exitingValidatorCount > 0) why.push(`${c.exitingValidatorCount} validator${c.exitingValidatorCount === 1 ? " is" : "s are"} exiting`);
        if (c.lockedValidatorCount > 0) why.push(`${c.lockedValidatorCount} validator${c.lockedValidatorCount === 1 ? " is" : "s are"} finishing an exit`);
        if (!c.megapoolNotDeployed && c.lastDistributionTime === 0) return "There are no staking validators in your megapool yet.";
        return why.length ? `It can't be distributed while ${why.join(" and ")}. Try again once that is done.` : base;
      },
      details: () =>
        pendingNodeShare !== undefined && pendingNodeShare !== null ? (
          <p>
            Your share right now: about <strong>{formatEth(pendingNodeShare)}</strong>.
          </p>
        ) : null,
    },
    confirmLabel: "Distribute",
  };
}

export function claimRefundFlow(refund: bigint): FlowConfig {
  return {
    title: "Claim your megapool refund",
    summary: <p>Sends the refund your megapool holds for you ({formatEth(refund)}) to your withdrawal address.</p>,
    tx: { canRoute: "megapool/can-claim-refund", route: "megapool/claim-refund", blockedReason: CAN_RULES["megapool/can-claim-refund"] },
    confirmLabel: "Claim refund",
  };
}

export function repayDebtFlow(debt: bigint): FlowConfig {
  return {
    title: "Repay your megapool debt",
    summary: (
      <p>
        Your megapool owes {formatEth(debt)} (for example after a penalty). While it owes anything you can't add validators.
        This pays it from your node wallet.
      </p>
    ),
    tx: {
      canRoute: "megapool/can-repay-debt",
      route: "megapool/repay-debt",
      params: { amountWei: debt.toString() },
      blockedReason: CAN_RULES["megapool/can-repay-debt"],
    },
    confirmLabel: "Repay debt",
  };
}

export function provisionTicketsFlow(): FlowConfig {
  return {
    title: "Set up your express tickets",
    summary: (
      <p>
        Your minipools earn express tickets: new validators with a ticket skip ahead in Rocket Pool's deposit queue. Your node sets
        them up automatically when gas is low; this does it now.
      </p>
    ),
    tx: {
      canRoute: "node/can-provision-express-tickets",
      route: "node/provision-express-tickets",
      blockedReason: CAN_RULES["node/can-provision-express-tickets"],
    },
    confirmLabel: "Set up tickets",
  };
}
