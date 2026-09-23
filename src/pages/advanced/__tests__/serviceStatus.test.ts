import type { ProcessInfo } from "../../../api/types";
import { formatDuration, processDetail, processStatus } from "../serviceStatus";

describe("processStatus", () => {
  it.each([
    ["RUNNING", "success", "Running"],
    ["STARTING", "accent", "Starting"],
    ["STOPPING", "accent", "Stopping"],
    ["BACKOFF", "warning", "Retrying"],
    ["STOPPED", "neutral", "Stopped"],
    ["EXITED", "warning", "Exited"],
    ["FATAL", "danger", "Failed"],
    ["UNKNOWN", "neutral", "Unknown"],
  ] as const)("maps supervisord statename %s", (statename, tone, label) => {
    expect(processStatus(statename)).toEqual({ tone, label });
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(processStatus(" running ")).toEqual({ tone: "success", label: "Running" });
  });

  it("falls back to neutral with the raw text for anything unrecognised", () => {
    expect(processStatus("something-else")).toEqual({ tone: "neutral", label: "something-else" });
  });

  it("falls back to the word Unknown for empty or missing input", () => {
    expect(processStatus(undefined)).toEqual({ tone: "neutral", label: "Unknown" });
    expect(processStatus("")).toEqual({ tone: "neutral", label: "Unknown" });
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0s"],
    [45, "45s"],
    [60, "1m 0s"],
    [125, "2m 5s"],
    [3600, "1h 0m"],
    [3661, "1h 1m"],
    [86400, "1d 0h"],
    [90000, "1d 1h"],
  ])("formats %d seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("clamps negative input to zero", () => {
    expect(formatDuration(-5)).toBe("0s");
  });
});

describe("processDetail", () => {
  const base: ProcessInfo = { name: "nimbus", statename: "RUNNING" };

  it("prefers pid + uptime when start and now are present", () => {
    expect(processDetail({ ...base, pid: 41, start: 1000, now: 1000 + 3661, description: "ignored" })).toBe("pid 41, up 1h 1m");
  });

  it("falls back to the process's own description", () => {
    expect(processDetail({ ...base, description: "pid 41, uptime 3 days" })).toBe("pid 41, uptime 3 days");
  });

  it("falls back to an em dash with nothing usable", () => {
    expect(processDetail(base)).toBe("—");
  });
});
