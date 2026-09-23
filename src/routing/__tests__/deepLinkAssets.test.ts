// @vitest-environment node
import viteConfig from "../../../vite.config";
import { CLIENT_CONFIG_URL } from "../../config/clientConfig";

// Final review M1: with a relative base, http://nimbus.my.ava.do/settings/
// asked for /settings/assets/*.js, got index.html back and rendered blank.
// Everything the page loads itself must be absolute from the web root.
describe("deep links such as /settings/ load the app", () => {
  it("builds asset URLs absolute from the web root", () => {
    expect((viteConfig as { base?: string }).base).toBe("/");
  });

  it("reads client-config.json from the web root", () => {
    expect(CLIENT_CONFIG_URL).toBe("/client-config.json");
    // Resolves to the same file from any depth.
    for (const page of ["http://nimbus.my.ava.do/", "http://nimbus.my.ava.do/settings/", "http://nimbus.my.ava.do/a/b/c"]) {
      expect(new URL(CLIENT_CONFIG_URL, page).href).toBe("http://nimbus.my.ava.do/client-config.json");
    }
  });
});
