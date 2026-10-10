import { cn } from "../../components/ui";

export const APP_TITLE = "Rocket Pool";

/** Logo tile + app name: the sidebar brand and the phone top bar. */
export function RocketpoolIdentity({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex flex-shrink-0 items-center justify-center rounded-md bg-accent/15 font-display font-extrabold text-accent",
          size === "md" ? "h-10 w-10 text-sm" : "h-8 w-8 text-[0.8125rem]",
        )}
      >
        RP
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("truncate font-display font-bold tracking-tight text-fg", size === "md" ? "text-xl" : "text-lg")}>
          {APP_TITLE}
        </span>
        <span className="truncate text-xs font-medium text-fg-muted">Node</span>
      </span>
    </span>
  );
}
