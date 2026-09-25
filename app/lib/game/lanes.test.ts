import { describe, expect, it } from "vitest";
import {
  laneAvailabilityFromStatus,
  parseApprovalMode,
  parseApprovalStatus,
  parseEnsName,
  parseHumanStatus,
  parseScreening,
} from "@/lib/game/lanes";

// A lane that is not on this build is a state the flow walks past, never an
// error. A real failure is an error with a retry, never silently "off".

describe("laneAvailabilityFromStatus", () => {
  it("reads 2xx as on", () => {
    expect(laneAvailabilityFromStatus(200)).toBe("on");
    expect(laneAvailabilityFromStatus(204)).toBe("on");
  });
  it("reads a missing route and a fail-closed config as off", () => {
    expect(laneAvailabilityFromStatus(404)).toBe("off");
    expect(laneAvailabilityFromStatus(501)).toBe("off");
    expect(laneAvailabilityFromStatus(503)).toBe("off");
  });
  it("reads a real failure as error, not off", () => {
    expect(laneAvailabilityFromStatus(500)).toBe("error");
    expect(laneAvailabilityFromStatus(401)).toBe("error");
    expect(laneAvailabilityFromStatus(0)).toBe("error");
  });
});

describe("lane payload parsers", () => {
  it("parses the human status and rejects anything else", () => {
    expect(parseHumanStatus({ human: "verified" })).toBe("verified");
    expect(parseHumanStatus({ human: "unverified" })).toBe("unverified");
    expect(parseHumanStatus({ human: "yes" })).toBeNull();
    expect(parseHumanStatus(null)).toBeNull();
  });
  it("parses an ENS name and treats blank as no name", () => {
    expect(parseEnsName({ name: "dre.gohealthme.eth" })).toBe("dre.gohealthme.eth");
    expect(parseEnsName({ name: "  " })).toBeNull();
    expect(parseEnsName({ name: null })).toBeNull();
    expect(parseEnsName("nope")).toBeNull();
  });
  it("reads whether the payout confirmation is on", () => {
    expect(parseApprovalMode({ status: "none", mode: "world" })).toBe("world");
    expect(parseApprovalMode({ status: "none", mode: "off" })).toBe("off");
    expect(parseApprovalMode({ status: "none" })).toBeNull();
  });
  it("parses the approval status", () => {
    for (const s of ["none", "pending", "approved", "declined", "expired", "cancelled"]) {
      expect(parseApprovalStatus({ status: s })).toBe(s);
    }
    expect(parseApprovalStatus({ status: "maybe" })).toBeNull();
  });
  it("reads an unknown screening status as unavailable, never clear", () => {
    expect(parseScreening({ status: "clear" })).toEqual({ status: "clear", reason: null });
    expect(parseScreening({ status: "blocked", reason: "listed" })).toEqual({
      status: "blocked",
      reason: "listed",
    });
    expect(parseScreening({ status: "ok" }).status).toBe("unavailable");
    expect(parseScreening(undefined).status).toBe("unavailable");
  });
});
