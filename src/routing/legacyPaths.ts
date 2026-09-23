/**
 * The old wizards used BrowserRouter, so owners may have bookmarked
 * `http://nimbus.my.ava.do/settings` or `/admin`. This UI routes by hash
 * (`/#/settings`). The static server answers any path with index.html, so
 * an old path is turned into its hash route before the app mounts.
 */
const LEGACY_ROUTES: Record<string, string> = {
  "/settings": "/settings",
  "/admin": "/advanced",
  "/welcome": "/",
  "/checksync": "/",
};

export function legacyRedirectTarget(loc: { pathname: string; hash: string; search: string }): string | null {
  if (loc.hash && loc.hash !== "#" && loc.hash !== "#/") return null;
  const path = loc.pathname.replace(/\/+$/, "") || "/";
  const route = LEGACY_ROUTES[path];
  return route === undefined ? null : `/#${route}`;
}

/** Rewrites the address in place (no reload) when it is an old path. */
export function redirectLegacyPath(): void {
  if (typeof window === "undefined") return;
  const target = legacyRedirectTarget(window.location);
  if (target) window.history.replaceState(null, "", target);
}
