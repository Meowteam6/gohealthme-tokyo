import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({}));

import { codeFromUrl } from "./pairing-store";

describe("codeFromUrl", () => {
  it("reads the code from the website's deep link", () => {
    expect(codeFromUrl("gohealthme://pair?code=ABCD-EFGH")).toBe("ABCD-EFGH");
    expect(codeFromUrl("gohealthme://pair?x=1&code=ABCD%2DEFGH")).toBe("ABCD-EFGH");
  });

  it("ignores anything else", () => {
    expect(codeFromUrl(null)).toBeNull();
    expect(codeFromUrl("https://evil.test/pair?code=ABCD-EFGH")).toBeNull();
    expect(codeFromUrl("gohealthme://other?code=ABCD-EFGH")).toBeNull();
  });
});
