import { useState } from "react";
import { Button, Input } from "../../../../components/ui";
import type { CanSetWithdrawalAddressResponse, NodeStatus } from "../../api/models";
import { Address, AddressLink, ExternalLink, Notice } from "../../components/common";
import { isAddress } from "../../lib/explorer";
import { isZeroAddress, sameAddress } from "../../lib/units";
import { CONFIRM_WITHDRAWAL_URL } from "../../status/problems";
import { TransactionFlow, defaultBlockedReason } from "../../tx/TransactionFlow";

/** Why a typed withdrawal address can't be used, in plain words; null when it can. */
export function withdrawalAddressProblem(input: string, node: Pick<NodeStatus, "accountAddress">): string | null {
  const a = input.trim();
  if (!a) return "Enter the address of your own wallet.";
  if (!isAddress(a)) return "Not an Ethereum address: it starts with 0x followed by 40 characters (0-9, a-f).";
  if (isZeroAddress(a)) return "That is the empty address.";
  if (sameAddress(a, node.accountAddress)) return "That is this AVADO's node wallet. Use a wallet you control outside the AVADO.";
  return null;
}

function ConfirmSteps({ address }: { address: string }) {
  return (
    <ol className="flex list-decimal flex-col gap-1 pl-5">
      <li>
        Open <ExternalLink href={CONFIRM_WITHDRAWAL_URL}>the Rocket Pool website</ExternalLink> on a computer that has the wallet{" "}
        <Address value={address} />.
      </li>
      <li>Connect that wallet and confirm it as the withdrawal address. This costs a small network fee from that wallet.</li>
    </ol>
  );
}

/**
 * Step 4: the primary withdrawal address, set from the node wallet with
 * `confirm=false`: it stays pending until the new address confirms it from
 * its own wallet, so a mistyped address can never take effect.
 */
export function WithdrawalStep({ node, onChanged }: { node?: NodeStatus; onChanged: () => void }) {
  const [input, setInput] = useState("");
  const [touched, setTouched] = useState(false);
  const [owned, setOwned] = useState(false);
  const [open, setOpen] = useState(false);
  /** The address the dialog sends: fixed when the owner submits. */
  const [target, setTarget] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!node) {
    return (
      <Notice tone="neutral" title="Reading your node…">
        <p>This fills in once Rocket Pool answers.</p>
      </Notice>
    );
  }

  const current = node.primaryWithdrawalAddress;
  const hot = isZeroAddress(current) || sameAddress(current, node.accountAddress);
  const pending = isZeroAddress(node.pendingPrimaryWithdrawalAddress) ? null : node.pendingPrimaryWithdrawalAddress;

  if (!hot) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="success" title="Your withdrawal address is a wallet outside this AVADO">
          <p>
            <AddressLink value={current} />
          </p>
          <p>
            To change it later, use the Rocket Pool website with that wallet: only the current withdrawal address can change it.
          </p>
        </Notice>
      </div>
    );
  }

  const problem = withdrawalAddressProblem(input, node);
  const waiting = sentTo ?? pending;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        Your staked ETH and your rewards are paid to the <strong>withdrawal address</strong>. Right now that is this AVADO's node wallet.
        We strongly recommend a wallet you control outside the AVADO, ideally a hardware wallet: then your ETH is safe even if the AVADO
        is lost or broken.
      </p>

      {waiting && (
        <Notice tone="accent" title="Waiting for your confirmation" testId="withdrawal-pending">
          <p>
            <Address value={waiting} /> is set as the new withdrawal address, but it only takes effect after you confirm it from that
            wallet. Until then the node wallet stays the withdrawal address.
          </p>
          <ConfirmSteps address={waiting} />
        </Notice>
      )}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (problem || !owned) return;
          setTarget(input.trim());
          setOpen(true);
        }}
      >
        <p className="text-sm font-semibold text-fg">{waiting ? "Set a different address instead" : "Set your withdrawal address"}</p>
        <Input
          label="Withdrawal address"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched && problem ? problem : undefined}
          hint="Copy it from your wallet app. Don't type it by hand."
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <label className="flex items-start gap-3 text-sm text-fg">
          <input type="checkbox" className="mt-1 h-4 w-4 flex-shrink-0 accent-[rgb(var(--accent))]" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
          <span>This is my own wallet, and I have its recovery phrase or hardware device. It is not an exchange address.</span>
        </label>
        <Notice tone="neutral" title="How it works">
          <p>
            The node wallet proposes the new address. It only becomes your withdrawal address after you confirm it from that wallet on the
            Rocket Pool website. A wrong address can therefore never take over: without its confirmation nothing changes.
          </p>
        </Notice>
        <div>
          <Button type="submit" variant="primary" disabled={!owned}>
            Set withdrawal address
          </Button>
        </div>
      </form>

      <TransactionFlow<CanSetWithdrawalAddressResponse>
        open={open}
        title="Set your withdrawal address"
        summary={
          <>
            Proposes <Address value={target} /> as your node's withdrawal address. It takes effect after you confirm it from that wallet on
            the Rocket Pool website.
          </>
        }
        tx={{
          canRoute: "node/can-set-primary-withdrawal-address",
          route: "node/set-primary-withdrawal-address",
          params: { address: target, confirm: "false" },
          blockedReason: (can) =>
            can.canSet === false ? "Rocket Pool says the withdrawal address can't be set right now." : defaultBlockedReason(can, "node/can-set-primary-withdrawal-address"),
        }}
        confirmLabel="Set address"
        onClose={() => setOpen(false)}
        onDone={() => {
          setSentTo(target);
          setInput("");
          setTouched(false);
          setOwned(false);
          onChanged();
        }}
      />
    </div>
  );
}

export default WithdrawalStep;
