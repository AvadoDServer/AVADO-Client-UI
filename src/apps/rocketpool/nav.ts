import { HomeIcon } from "../../components/shell/icons";
import type { NavItem } from "../../components/shell/navItems";

export const RP_NAV_ITEMS: NavItem[] = [{ to: "/", label: "Rocket Pool", icon: HomeIcon }];

export const visibleRpNavItems = (isAdvanced: boolean): NavItem[] => RP_NAV_ITEMS.filter((i) => isAdvanced || !i.advanced);
