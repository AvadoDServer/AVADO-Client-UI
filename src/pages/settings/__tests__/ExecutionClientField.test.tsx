import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { executionClientsForNetwork } from "../../../config/executionClients";
import { ExecutionClientField } from "../ExecutionClientField";

const CANDIDATES = executionClientsForNetwork("mainnet"); // Geth, Nethermind

describe("ExecutionClientField", () => {
  it("shows each candidate marked installed or not installed", () => {
    render(
      <ExecutionClientField
        candidates={CANDIDATES}
        value=""
        installedPackages={["ethchain-geth.public.dappnode.eth"]}
        onChange={() => {}}
      />,
    );
    const geth = screen.getByRole("radio", { name: "Geth" });
    const nethermind = screen.getByRole("radio", { name: "Nethermind" });
    expect(geth).toBeEnabled();
    expect(nethermind).toBeDisabled();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Not installed")).toBeInTheDocument();
  });

  it("shows Checking… while the installed-package list hasn't loaded yet", () => {
    render(<ExecutionClientField candidates={CANDIDATES} value="" installedPackages={null} onChange={() => {}} />);
    expect(screen.getAllByText("Checking…")).toHaveLength(2);
    // Nothing is known to be installed yet, so nothing is selectable.
    expect(screen.getByRole("radio", { name: "Geth" })).toBeDisabled();
  });

  it("calls onChange with the package name when an installed candidate is picked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ExecutionClientField
        candidates={CANDIDATES}
        value=""
        installedPackages={["ethchain-geth.public.dappnode.eth", "avado-dnp-nethermind.public.dappnode.eth"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Nethermind" }));
    expect(onChange).toHaveBeenCalledWith("avado-dnp-nethermind.public.dappnode.eth");
  });

  it("warns when the currently selected client is not installed", () => {
    render(
      <ExecutionClientField candidates={CANDIDATES} value="ethchain-geth.public.dappnode.eth" installedPackages={[]} onChange={() => {}} />,
    );
    expect(screen.getByText(/is not installed/i)).toBeInTheDocument();
  });

  it("does not warn while still checking, even if nothing is installed yet", () => {
    render(
      <ExecutionClientField candidates={CANDIDATES} value="ethchain-geth.public.dappnode.eth" installedPackages={null} onChange={() => {}} />,
    );
    expect(screen.queryByText(/is not installed/i)).not.toBeInTheDocument();
  });

  it("flags a configured value that isn't one of the known candidates, without crashing", () => {
    render(
      <ExecutionClientField candidates={CANDIDATES} value="someone-elses-geth.eth" installedPackages={[]} onChange={() => {}} />,
    );
    expect(screen.getByText(/someone-elses-geth\.eth/)).toBeInTheDocument();
    expect(screen.getByText(/not one of the known execution clients/)).toBeInTheDocument();
  });

  it("says so when a network has no known candidates", () => {
    render(<ExecutionClientField candidates={[]} value="" installedPackages={[]} onChange={() => {}} />);
    expect(screen.getByText(/No execution clients are known/)).toBeInTheDocument();
  });
});
