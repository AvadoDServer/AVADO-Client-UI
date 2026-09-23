import { AnsiUp } from "ansi_up";

/**
 * Converts DAPPMANAGER log text (possibly containing ANSI colour codes) to
 * HTML safe to render with `dangerouslySetInnerHTML`.
 *
 * `ansi_up`'s `escape_html` is on by default: every plain-text run is
 * HTML-escaped (`<`, `&`, …) *before* the ANSI styling spans are built
 * around it, so a log line that happens to contain `<script>` or a stray
 * `&` renders as literal text instead of being interpreted as markup. We
 * still set it explicitly so that stays true even if a future upgrade
 * changes the default. A fresh `AnsiUp` instance is used per call because
 * an incomplete trailing escape sequence is buffered internally between
 * calls to `ansi_to_html`, and each poll here delivers a fresh, complete
 * tail of the log rather than a streamed chunk.
 */
export function logsToHtml(text: string): string {
  const ansiUp = new AnsiUp();
  ansiUp.escape_html = true;
  return ansiUp.ansi_to_html(text);
}
