import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Select } from "../../../../components/ui";
import type { CanRegisterResponse, NodeStatus } from "../../api/models";
import { Notice } from "../../components/common";
import { defaultTimezone, timezoneOptions } from "../../lib/timezones";
import { toBigInt } from "../../lib/units";
import { TransactionFlow } from "../../tx/TransactionFlow";

/** Step 3: register the node with Rocket Pool (one transaction, with its time zone). */
export function RegisterStep({ node, onChanged }: { node?: NodeStatus; onChanged: () => void }) {
  const zones = useMemo(() => timezoneOptions(), []);
  const [zone, setZone] = useState(() => {
    const d = defaultTimezone();
    return zones.includes(d) ? d : "Etc/UTC";
  });
  const [open, setOpen] = useState(false);

  if (!node) {
    return (
      <Notice tone="neutral" title="Reading your node…">
        <p>This fills in once Rocket Pool answers.</p>
      </Notice>
    );
  }
  if (node.registered) {
    return (
      <Notice tone="success" title="Your node is registered with Rocket Pool">
        {node.timezoneLocation && <p>Time zone: {node.timezoneLocation}</p>}
      </Notice>
    );
  }
  const empty = (toBigInt(node.accountBalances?.eth) ?? 0n) === 0n;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg">
        Registering tells Rocket Pool about your node. It is one transaction from the node wallet. Rocket Pool also records a time zone
        for its public map of nodes: choose your own or a nearby one. It isn't used for anything else.
      </p>
      {empty && (
        <Notice tone="warning" title="The node wallet has no ETH yet">
          <p>
            Registering needs a small network fee. <Link className="font-semibold text-accent underline underline-offset-2" to="/setup/fund">Add ETH first</Link>.
          </p>
        </Notice>
      )}
      <Select label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)} className="max-w-sm">
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
      <div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          Register the node
        </Button>
      </div>
      <TransactionFlow<CanRegisterResponse>
        open={open}
        title="Register your node"
        summary={
          <>
            Registers this node with Rocket Pool, in the time zone <strong className="text-fg">{zone.replace(/_/g, " ")}</strong>.
          </>
        }
        tx={{ canRoute: "node/can-register", route: "node/register", params: { timezoneLocation: zone } }}
        confirmLabel="Register"
        onClose={() => setOpen(false)}
        onDone={onChanged}
      />
    </div>
  );
}

export default RegisterStep;
