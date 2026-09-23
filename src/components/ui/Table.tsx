import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

/**
 * Table primitives on the token system:
 *   <Table><THead><TR><TH/></TR></THead><TBody><TR><TD/></TR></TBody></Table>
 * Wrap in <Card padding="none"> for a framed look.
 */
export function Table({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function THead({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={className} {...props}>
      {children}
    </thead>
  );
}

export function TBody({ className, children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("[&>tr:hover]:bg-fg/[0.025] [&>tr]:border-t [&>tr]:border-border", className)} {...props}>
      {children}
    </tbody>
  );
}

export function TR({ className, children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors", className)} {...props}>
      {children}
    </tr>
  );
}

type Align = "left" | "right" | "center";

export function TH({ className, align = "left", children, ...props }: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: Align }) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-xs font-semibold text-fg-subtle",
        align === "right" && "text-right",
        align === "center" && "text-center",
        align === "left" && "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TD({ className, align = "left", children, ...props }: Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: Align }) {
  return (
    <td
      className={cn("px-4 py-3 align-middle text-fg", align === "right" && "text-right", align === "center" && "text-center", className)}
      {...props}
    >
      {children}
    </td>
  );
}

export default Table;
