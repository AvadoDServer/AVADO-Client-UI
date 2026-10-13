import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "./renderPage";

const fee = () => screen.getByLabelText("Delegation fee (%)");
const min = () => screen.getByLabelText("Minimum delegation (QTUM)");
const save = () => screen.getByRole("button", { name: "Save" });

describe("Settings", () => {
  it("shows the saved delegation settings; nothing to save until something changes", async () => {
    renderPage("/settings");
    await waitFor(() => expect(fee()).toHaveValue("10"));
    expect(min()).toHaveValue("100");
    expect(save()).toBeDisabled();
  });

  it("checks the values like the monitor does", async () => {
    renderPage("/settings");
    await waitFor(() => expect(fee()).toHaveValue("10"));
    await userEvent.clear(fee());
    await userEvent.type(fee(), "12.5");
    expect(screen.getByText("The delegation fee must be a whole number from 0 to 100.")).toBeInTheDocument();
    await userEvent.clear(fee());
    await userEvent.type(fee(), "101");
    expect(screen.getByText("The delegation fee must be a whole number from 0 to 100.")).toBeInTheDocument();
    await userEvent.clear(min());
    await userEvent.type(min(), "-1");
    expect(screen.getByText("The minimum delegation amount must be a number of 0 or more.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("saves only what changed, and says the node restarts", async () => {
    const { posts, api } = renderPage("/settings");
    await waitFor(() => expect(fee()).toHaveValue("10"));
    await userEvent.clear(fee());
    await userEvent.type(fee(), "15");
    await userEvent.click(save());
    expect(await screen.findByTestId("delegation-outcome")).toHaveTextContent("Saved. The Qtum node restarts with the new settings");
    expect(posts()).toEqual([{ kind: "POST", path: "/setenv", params: { DELEGATION_FEE_PERCENT: 15 } }]);
    expect(api.state.settings.DELEGATION_FEE_PERCENT).toBe(15);
  });

  it("a refusal from the monitor is shown in its words", async () => {
    renderPage("/settings", { failures: { "/setenv": { status: 400, detail: "The minimum delegation amount must be a number of 0 or more." } } });
    await waitFor(() => expect(min()).toHaveValue("100"));
    await userEvent.clear(min());
    await userEvent.type(min(), "250.5");
    await userEvent.click(save());
    expect(await screen.findByTestId("delegation-outcome")).toHaveTextContent("The minimum delegation amount must be a number of 0 or more.");
  });

  it("restarts the node after asking", async () => {
    const { posts, api } = renderPage("/settings");
    await userEvent.click(screen.getByRole("button", { name: "Restart the node" }));
    const dialog = screen.getByRole("dialog", { name: "Restart the Qtum node?" });
    expect(dialog).toHaveTextContent("Staking pauses for a few minutes while it starts.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Restart" }));
    expect(await screen.findByTestId("restart-outcome")).toHaveTextContent("The Qtum node is restarting.");
    expect(posts()).toEqual([{ kind: "POST", path: "/restartQtum", params: undefined }]);
    expect(api.state.walletStatus.state).toBe("restarting");
  });

  it("cancelling the restart sends nothing", async () => {
    const { posts } = renderPage("/settings");
    await userEvent.click(screen.getByRole("button", { name: "Restart the node" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(posts()).toEqual([]);
  });
});
