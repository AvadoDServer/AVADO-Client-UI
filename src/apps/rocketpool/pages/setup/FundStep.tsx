import type { NodeStatus } from "../../api/models";
import { AddressLink, AutoTxNotice, CopyButton, Facts, Notice } from "../../components/common";
import { QrCode } from "../../components/QrCode";
import { formatEth, formatRpl } from "../../lib/units";

/** Step 2: the node wallet's address and QR code, what to send, and what's there. */
export function FundStep({ address, node }: { address?: string; node?: NodeStatus }) {
  if (!address) {
    return (
      <Notice tone="neutral" title="Reading your node wallet…">
        <p>The address shows here once Rocket Pool answers.</p>
      </Notice>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-fg">
        Send ETH to your node wallet from an exchange or another wallet. Only send ETH on the <strong>Ethereum mainnet</strong>.
      </p>
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        <div className="rounded-xl border border-border bg-white p-2">
          <QrCode value={address} label={`QR code of the node wallet address ${address}`} size={184} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-fg-muted">Node wallet address</p>
          <AddressLink value={address} />
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={address} label="Copy address" />
          </div>
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-fg">How much to send</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg">
          <li>
            <strong>4 ETH for each validator</strong> you want to run: your bond. Rocket Pool's stakers add the rest of the 32 ETH.
          </li>
          <li>
            <strong>About 0.05 ETH more</strong> for network fees: registering, setting up, and what the node does by itself later.
          </li>
          <li>RPL (Rocket Pool's own token) is not needed to start.</li>
        </ul>
      </div>
      {node && (
        <Facts
          testId="wallet-balances"
          rows={[
            ["ETH in the node wallet", formatEth(node.accountBalances.eth)],
            ["RPL in the node wallet", formatRpl(node.accountBalances.rpl)],
          ]}
        />
      )}
      <AutoTxNotice />
    </div>
  );
}

export default FundStep;
