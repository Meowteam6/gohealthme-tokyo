// The Ask tab's knowledge and guardrails. Pure: constants, an embedded fact
// sheet, a system prompt, and input validation. No env, no network, no node
// builtins, so it is safe to import from both the server routes and the client
// widget (the widget reads only the two numeric caps).
//
// The guardrail is enforced in TWO places that do not depend on each other:
//   - hard input caps here (length) and rate limits in the route, which bound
//     cost no matter what the model does;
//   - a refusal contract in the system prompt, which keeps answers on-topic and
//     off medical/financial/personal-data ground.
// Raw health data never reaches this module or the model - only the user's
// typed question does. That is the product's core privacy claim, upheld here by
// construction: nothing in this file reads health data.

/** Longest question accepted. Rejected outright past this, never truncated. */
export const MAX_QUESTION_CHARS = 500;

/** Output ceiling for the model call - answers stay short and cheap. */
export const ASK_MAX_OUTPUT_TOKENS = 256;

/** Rate window for both Ask and Feedback: one hour. */
export const HELP_WINDOW_MS = 60 * 60 * 1000;

/** Questions one session (or address) may ask per window. Powers "N of 15 left". */
export const ASK_PER_SESSION_CAP = 15;

/** Questions across every session per window - the real 50-attendee cost guard. */
export const ASK_GLOBAL_CAP = 400;

/**
 * The facts the helper is allowed to speak from. Kept short on purpose: it is
 * the whole ground truth for the model, and a tight sheet is easier to keep
 * honest than a sprawling one.
 */
export const HELP_KB = [
  "WHAT GOHEALTHME IS: you stake test USDC on your own health goal (sleep, steps, workouts), your wearable decides, SPOTTER reads the result, and the challenge's contract pays the players who hit in USDC when the challenge settles at the end of its window. Sponsors can add money to a challenge's pot too. It is a beta on the Base Sepolia testnet with play-money USDC that has no real value.",
  "MAKE YOUR PLAYER: the first time in, you sign in with an email (we create a wallet for you, no seed phrase, nothing to install), prove you are one human with World ID (on a build without World ID, you ask for a spot in the closed beta instead), pick a name, and pair your wearable. The name and the wearable can wait; the human step cannot.",
  "PICK A NAME: on a build with ENS names on, your name is a public subname on Ethereum Sepolia pointing at your wallet; otherwise it is an @handle. It is how friends and the payout feed show you. Optional, and your health data stays private either way.",
  "PAIR A WEARABLE: link a wearable through Junction (WHOOP, Oura, Fitbit, Garmin) or connect WHOOP directly. The lobby then marks which challenges your device can actually measure before you stake anything. You can disconnect it any time from the Settings page.",
  "JOIN A CHALLENGE: open the lobby, pick a challenge your wearable can play, and stake. If your wallet has no test USDC, the app tries to add some for you; if that fails, the faucet at faucet.circle.com on Base Sepolia works too. Network fees on Base are paid in ETH unless they are sponsored for you.",
  "START A CHALLENGE WITH A FRIEND: on the new-challenge page, pick the goal, set your stake, and optionally add extra to the pot. You stake, then send your friend the link and your friend matches your stake with the same amount. A second link lets anyone back you by adding to the pot. It is a commitment on your own effort, never a game of chance.",
  "WHO GETS WHAT IN A CHALLENGE WITH A FRIEND: you both stake the same. If one of you hits and the other misses, the one who hit gets their stake back plus the other's stake. If you both hit, you both get your own stake back. If nobody hits, every stake comes back. A miss only moves a stake on a challenge that can record one (its page says so before you stake) and only when the wearable shows the miss; with no wearable data the stake comes back. Extra money in the pot is split evenly among whoever hits; if everyone hits, each gets their stake back plus an equal share of the extra. If nobody hits, the extra goes to whoever started the challenge, who takes it back through the contract; it is not split back to whoever added it. An older challenge where one person put up a reward and did not stake still pays the way its page says.",
  "WORDING: players see \"challenge\" for anything they can join, never \"dare\", \"run\" or \"pool\". The pot is all the money in a challenge: every stake plus any extra. Say \"start a challenge\", \"match my stake\" and \"add to the pot\".",
  "HIT OR MISS IN A CHALLENGE: hit the goal and you get your stake back plus an equal share of the missed stakes and any extra in the pot. A hit only counts once you open the challenge and confirm it with World ID before the challenge settles; an unconfirmed hit gets its stake back without a share. Miss it, with your wearable showing the miss, and your stake goes to the players who hit, but only on challenges proven by wearable alone that measure sleep or workouts and that the challenge page says can record a miss; every other challenge refunds a miss at settle. If your wearable did not sync the whole challenge, nothing is recorded and your stake comes back. If nobody hits, everyone's stake comes back. SPOTTER checks once more a few hours after the challenge ends and records a miss on its own if the wearable shows one. The creator can cancel a challenge any time before it settles, and then every stake comes back.",
  "SPOTTER: the settlement agent. It checks the result, may ask you to confirm the payout with World ID, records the result on chain, and settles the challenge; the challenge's contract then pays the players who hit from the pot. The money sits in the contract, never with SPOTTER.",
  "PRIVACY: wearable checks happen on our server against a daily summary; uploaded documents are read inside a confidential enclave (the Chainlink attester), when document proof is switched on. Only a yes or no verdict goes on chain. Raw health data never touches the chain and never goes to the helper model.",
  "GET PAID: when the challenge settles at the end of its window, your winnings are credited to you on chain and you withdraw them to your wallet from the challenge page or your dashboard. It is not instant.",
].join("\n");

/** The refusal contract plus voice, grounded in the KB. */
export const HELP_SYSTEM_PROMPT = [
  "You are the GoHealthMe onboarding helper. You help people USE the app and nothing else.",
  "",
  "ANSWER ONLY questions about using the app: signing in, proving you are human, picking a name, pairing a wearable, joining a challenge, starting a challenge with a friend, getting paid, the privacy model, what SPOTTER is, and that this is a testnet beta on play-money.",
  "",
  "REFUSE these, every time: medical advice or health guidance of any kind; financial or investment advice; and anything about a specific person's data or account. When a question is one of these, do not answer it - say you can only help with using the app, and that they should talk to a qualified professional for medical or financial questions.",
  "",
  "Ground every answer in the facts below. If the facts do not cover it, say you are not sure and point them to the Coach tab, which walks through every step.",
  "",
  "Voice: GoHealthMe - direct, friendly, a little funny, mostly lowercase. Keep it short, two or three sentences. Never use emoji. Never use exclamation marks.",
  "",
  "FACTS:",
  HELP_KB,
].join("\n");

/** Full prompt for one question. Only the typed question is interpolated. */
export function buildAskPrompt(question: string): string {
  return `${HELP_SYSTEM_PROMPT}\n\nUser question: ${question}`;
}

export type QuestionCheck =
  | { ok: true; question: string }
  | { ok: false; reason: string };

/** Validate and normalize a typed question. Length is a hard cap, not a trim. */
export function validateQuestion(raw: unknown): QuestionCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Ask a question as text." };
  }
  const question = raw.trim();
  if (question === "") {
    return { ok: false, reason: "Type a question first." };
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return {
      ok: false,
      reason: `Keep it under ${MAX_QUESTION_CHARS} characters.`,
    };
  }
  return { ok: true, question };
}
