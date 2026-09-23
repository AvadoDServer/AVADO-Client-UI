import { render, screen } from "@testing-library/react";
import { Badge, Card, Input, Skeleton, Spinner, StatusPill, Table, TBody, TD, TH, THead, TR, cn } from "..";

describe("small UI pieces", () => {
  it("cn drops falsy parts", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("Card uses the surface tokens and the hairline border in dark", () => {
    render(<Card data-testid="card">x</Card>);
    expect(screen.getByTestId("card")).toHaveClass("bg-surface", "rounded-xl", "dark:border-border");
  });

  it("StatusPill shows the word, and a tone dot hidden from screen readers", () => {
    const { container } = render(<StatusPill status={{ tone: "warning", label: "Syncing 42%" }} />);
    expect(screen.getByText("Syncing 42%")).toHaveClass("text-warning-text");
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass("bg-warning");
  });

  it("Badge variants use *-text tokens for AA", () => {
    render(<Badge variant="danger">Slashed</Badge>);
    expect(screen.getByText("Slashed")).toHaveClass("text-danger-text", "bg-danger-subtle");
  });

  it("Input wires label, hint and error to the field", () => {
    const { rerender } = render(<Input label="Graffiti" hint="Up to 32 bytes" />);
    const field = screen.getByLabelText("Graffiti");
    expect(field).toHaveAccessibleDescription("Up to 32 bytes");
    rerender(<Input label="Graffiti" error="Too long" />);
    expect(screen.getByLabelText("Graffiti")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Graffiti")).toHaveAccessibleDescription("Too long");
  });

  it("Spinner is a labelled status; Skeleton is hidden from screen readers", () => {
    render(
      <>
        <Spinner label="Loading validators" />
        <Skeleton data-testid="sk" />
      </>,
    );
    expect(screen.getByRole("status", { name: "Loading validators" })).toBeInTheDocument();
    expect(screen.getByTestId("sk")).toHaveAttribute("aria-hidden", "true");
  });

  it("Table renders headers and cells with alignment", () => {
    render(
      <Table>
        <THead>
          <TR>
            <TH>Validator</TH>
            <TH align="right">Balance</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>412345</TD>
            <TD align="right">32.01 ETH</TD>
          </TR>
        </TBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Balance" })).toHaveClass("text-right");
    expect(screen.getByRole("cell", { name: "32.01 ETH" })).toHaveClass("text-right");
  });
});
