import { useClientConfig } from "../../config/ClientConfigProvider";
import { cn } from "../ui";
import { CLIENT_TITLE, LOGO_NEEDS_PLATE, NETWORK_TITLE, clientLogo } from "./identity";

/** Logo tile + client name + network: the sidebar brand and the phone top bar. */
export function ClientIdentity({ size = "md" }: { size?: "sm" | "md" }) {
  const { client, network } = useClientConfig();
  const plate = LOGO_NEEDS_PLATE[client];
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md",
          size === "md" ? "h-10 w-10" : "h-8 w-8",
          // A light plate in both themes (surface is white in light, fg is near-white in dark).
          plate && "bg-surface p-1 dark:bg-fg",
        )}
      >
        <img src={clientLogo(client, network)} alt="" className="h-full w-full object-contain" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={cn("truncate font-display font-bold tracking-tight text-fg", size === "md" ? "text-xl" : "text-lg")}>
          {CLIENT_TITLE[client]}
        </span>
        <span className="truncate text-xs font-medium text-fg-muted">{NETWORK_TITLE[network]}</span>
      </span>
    </span>
  );
}
