/**
 * The Validators page's actions, each as the props of one TransactionFlow:
 * what it does in plain words, the check and write routes, and when it is
 * blocked. Exits are irreversible: they need the owner to type a code and
 * say so plainly.
 */
import type { ReactNode } from "react";
import type {
  CanDistributeFeeDistributor,
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
        good and stops earning rewards. To stake again you need a new validator and a new deposit.
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
      Check the validator on beaconcha.in<span className="sr-only"> (a website that shows every validator; opens in a new tab)</span>
    </a>
  );
}

const exitOffChain = (pubkey: string) => ({
  sendingText: "Sending the exit request…",
  doneTitle: "Exit requested",
  doneText: (
    <>
      <p>The network has the exit request. Within a few minutes the validator shows as exiting.</p>
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
          Once its ETH is back, close the minipool here: that pays out your bond and rewards to your withdrawal address.
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
    requireTextIgnoreCase: true,
  };
}

export function distributeMinipoolFlow(address: string): FlowConfig {
  const find = (can: CanResponse) =>
    ((can as unknown as MinipoolDistributeDetailsResponse).details ?? []).find((d) => sameAddress(d.address, address));
  return {
    title: `Pay out the rewards of minipool ${shortAddress(address)}`,
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
        return d.canDistribute ? null : "There is nothing to pay out in this minipool right now.";
      },
      gasLimits: (can) => find(can)?.gasLimits,
      details: (can) => {
        const d = find(can);
        if (!d) return null;
        const yours = minipoolPayout(d);
        return (
          <p>
            You receive about <strong>{formatEth(yours)}</strong> of the {formatEth(d.balance)} in the minipool.
          </p>
        );
      },
    },
    confirmLabel: "Pay out",
  };
}

/**
 * The node's part of a minipool distribution, as Smartnode's claim-all counts
 * it: for a dissolved minipool its whole balance (Smartnode already reports
 * that as the node share, so the refund is not added again).
 */
export function minipoolPayout(d: { status: string; balance: unknown; nodeShareOfBalance: unknown; refund: unknown }): bigint {
  const big = (v: unknown) => toBigInt(v as string | number | null | undefined) ?? 0n;
  return d.status === "Dissolved" ? big(d.balance) : big(d.nodeShareOfBalance) + big(d.refund);
}

/** Pay out the fee distributor (tips and MEV of minipools outside the smoothing pool). */
export function distributeFeeDistributorFlow(approxShare?: bigint, title = "Pay out your minipools' block rewards"): FlowConfig {
  return {
    title,
    summary: (
      <p>
        Pays out the block rewards (tips paid by Ethereum users) your minipools collected in their fee distributor, a contract that holds
        them until paid out. Your share{approxShare !== undefined ? ` (about ${formatEth(approxShare)})` : ""} goes to your withdrawal
        address, the rest to Rocket Pool's stakers.
      </p>
    ),
    tx: {
      canRoute: "node/can-distribute",
      route: "node/distribute",
      blockedReason: (can: CanResponse) =>
        (toBigInt((can as CanDistributeFeeDistributor).balance) ?? 0n) > 0n ? null : "There is nothing to pay out right now.",
    },
    confirmLabel: "Pay out",
  };
}

/**
 * Close an exited minipool with one transaction (`bundle=false`), or, as an
 * Advanced option, with Smartnode's Flashbots bundle (empty the fee
 * distributor, then close, in the same block). A bundle is often not
 * included at the normal tip; the default is the two-step close
 * (`CloseMinipoolFlow`: distribute the fee distributor, then this).
 */
export function closeMinipoolFlow(address: string, { bundle = false, title }: { bundle?: boolean; title?: string } = {}): FlowConfig {
  const find = (can: CanResponse) =>
    ((can as unknown as MinipoolCloseDetailsResponse).details ?? []).find((d) => sameAddress(d.address, address));
  return {
    title: title ?? (bundle ? `Close minipool ${shortAddress(address)} in one bundle` : `Close minipool ${shortAddress(address)}`),
    summary: (
      <div className="flex flex-col gap-2">
        <p>Pays out this exited minipool: your bond and rewards go to your withdrawal address, and the minipool is closed.</p>
        {bundle && (
          <>
            <p>
              Your fee distributor is paid out in the same block: two transactions sent together as a bundle (the first pays out the
              fee distributor, your share also goes to your withdrawal address; the second closes the minipool).
            </p>
            <p>
              Bundles are often not included at the normal tip. If it isn't, nothing is paid and no fee is charged: then use{" "}
              <strong>Close minipool</strong> instead, which does the same in two steps.
            </p>
          </>
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
          return "Closing a minipool needs your node's fee distributor (the contract that collects your minipools' block rewards), and it isn't set up yet. This page can't set it up: contact AVADO support.";
        }
        const d = find(can);
        if (!d) return "Rocket Pool didn't report this minipool.";
        if (d.isFinalized) return "This minipool is already closed.";
        if (!d.canClose) {
          if (d.minipoolVersion < 3) return "This minipool uses an old contract version and can't be closed safely yet. Contact AVADO support.";
          if (d.minipoolStatus !== "Dissolved" && d.beaconState !== "withdrawal_done") {
            return "Its ETH isn't back yet. Exit it first, then wait until its ETH has arrived (this can take days to weeks).";
          }
          return "Rocket Pool says it can't be closed right now. Try again later.";
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
              You receive about <strong>{formatEth(yours)}</strong> of the {formatEth(d.balance)} in the minipool
              {bundle ? ", plus your share of the fee distributor" : ""}.
            </p>
            {d.minipoolStatus !== "Dissolved" && distributable < WEI_32 && (
              <p role="note" className="rounded-lg border border-warning/30 bg-warning-subtle p-3 text-warning-text">
                Its balance is below 32 ETH, so part of your bond covers the difference: you get back less than you put in.
              </p>
            )}
          </div>
        );
      },
      extraGas: bundle ? { gas: CLOSE_BUNDLE_EXTRA_GAS, label: "Second transaction (close); the gas limit above is the first (fee distributor)" } : undefined,
    },
    confirmLabel: bundle ? "Close in one bundle" : "Close minipool",
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
        <li>Once it has left, Rocket Pool settles its ETH by itself; your share then shows in your megapool.</li>
        <li>
          To confirm, type the validator's number: <span className="font-mono font-semibold text-fg">{index}</span>.
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
          Validator {id} stops waiting in line and will not start. Its bond comes back to your node as credit, which you can use for
          a new validator, or withdraw on the Rewards page as rETH (Rocket Pool's staked-ETH token, worth the same).
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
    title: "Pay out your megapool rewards",
    summary: (
      <p>
        Pays out the block rewards collected in your megapool: your share goes to your withdrawal address, the rest to Rocket Pool's
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
        if (!c.megapoolNotDeployed && c.lastDistributionTime === 0) return "None of your megapool validators is validating yet, so there is nothing to pay out.";
        return why.length ? `It can't be paid out while ${why.join(" and ")}. Try again once that is done.` : base;
      },
      details: () =>
        pendingNodeShare !== undefined && pendingNodeShare !== null ? (
          <p>
            Your share right now: about <strong>{formatEth(pendingNodeShare)}</strong>.
          </p>
        ) : null,
    },
    confirmLabel: "Pay out",
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

/**
 * Update the megapool to Rocket Pool's newest contract version
 * (`megapool/delegate-upgrade {address}`). The check answers only a gas
 * estimate (no flag). One lock for the route: a node has one megapool.
 */
export function updateMegapoolFlow(megapoolAddress: string, expired: boolean): FlowConfig {
  return {
    title: "Update your megapool contract",
    summary: (
      <div className="flex flex-col gap-2">
        <p>
          Switches your megapool to Rocket Pool's newest contract version. Your validators, bond and rewards stay exactly as they are;
          only the code that runs your megapool is updated.
        </p>
        <p>
          {expired
            ? "The current version has expired, so some actions don't work until it is updated. Rocket Pool will update it for you in time; this does it now."
            : "This is optional for now: the current version keeps working until it expires. After that Rocket Pool updates it for you."}
        </p>
      </div>
    ),
    tx: {
      canRoute: "megapool/can-delegate-upgrade",
      route: "megapool/delegate-upgrade",
      params: { address: megapoolAddress.toLowerCase() },
      lockKey: pendingKey("megapool/delegate-upgrade"),
      blockedReason: () => null,
    },
    confirmLabel: "Update",
  };
}

export function provisionTicketsFlow(): FlowConfig {
  return {
    title: "Set up your express tickets",
    summary: (
      <p>
        Your minipools earned express tickets: a new validator with a ticket skips ahead in Rocket Pool's waiting line. Your node
        sets them up by itself when network fees are low; this does it now.
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
