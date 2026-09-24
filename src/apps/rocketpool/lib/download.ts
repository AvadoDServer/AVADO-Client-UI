/** How long the browser keeps a saved file's object URL (ms): long enough for the download to start everywhere. */
export const REVOKE_AFTER_MS = 1_000;

/**
 * Hands a file the page already holds to the browser's downloads: an object
 * URL on a temporary link (allowed by the backend's CSP, unlike a data: URL
 * or a new window). The URL is revoked shortly after, so the file doesn't stay
 * reachable from the page.
 */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  }
}
