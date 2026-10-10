import { formatDate, formatDateTime, formatDuration, nsToMs, parseTime } from "../time";

describe("times", () => {
  it("reads Go durations (ns) exactly, including above 2^53", () => {
    expect(nsToMs(2_419_200_000_000_000)).toBe(28 * 86_400_000);
    expect(nsToMs("2419200000000000000")).toBe(28_000 * 86_400_000);
    expect(nsToMs(-1)).toBeNull();
    expect(nsToMs("abc")).toBeNull();
  });

  it("treats Go's zero time as never", () => {
    expect(parseTime("0001-01-01T00:00:00Z")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("2026-09-23T10:00:00Z")).toBe(Date.UTC(2026, 8, 23, 10));
  });

  it("says durations in words, rounded down", () => {
    expect(formatDuration(28 * 86_400_000)).toBe("28 days");
    expect(formatDuration(86_400_000 + 3_600_000 * 4 + 60_000)).toBe("1 day 4 hours");
    expect(formatDuration(3_600_000 * 5 + 60_000 * 10)).toBe("5 hours 10 minutes");
    expect(formatDuration(60_000)).toBe("1 minute");
    expect(formatDuration(59_000)).toBe("less than a minute");
    expect(formatDuration(-5)).toBe("less than a minute");
  });

  it("formats dates in a given time zone", () => {
    // ICU writes September as "Sep" or "Sept" depending on its version.
    expect(formatDate(Date.UTC(2026, 8, 23, 10), "UTC")).toMatch(/^23 Sept? 2026$/);
    expect(formatDateTime(Date.UTC(2026, 8, 23, 10, 5), "UTC")).toMatch(/^23 Sept? 2026, 10:05$/);
  });
});
