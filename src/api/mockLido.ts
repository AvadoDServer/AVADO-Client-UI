/**
 * A Lido CSM box for `VITE_MOCK=1 VITE_MOCK_LIDO=1 yarn dev` and the Lido
 * tests: the usual five mock validators plus three Lido CSM validators.
 *
 *  - `lidoActive`: active, sends its block rewards to Lido (as required).
 *  - `lidoWrongFee`: active, but follows the owner's default fee recipient,
 *    so the Lido page and the Validators page warn about it.
 *  - `lidoQueued`: on the node, not deposited by Lido yet (the beacon node
 *    doesn't know it), no fee recipient set: only a deposit data file tells
 *    the UI it is a Lido key. `mockLidoDepositData()` is that file.
 */
import { LIDO_NETWORKS } from "../lib/lido";
import { fakeHex, MOCK_BEACON_VALIDATORS, MOCK_OVERRIDE_FEE_RECIPIENT, MOCK_PUBKEYS, type MockOptions } from "./mock";
import type { ValidatorState } from "./types";

const lido = LIDO_NETWORKS.mainnet!;
const FAR = "18446744073709551615";

export const MOCK_LIDO_PUBKEYS = {
  lidoActive: fakeHex(41, 48),
  lidoWrongFee: fakeHex(42, 48),
  lidoQueued: fakeHex(43, 48),
} as const;

/** 0x01 credentials paying out to Lido's withdrawal vault on mainnet. */
export const MOCK_LIDO_CREDENTIALS = `0x01${"00".repeat(11)}${lido.withdrawalVault.slice(2).toLowerCase()}`;

function lidoValidator(pubkey: string, index: number): ValidatorState {
  return {
    index: String(index),
    balance: "32004567890",
    status: "active_ongoing",
    validator: {
      pubkey,
      withdrawal_credentials: MOCK_LIDO_CREDENTIALS,
      effective_balance: "32000000000",
      slashed: false,
      activation_eligibility_epoch: "401220",
      activation_epoch: "401500",
      exit_epoch: FAR,
      withdrawable_epoch: FAR,
    },
  };
}

/** Mock options for a box running Lido CSM validators next to its own. */
export function mockLidoOptions(extra: MockOptions = {}): MockOptions {
  return {
    keystores: [...Object.values(MOCK_PUBKEYS), ...Object.values(MOCK_LIDO_PUBKEYS)],
    beaconValidators: [
      ...MOCK_BEACON_VALIDATORS,
      lidoValidator(MOCK_LIDO_PUBKEYS.lidoActive, 1874411),
      lidoValidator(MOCK_LIDO_PUBKEYS.lidoWrongFee, 1874412),
    ],
    feeRecipients: {
      [MOCK_PUBKEYS.active02]: MOCK_OVERRIDE_FEE_RECIPIENT,
      [MOCK_LIDO_PUBKEYS.lidoActive]: lido.elRewardsVault,
    },
    ...extra,
  };
}

/** A deposit data file as Lido's key guide makes it, for the given pubkeys (mainnet). */
export function mockLidoDepositData(pubkeys: string[], credentials = MOCK_LIDO_CREDENTIALS): string {
  return JSON.stringify(
    pubkeys.map((pubkey, i) => ({
      pubkey: pubkey.slice(2),
      withdrawal_credentials: credentials.slice(2),
      amount: 32000000000,
      signature: fakeHex(7000 + i, 96).slice(2),
      deposit_message_root: fakeHex(8000 + i, 32).slice(2),
      deposit_data_root: fakeHex(9000 + i, 32).slice(2),
      fork_version: "00000000",
      network_name: "mainnet",
      deposit_cli_version: "1.3.0",
    })),
  );
}
