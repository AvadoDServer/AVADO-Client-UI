import type { ComponentType, SVGProps } from "react";
import { AddIcon, AdvancedIcon, SettingsIcon, ValidatorsIcon } from "./icons";

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Only listed in Advanced mode (the route itself always works). */
  advanced?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Validators", icon: ValidatorsIcon },
  { to: "/add", label: "Add validators", icon: AddIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/advanced", label: "Advanced", icon: AdvancedIcon, advanced: true },
];

export const visibleNavItems = (isAdvanced: boolean): NavItem[] => NAV_ITEMS.filter((i) => isAdvanced || !i.advanced);
