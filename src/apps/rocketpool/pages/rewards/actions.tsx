import { formatEth, formatRpl, shortAddress } from "../../lib/units";
import { CAN_RULES } from "../../tx/rules";
import { distributeFeeDistributorFlow, distributeMegapoolFlow, distributeMinipoolFlow, type FlowConfig } from "../validators/actions";
import type { ClaimItem } from "./model";

/** The flow that claims one item. `restakeRpl` (periodic rewards only): stake this much of the RPL again instead of paying it out. */
export function claimFlow(item: ClaimItem, { nodeAddress, restakeRpl = 0n }: { nodeAddress: string; restakeRpl?: bigint }): FlowConfig {
  switch (item.kind) {
    case "megapool":
      return distributeMegapoolFlow(item.eth);
    case "minipool":
      return distributeMinipoolFlow(item.address!);
    case "fee-distributor":
      return distributeFeeDistributorFlow(item.eth);
    case "periodic": {
      const indices = (item.indices ?? []).join(",");
      // A restake never quietly turns into a plain claim: an amount above the claimed RPL is refused below.
      const restake = restakeRpl > 0n ? restakeRpl : 0n;
      return {
        title: restake > 0n ? "Claim your rewards and stake RPL" : "Claim your periodic rewards",
        summary: (
          <div className="flex flex-col gap-2">
            <p>
              Claims {formatRpl(item.rpl)}
              {item.eth > 0n ? ` and ${formatEth(item.eth)}` : ""} from {item.indices?.length ?? 0} reward period
              {item.indices?.length === 1 ? "" : "s"}.
            </p>
            {restake > 0n ? (
              <p>
                {formatRpl(restake)} is staked on your node again; the rest
                {item.eth > 0n ? " and the ETH go" : " goes"} to your withdrawal address.
              </p>
            ) : (
              <p>It is paid to your withdrawal address.</p>
            )}
          </div>
        ),
        tx:
          restake > 0n
            ? {
                canRoute: "node/can-claim-and-stake-rewards",
                route: "node/claim-and-stake-rewards",
                params: { indices, stakeAmount: restake.toString() },
                blockedReason: () => (restake > item.rpl ? `You can stake at most the ${formatRpl(item.rpl)} you claim.` : null),
              }
            : { canRoute: "node/can-claim-rewards", route: "node/claim-rewards", params: { indices } },
        confirmLabel: restake > 0n ? "Claim and stake" : "Claim",
      };
    }
    case "unclaimed":
      return {
        title: "Claim rewards that couldn't be delivered",
        summary: <p>Sends {formatEth(item.eth)} of earlier rewards to your withdrawal address again.</p>,
        tx: {
          canRoute: "node/can-claim-unclaimed-rewards",
          route: "node/claim-unclaimed-rewards",
          params: { nodeAddress: nodeAddress.toLowerCase() },
          blockedReason: CAN_RULES["node/can-claim-unclaimed-rewards"],
        },
        confirmLabel: "Claim",
      };
    case "credit":
      return {
        title: "Withdraw your credit",
        summary: (
          <p>
            Withdraws your credit of {formatEth(item.eth)}. It is paid as the same value in rETH (Rocket Pool's staked ETH token) to
            your withdrawal address. You can also leave it and use it for a new validator.
          </p>
        ),
        tx: {
          canRoute: "node/can-withdraw-credit",
          route: "node/withdraw-credit",
          params: { amountWei: item.eth.toString() },
          blockedReason: CAN_RULES["node/can-withdraw-credit"],
        },
        confirmLabel: "Withdraw",
      };
    case "eth-on-behalf":
      return {
        title: "Withdraw the ETH staked on your behalf",
        summary: <p>Withdraws {formatEth(item.eth)} to your withdrawal address.</p>,
        tx: {
          canRoute: "node/can-withdraw-eth",
          route: "node/withdraw-eth",
          params: { amountWei: item.eth.toString() },
          blockedReason: CAN_RULES["node/can-withdraw-eth"],
        },
        confirmLabel: "Withdraw",
      };
  }
}

/** "Minipool 0x12…abcd": the item's own name in lists. */
export const itemLabel = (item: ClaimItem) => (item.address ? `${item.title}: minipool ${shortAddress(item.address)}` : item.title);
