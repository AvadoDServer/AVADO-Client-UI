import { logsToHtml } from "../logsToHtml";

describe("logsToHtml", () => {
  it("escapes HTML in plain text", () => {
    const html = logsToHtml("<script>alert(1)</script> & co");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; co");
  });

  it("converts ANSI colour codes to styled spans, escaping the text inside them too", () => {
    const html = logsToHtml("\u001b[32mOK <b>\u001b[0m plain");
    expect(html).toMatch(/<span style="color:rgb\(\d+,\d+,\d+\)">OK &lt;b&gt;<\/span>/);
    expect(html).toContain(" plain");
  });

  it("renders empty input as empty HTML", () => {
    expect(logsToHtml("")).toBe("");
  });

  it("is not affected by state from a previous call (each call gets a fresh converter)", () => {
    // An unterminated escape sequence must not leak into the next call.
    const first = logsToHtml("\u001b[32mstart");
    const second = logsToHtml("plain text");
    expect(first).toContain("start");
    expect(second).toBe("plain text");
  });
});
