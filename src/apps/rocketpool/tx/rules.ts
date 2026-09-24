/**
 * When a `can-X` answer says no, and why, per route.
 *
 * Many Smartnode checks don't name their flag after the route
 * (`node/can-unstake-legacy-rpl` answers `canUnstake`, `megapool/can-exit-queue`
 * answers `canExit`), so the default "flag named after the route" rule would
 * never block them. Every route the app sends is listed here with its real
 * flag (shared/types/api/*.go at v1.24.2). A missing flag blocks: an
 * unexpected answer never lets a transaction through.
 */
import type { CanResponse } from "../api/models";

const GENERIC = "Rocket Pool says this can't be done right now. Try again later.";

type Reasons = Array<[flag: string, reason: string]>;

/** Blocked unless `flag` is true; the first reason flag that is set explains why. */
export function blockedUnless(flag: string, reasons: Reasons = [], fallback = GENERIC) {
  return (can: CanResponse): string | null => {
    if (can[flag] === true) return null;
    const hit = reasons.find(([k]) => can[k] === true);
    return hit ? hit[1] : fallback;
  };
}

const DIFFERENT_RPL_ADDRESS: Reasons[number] = [
  "hasDifferentRPLWithdrawalAddress",
  "Your node has a separate RPL withdrawal address, so only that address can do this (for example on the Rocket Pool website).",
];

/** The rules, by `can-X` route. Routes without a flag (claim-rewards, approval gas) have no entry. */
export const CAN_RULES = {
  "minipool/can-exit": blockedUnless("canExit", [["invalidStatus", "Only a minipool that is staking can be exited."]]),
  "megapool/can-exit-validator": blockedUnless("canExit", [["invalidStatus", "Only a validator that is staking can be exited."]]),
  "megapool/can-exit-queue": blockedUnless("canExit", [], "This validator can't leave the queue right now."),
  "megapool/can-distribute": blockedUnless("canDistribute", [
    ["megapoolNotDeployed", "Your node has no megapool yet."],
  ], "Your megapool rewards can't be paid out right now (for example while a validator is leaving). Try again later."),
  "megapool/can-claim-refund": blockedUnless("canClaim", [], "There is no refund to claim right now."),
  "megapool/can-repay-debt": blockedUnless("canRepay", [
    ["notEnoughDebt", "Your megapool doesn't owe that much."],
    ["notEnoughBalance", "The node wallet doesn't have enough ETH to repay the debt."],
  ]),
  "node/can-provision-express-tickets": blockedUnless("canProvision", [
    ["alreadyProvisioned", "Your express tickets are already set up."],
  ]),
  "node/can-stake-rpl": blockedUnless("canStake", [
    ["insufficientBalance", "The node wallet doesn't have that much RPL."],
    ["inConsensus", "The network is still settling this; try again later."],
  ]),
  "node/can-unstake-rpl": blockedUnless("canUnstake", [
    ["insufficientBalance", "You don't have that much RPL staked on your megapool."],
    DIFFERENT_RPL_ADDRESS,
  ]),
  // Smartnode's canUnstake leaves out the 15% rule (belowMaxRPLStake): the contract would refuse, so it blocks here.
  "node/can-unstake-legacy-rpl": (can: CanResponse): string | null => {
    const base = blockedUnless("canUnstake", [
      ["insufficientBalance", "You don't have that much legacy RPL staked."],
      DIFFERENT_RPL_ADDRESS,
    ])(can);
    if (base) return base;
    if (can.belowMaxRPLStake === true) {
      return "This would leave less legacy RPL staked than your minipools need (15% of the ETH they borrowed). Choose a smaller amount.";
    }
    return null;
  },
  "node/can-withdraw-rpl": blockedUnless("canWithdraw", [
    ["unstakingPeriodActive", "The unstaking period hasn't ended yet."],
    ["insufficientBalance", "There is no unstaked RPL to withdraw."],
    DIFFERENT_RPL_ADDRESS,
  ]),
  "node/can-claim-unclaimed-rewards": blockedUnless("canClaim", [], "These rewards can't be claimed right now."),
  "node/can-withdraw-credit": blockedUnless("canWithdraw", [["insufficientBalance", "Your credit balance is too small."]]),
  "node/can-withdraw-eth": blockedUnless("canWithdraw", [
    ["insufficientBalance", "There isn't that much ETH staked on behalf of your node."],
    ["hasDifferentWithdrawalAddress", "Only your withdrawal address can withdraw this ETH (for example on the Rocket Pool website)."],
  ]),
} as const satisfies Record<string, (can: CanResponse) => string | null>;

export type RuledCanRoute = keyof typeof CAN_RULES;
