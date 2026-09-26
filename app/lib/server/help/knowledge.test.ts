import { describe, it, expect } from "vitest";
import {
  ASK_GLOBAL_CAP,
  ASK_PER_SESSION_CAP,
  HELP_KB,
  HELP_SYSTEM_PROMPT,
  MAX_QUESTION_CHARS,
  buildAskPrompt,
  validateQuestion,
} from "@/lib/server/help/knowledge";

describe("validateQuestion", () => {
  it("accepts a normal trimmed question", () => {
    const result = validateQuestion("  how do I get paid?  ");
    expect(result).toEqual({ ok: true, question: "how do I get paid?" });
  });

  it("rejects non-strings", () => {
    expect(validateQuestion(42).ok).toBe(false);
    expect(validateQuestion(null).ok).toBe(false);
    expect(validateQuestion(undefined).ok).toBe(false);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(validateQuestion("").ok).toBe(false);
    expect(validateQuestion("    ").ok).toBe(false);
  });

  it("rejects over the length cap rather than truncating", () => {
    const long = "a".repeat(MAX_QUESTION_CHARS + 1);
    const result = validateQuestion(long);
    expect(result.ok).toBe(false);
  });

  it("accepts exactly the length cap", () => {
    const exact = "a".repeat(MAX_QUESTION_CHARS);
    expect(validateQuestion(exact).ok).toBe(true);
  });
});

describe("guardrail prompt", () => {
  it("embeds the knowledge base into the system prompt", () => {
    expect(HELP_SYSTEM_PROMPT).toContain(HELP_KB);
  });

  it("states the refusal contract for medical and financial questions", () => {
    const lower = HELP_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain("medical");
    expect(lower).toContain("financial");
    expect(lower).toContain("refuse");
  });

  it("forbids emoji and exclamation marks in the voice", () => {
    expect(HELP_SYSTEM_PROMPT.toLowerCase()).toContain("exclamation");
    expect(HELP_SYSTEM_PROMPT).not.toContain("!");
  });

  it("names SPOTTER and the TEE privacy boundary in the facts", () => {
    expect(HELP_KB).toContain("SPOTTER");
    expect(HELP_KB.toLowerCase()).toContain("enclave");
    expect(HELP_KB.toLowerCase()).toContain("testnet");
  });

  it("states the commitment rule players are held to, including the no-data case", () => {
    const kb = HELP_KB.toLowerCase();
    expect(kb).toContain("your stake goes to the players who hit");
    expect(kb).toContain("did not sync the whole challenge");
    expect(kb).toContain("nobody hits, everyone's stake comes back");
    expect(kb).toContain("records the result");
    expect(kb).not.toContain("your stake is credited back to you when the run settles");
  });

  it("says which runs can record a miss, that a hit must be confirmed, and that a cancel refunds", () => {
    const kb = HELP_KB.toLowerCase();
    // F11: only wearable-only sleep and workout runs record a miss.
    expect(kb).toContain("only on challenges proven by wearable alone");
    expect(kb).toContain("every other challenge refunds a miss");
    // F10: SPOTTER records a miss on its own; a hit needs the player.
    expect(kb).toContain("a hit only counts once you open the challenge and confirm it");
    expect(kb).not.toContain("late syncs still count until then");
    // F7: cancelPool works any time before settle.
    expect(kb).toContain("cancel");
  });

  it("buildAskPrompt appends only the user question", () => {
    const prompt = buildAskPrompt("what is a pool");
    expect(prompt.startsWith(HELP_SYSTEM_PROMPT)).toBe(true);
    expect(prompt).toContain("User question: what is a pool");
  });
});

describe("rate caps", () => {
  it("keeps the per-session cap below the global cap", () => {
    expect(ASK_PER_SESSION_CAP).toBeGreaterThan(0);
    expect(ASK_PER_SESSION_CAP).toBeLessThan(ASK_GLOBAL_CAP);
  });
});

describe("challenge facts", () => {
  it("states the equal-stakes challenge with a friend and where extra money goes", () => {
    const kb = HELP_KB.toLowerCase();
    expect(kb).toContain("your friend matches your stake");
    expect(kb).toContain("the one who hit gets their stake back plus the other's stake");
    expect(kb).toContain("if you both hit, you both get your own stake back");
    expect(kb).toContain("extra money in the pot is split evenly among whoever hits");
    expect(kb).toContain("if nobody hits, the extra goes to whoever started the challenge");
    // The reward-only challenge is no longer how a challenge starts.
    expect(kb).not.toContain("you fund the reward");
  });

  it("speaks the player's vocabulary: challenge and pot, never run, pool, dare or bet", () => {
    // The WORDING line names the banned words so the model avoids them.
    const lines = HELP_SYSTEM_PROMPT.split("\n").filter((line) => !line.startsWith("WORDING:"));
    for (const line of lines) {
      expect(line, line).not.toMatch(
        /\b(a|an|the|this|your|every|other|each|own|open|new)\s+(runs?|pools?)\b|\bruns\b|\bpools?\b|\bdar(e|es|ing)\b|\bbets?\b|\bwager\w*|\bodds\b/i,
      );
    }
  });
});
