import { AdvancedIcon, HomeIcon, SettingsIcon } from "../../components/shell/icons";
import type { NavItem } from "../../components/shell/navItems";
import { WalletIcon } from "./icons";

export const QTUM_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/advanced", label: "Advanced", icon: AdvancedIcon, advanced: true },
];

export const visibleQtumNavItems = (isAdvanced: boolean): NavItem[] => QTUM_NAV_ITEMS.filter((i) => isAdvanced || !i.advanced);
