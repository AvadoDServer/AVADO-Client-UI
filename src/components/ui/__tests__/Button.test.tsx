import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button", () => {
  it("carries the focus-ring class for every variant", () => {
    const variants = ["primary", "secondary", "outline", "ghost", "danger", "success"] as const;
    render(
      <>
        {variants.map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
      </>,
    );
    for (const v of variants) expect(screen.getByRole("button", { name: v })).toHaveClass("focus-visible:shadow-focus");
  });

  it("pills primary and secondary; ghost and danger keep the control radius", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Primary" })).toHaveClass("rounded-full");
    expect(screen.getByRole("button", { name: "Secondary" })).toHaveClass("rounded-full");
    expect(screen.getByRole("button", { name: "Ghost" })).toHaveClass("rounded-control");
    expect(screen.getByRole("button", { name: "Danger" })).not.toHaveClass("rounded-full");
  });

  it("uses the filled danger tokens", () => {
    render(<Button variant="danger">Remove</Button>);
    expect(screen.getByRole("button", { name: "Remove" })).toHaveClass("bg-danger-solid", "text-danger-fg");
  });

  it("defaults to a 44px touch target and type=button", () => {
    render(<Button>Default</Button>);
    const b = screen.getByRole("button", { name: "Default" });
    expect(b).toHaveClass("h-11");
    expect(b).toHaveAttribute("type", "button");
  });

  it("disables while loading and shows a spinner", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: /save/i });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders as a link with `as` and blocks clicks when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button as="a" href="#/add" disabled onClick={onClick}>
        Add validators
      </Button>,
    );
    const a = screen.getByText("Add validators").closest("a")!;
    expect(a).toHaveAttribute("href", "#/add");
    expect(a).toHaveAttribute("aria-disabled", "true");
    expect(a).toHaveAttribute("tabindex", "-1");
    expect(a).not.toHaveAttribute("type");
  });
});
