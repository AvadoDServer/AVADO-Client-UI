import { AdvancedIcon, HomeIcon, ValidatorsIcon } from "../../components/shell/icons";
import type { NavItem } from "../../components/shell/navItems";
import { RewardsIcon, WalletIcon } from "./icons";

export const RP_NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/validators", label: "Validators", icon: ValidatorsIcon },
  { to: "/rewards", label: "Rewards", icon: RewardsIcon },
  { to: "/wallet", label: "Wallet", icon: WalletIcon },
  { to: "/advanced", label: "Advanced", icon: AdvancedIcon, advanced: true },
];

export const visibleRpNavItems = (isAdvanced: boolean): NavItem[] => RP_NAV_ITEMS.filter((i) => isAdvanced || !i.advanced);
