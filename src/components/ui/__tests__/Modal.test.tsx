import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} title="Hidden" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a labelled modal dialog that closes on Escape, the close button and the backdrop", async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Set fee recipient" onClose={onClose}>
        Body
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Set fee recipient" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    await userEvent.click(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("locks body scroll while open", () => {
    const { unmount } = render(<Modal open title="T" />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("ConfirmDialog", () => {
  it("puts Cancel first and calls the right handler", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Stop Nimbus?" confirmLabel="Stop" onConfirm={onConfirm} onCancel={onCancel}>
        Your validators stop until you start it again.
      </ConfirmDialog>,
    );
    const buttons = screen.getAllByRole("button").filter((b) => b.textContent === "Cancel" || b.textContent === "Stop");
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Stop"]);
    expect(screen.getByRole("button", { name: "Stop" })).toHaveClass("bg-danger-solid");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("with requireText, enables confirm only after the exact text is typed", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog open title="Exit validator" confirmLabel="Exit" requireText="412345" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const confirm = screen.getByRole("button", { name: "Exit" });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText("Type 412345 to confirm");
    await userEvent.type(input, "41234");
    expect(confirm).toBeDisabled();
    await userEvent.type(input, "5");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("Modal focus management", () => {
  function Harness({ open }: { open: boolean }) {
    return (
      <>
        <button>Outside</button>
        <Modal open={open} title="Remove validator" onClose={() => {}} footer={<button>Remove</button>}>
          <input aria-label="Reason" />
        </Modal>
      </>
    );
  }

  it("moves focus into the dialog when it opens", async () => {
    render(<Harness open />);
    await vi.waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last", async () => {
    render(<Harness open />);
    const close = screen.getByRole("button", { name: "Close dialog" });
    const reason = screen.getByLabelText("Reason");
    const remove = screen.getByRole("button", { name: "Remove" });
    await vi.waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());

    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(reason).toHaveFocus();
    await userEvent.tab();
    expect(remove).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(remove).toHaveFocus();
    expect(screen.getByRole("button", { name: "Outside" })).not.toHaveFocus();
  });

  it("Shift+Tab from the panel itself goes to the last control", async () => {
    render(<Harness open />);
    await vi.waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Remove" })).toHaveFocus();
  });

  it("returns focus to the element that opened it", async () => {
    const { rerender } = render(<Harness open={false} />);
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    rerender(<Harness open />);
    await vi.waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    rerender(<Harness open={false} />);
    expect(outside).toHaveFocus();
  });

  it("makes #root inert while open, and restores it after", () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    try {
      const { rerender } = render(<Harness open />);
      expect(root).toHaveAttribute("inert");
      rerender(<Harness open={false} />);
      expect(root).not.toHaveAttribute("inert");
    } finally {
      root.remove();
    }
  });
});
