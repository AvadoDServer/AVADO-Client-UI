import { legacyRedirectTarget } from "../legacyPaths";

const loc = (pathname: string, hash = "", search = "") => ({ pathname, hash, search });

describe("legacyRedirectTarget", () => {
  it.each([
    ["/settings", "/#/settings"],
    ["/settings/", "/#/settings"],
    ["/admin", "/#/advanced"],
    ["/welcome", "/#/"],
    ["/checksync", "/#/"],
  ])("sends the old BrowserRouter path %s to %s", (path, target) => {
    expect(legacyRedirectTarget(loc(path))).toBe(target);
  });

  it("keeps the old ?admin links working", () => {
    expect(legacyRedirectTarget(loc("/admin", "", "?admin"))).toBe("/#/advanced");
    expect(legacyRedirectTarget(loc("/settings", "", "?admin"))).toBe("/#/settings");
  });

  it.each([["/"], ["/index.html"], ["/unknown"]])("leaves %s alone", (path) => {
    expect(legacyRedirectTarget(loc(path))).toBeNull();
  });

  it("never touches an address that already has a hash route", () => {
    expect(legacyRedirectTarget(loc("/settings", "#/add"))).toBeNull();
  });
});
