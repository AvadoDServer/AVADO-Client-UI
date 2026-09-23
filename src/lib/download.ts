/**
 * Save text as a file in the browser's downloads. Returns once the download
 * has been handed to the browser.
 */
export function downloadText(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  // Firefox needs the link in the document.
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Revoke later: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
