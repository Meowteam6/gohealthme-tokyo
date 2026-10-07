import { afterEach, describe, it, expect, vi } from "vitest";
import {
  ASK_GLOBAL_CAP,
  ASK_PER_SESSION_CAP,
  HELP_KB,
  HELP_SYSTEM_PROMPT,
  MAX_QUESTION_CHARS,
  buildAskPrompt,
  helpKb,
  helpSystemPrompt,
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
    expect(HELP_KB).toContain('Do not use "run" as a verb either');
    const lines = HELP_SYSTEM_PROMPT.split("\n").filter((line) => !line.startsWith("WORDING:"));
    for (const line of lines) {
      expect(line, line).not.toMatch(
        /\b(a|an|the|this|your|every|other|each|own|open|new)\s+(runs?|pools?)\b|\bruns\b|\bpools?\b|\bdar(e|es|ing)\b|\bbets?\b|\bwager\w*|\bodds\b/i,
      );
    }
  });
});

// Open beta (lib/open-beta.ts, Andre and Nikki, 2026-10-07): World ID is
// optional, so the helper must not tell a player that the human step cannot
// wait, or that every hit needs a World ID confirm. A player who skipped it is
// paid on the verdict (lib/server/agent/approval.ts, payoutConfirmFor); a
// verified player confirms as before. Flag off, the closed-beta facts hold
// word for word.
describe("knowledge in open beta", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says World ID is optional and that a skipped World ID is paid on the verdict", () => {
    const kb = helpKb(true).toLowerCase();
    expect(kb).toContain("world id is optional");
    expect(kb).toContain("paid on spotter's verdict alone");
    expect(kb).not.toContain("the human step cannot");
    expect(kb).not.toContain("ask for a spot in the closed beta");
    // A verified player still confirms before settle.
    expect(kb).toContain("a hit only counts once you open the challenge and confirm it");
  });

  it("flag off: the human step cannot wait and every hit needs the confirm", () => {
    const kb = helpKb(false).toLowerCase();
    expect(kb).toContain("the human step cannot");
    expect(kb).not.toContain("world id is optional");
    expect(kb).not.toContain("paid on spotter's verdict alone");
    expect(helpKb(false)).toBe(HELP_KB);
    expect(helpSystemPrompt(false)).toBe(HELP_SYSTEM_PROMPT);
  });

  it("follows the switch: the facts and the prompt the model gets", async () => {
    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "1");
    vi.resetModules();
    const open = await import("@/lib/server/help/knowledge");
    expect(open.HELP_KB).toContain("World ID is optional");
    const prompt = open.buildAskPrompt("do I need World ID");
    expect(prompt).toContain("World ID is optional");
    expect(prompt.startsWith(open.helpSystemPrompt(true))).toBe(true);
    expect(prompt).toContain("User question: do I need World ID");

    vi.stubEnv("NEXT_PUBLIC_ACCESS_GATE_DISABLED", "");
    vi.resetModules();
    const closed = await import("@/lib/server/help/knowledge");
    expect(closed.HELP_KB).not.toContain("World ID is optional");
    expect(closed.buildAskPrompt("do I need World ID")).not.toContain("World ID is optional");
  });

  it("keeps the voice and the vocabulary in both branches", () => {
    for (const open of [true, false]) {
      const prompt = helpSystemPrompt(open);
      expect(prompt).not.toContain("!");
      const lines = prompt.split("\n").filter((line) => !line.startsWith("WORDING:"));
      for (const line of lines) {
        expect(line, line).not.toMatch(
          /\b(a|an|the|this|your|every|other|each|own|open|new)\s+(runs?|pools?)\b|\bruns\b|\bpools?\b|\bdar(e|es|ing)\b|\bbets?\b|\bwager\w*|\bodds\b/i,
        );
      }
    }
  });
});
