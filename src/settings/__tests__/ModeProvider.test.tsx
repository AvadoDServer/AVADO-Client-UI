import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MODE_STORAGE_KEY, ModeProvider, useMode } from "../ModeProvider";

function Probe() {
  const { mode, isAdvanced, setMode } = useMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="adv">{String(isAdvanced)}</span>
      <button onClick={() => setMode("advanced")}>advanced</button>
      <button onClick={() => setMode("simple")}>simple</button>
    </div>
  );
}

describe("ModeProvider", () => {
  it("defaults to simple", () => {
    render(
      <ModeProvider>
        <Probe />
      </ModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("simple");
    expect(screen.getByTestId("adv")).toHaveTextContent("false");
  });

  it("persists the choice under avado.mode", async () => {
    render(
      <ModeProvider>
        <Probe />
      </ModeProvider>,
    );
    await userEvent.click(screen.getByText("advanced"));
    expect(screen.getByTestId("adv")).toHaveTextContent("true");
    expect(MODE_STORAGE_KEY).toBe("avado.mode");
    expect(localStorage.getItem("avado.mode")).toBe("advanced");
  });

  it("restores a stored mode and ignores junk", () => {
    localStorage.setItem("avado.mode", "advanced");
    const { unmount } = render(
      <ModeProvider>
        <Probe />
      </ModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("advanced");
    unmount();
    localStorage.setItem("avado.mode", "expert");
    render(
      <ModeProvider>
        <Probe />
      </ModeProvider>,
    );
    expect(screen.getByTestId("mode")).toHaveTextContent("simple");
  });
});
