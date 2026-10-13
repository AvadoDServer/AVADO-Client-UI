import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { ShellFrame } from "../../components/shell/ShellFrame";
import { useMode } from "../../settings/ModeProvider";
import { WalletBanner } from "./banners/WalletBanner";
import { APP_TITLE, QtumIdentity } from "./identity";
import { visibleQtumNavItems } from "./nav";
import { AppStatusProvider, useAppStatus } from "./status/AppStatus";
import { QtumStatusStrip } from "./status/QtumStatusStrip";

function Frame() {
  const { isAdvanced } = useMode();
  const { problems } = useAppStatus();
  return (
    <ShellFrame
      brand={<QtumIdentity />}
      compactBrand={<QtumIdentity size="sm" />}
      items={visibleQtumNavItems(isAdvanced)}
      strip={<QtumStatusStrip />}
      problems={problems}
    >
      <WalletBanner />
      <Outlet />
    </ShellFrame>
  );
}

/** The Qtum app's shell: the shared frame with its identity, the node status strip, the wallet banners and the pages. */
export function QtumShell() {
  useEffect(() => {
    document.title = `AVADO ${APP_TITLE}`;
  }, []);
  return (
    <AppStatusProvider>
      <Frame />
    </AppStatusProvider>
  );
}

export default QtumShell;
