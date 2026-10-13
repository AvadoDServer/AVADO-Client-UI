import { formatAgo, formatDuration, formatQtum } from "../format";

describe("formatting", () => {
  it("QTUM amounts", () => {
    expect(formatQtum(2498.12345678)).toBe("2,498.1235 QTUM");
    expect(formatQtum(0)).toBe("0 QTUM");
    expect(formatQtum(0.00001234)).toBe("0.00001234 QTUM");
    expect(formatQtum(undefined)).toBe("—");
  });

  it("durations", () => {
    expect(formatDuration(30)).toBe("less than a minute");
    expect(formatDuration(60)).toBe("about 1 minute");
    expect(formatDuration(20 * 60)).toBe("about 20 minutes");
    expect(formatDuration(5 * 3600)).toBe("about 5 hours");
    expect(formatDuration(3 * 86400 + 4 * 3600)).toBe("about 3 days");
    expect(formatDuration(200 * 86400)).toBe("about 7 months");
  });

  it("time ago", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    expect(formatAgo("2026-10-13T11:59:30Z", now)).toBe("just now");
    expect(formatAgo("2026-10-13T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatAgo("2026-10-10T12:00:00Z", now)).toBe("3 days ago");
    expect(formatAgo("2026-01-02T12:00:00Z", now)).toBe("Jan 2, 2026");
    expect(formatAgo(null, now)).toBe("—");
  });
});
