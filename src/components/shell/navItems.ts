import type { ComponentType, SVGProps } from "react";
import type { Network } from "../../config/clientConfig";
import { AddIcon, AdvancedIcon, LidoIcon, SettingsIcon, ValidatorsIcon } from "./icons";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Only listed in Advanced mode (the route itself always works). */
  advanced?: boolean;
  /** Only listed on these networks (the route itself always works). */
  networks?: readonly Network[];
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Validators", icon: ValidatorsIcon },
  { to: "/add", label: "Add validators", icon: AddIcon },
  // Lido CSM runs on mainnet and Hoodi only.
  { to: "/lido", label: "Lido CSM", icon: LidoIcon, networks: ["mainnet", "hoodi"] },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/advanced", label: "Advanced", icon: AdvancedIcon, advanced: true },
];

export const visibleNavItems = (isAdvanced: boolean, network?: Network): NavItem[] =>
  NAV_ITEMS.filter((i) => (isAdvanced || !i.advanced) && (!i.networks || (network !== undefined && i.networks.includes(network))));
