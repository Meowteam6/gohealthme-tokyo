// Who a challenge link is for, and what money added to a pot does, in words
// (docs/MONEY-FLOWS.md F2, F3 and F5). Pure, so every sentence is tested.
//
// A challenge (initiative "challenge", bountyModel 2) is equal stakes on the
// same goal: the creator stakes S, friends match S, and anyone can add extra
// to the pot (lib/challenge-flow.ts). challengeRunKindOf is the one rule every
// surface uses to tell which flow a challenge is, the creator's own stake
// first:
//   - "self": the creator staked. Friends either match the stake (the accept
//     link) or back them (?as=backer). Extra in the pot, the creator's own at
//     create or backers' later, never changes that.
//   - "reward": an older challenge whose creator put money in at create and
//     never staked. A friend accepts with a lock-in. No new challenge is made
//     this way (the create form has one flow); these still render and pay.
//   - "unstaked": the creator has not locked in yet and nothing else says it
//     is an older reward challenge. No link is offered to the creator until
//     they do; the chips already read as their own stake.
//
// Money chipped in (fundPool) is recorded against nobody (HealthPoolsV3
// C:336-342), so the warning says where it goes per bounty model and that it
// never comes back to the person who added it. Voice: stake, pot, challenge,
// back; never bet, wager or odds.


export type ChallengeRunKind = "self" | "reward" | "unstaked";

/** Whether the pool's creator is one of its stakers. */
export function creatorStakedIn(creator: string, participants: readonly string[]): boolean {
  const c = creator.toLowerCase();
  return participants.some((p) => p.toLowerCase() === c);
}

/**
 * Which flow a challenge is. The creator's own stake decides first: a
 * creator who staked is a match-the-stake challenge, whatever extra is in the
 * pot. With no creator stake, money in the pot at create (`reward`, the pot
 * net of every stake and of backers' top-ups where those read, the pot net of
 * stakes alone where they did not) is an older reward challenge. `named` is
 * whether the challenge row names a target or carries a message: it keeps a
 * finished older reward challenge a reward once the pot no longer reads
 * (settled, cancelled, a read missed), and says nothing while the pot reads,
 * since the create form names a friend too.
 */
export function challengeRunKindOf(input: {
  creatorStaked: boolean;
  reward: bigint | null;
  named?: boolean;
}): ChallengeRunKind {
  if (input.creatorStaked) return "self";
  if (input.reward !== null && input.reward > 0n) return "reward";
  if (input.reward === null && input.named === true) return "reward";
  return "unstaked";
}

// ------------------------------------------------------------ share links

export type ShareLinkKind = "match" | "back" | "challenge";

export interface ShareLink {
  kind: ShareLinkKind;
  /** The link's name, as the creator sees it. */
  label: string;
  /** What the friend lands on, one line. */
  detail: string;
  /** Compose the backer variant (?as=backer), which never offers accept. */
  backer: boolean;
  /** Native share title. */
  title: string;
  /** The message WITHOUT the link (ShareChallenge appends it). */
  message: string;
  emailSubject: string;
}

export type InviteShare =
  | {
      kind: "links";
      heading: string;
      links: ShareLink[];
      revealLabel: string;
      revealHint: string;
    }
  | { kind: "blocked"; heading: string; reason: string };

const REVEAL_HINT_TAIL = "You sign once to prove the wallet is yours. Nothing is charged.";

/** The creator's share card on their own challenge run, per flow. */
export function inviteShareOf(kind: ChallengeRunKind): InviteShare {
  if (kind === "reward") {
    return {
      kind: "links",
      heading: "Send the challenge",
      revealLabel: "Get the challenge link",
      revealHint: `Shows your private link to send by text, email or copy. ${REVEAL_HINT_TAIL}`,
      links: [
        {
          kind: "challenge",
          label: "Send the challenge",
          detail: "Whoever opens it can accept with their lock-in and go for the goal.",
          backer: false,
          title: "You've been challenged on GoHealthMe",
          message: "I'm challenging you on GoHealthMe. Your wearable decides. Accept it here:",
          emailSubject: "I'm challenging you on GoHealthMe",
        },
      ],
    };
  }
  if (kind === "unstaked") {
    return {
      kind: "blocked",
      heading: "Bring friends in",
      reason:
        "Lock in your stake first. Then you get two links here: one for friends to match your stake, one for friends to back you.",
    };
  }
  return {
    kind: "links",
    heading: "Bring friends in",
    revealLabel: "Get my two links",
    revealHint: `Shows your two private links to send by text, email or copy. ${REVEAL_HINT_TAIL}`,
    links: [
      {
        kind: "match",
        label: "Match my stake",
        detail: "They stake the same amount on the same goal, checked by their own wearable.",
        backer: false,
        title: "Match my stake on GoHealthMe",
        message:
          "I put test USDC on myself on GoHealthMe. Match my stake and go for the same goal on your own wearable:",
        emailSubject: "Match my stake",
      },
      {
        kind: "back",
        label: "Back me",
        detail: "They add to the pot on your challenge. It never stakes them in.",
        backer: true,
        title: "Back me on GoHealthMe",
        message: "I put test USDC on myself on GoHealthMe. Back me by adding to the pot:",
        emailSubject: "Back me on this",
      },
    ],
  };
}

/**
 * The creator's share card on the run page: the flow's links while the run
 * is live, nothing once it is settled, cancelled or past its end (there is
 * nobody left to bring in), and nothing until the flow has read (`kind`
 * null), so the card never guesses which links to offer.
 */
export function shareCardOf(input: { kind: ChallengeRunKind | null; live: boolean }): InviteShare | null {
  if (!input.live || input.kind === null) return null;
  return inviteShareOf(input.kind);
}

// ------------------------------------------------------------ /c/[token]

/**
 * The tag and headline a friend lands on. A match-the-stake challenge leads
 * with the stake to match ("Match @andre's 10.00 USDC stake"); an older reward
 * challenge with a seed leads with the money instead ("{name} put 5.00 USDC
 * on you"), and this title is its fallback.
 */
export function challengeLandingHeadOf(input: {
  kind: ChallengeRunKind;
  view: "accept" | "backer";
  /** The challenger, as displayNameFor shows them. */
  name: string;
  /** "@handle" or "their friend", for a reward challenge's backer page. */
  target: string;
  /** The stake to match, formatted ("10.00"), when it read. */
  stake?: string | null;
}): { tag: string; title: string } {
  const { kind, view, name, target } = input;
  if (view === "backer") {
    return kind === "reward"
      ? { tag: "Back the challenge", title: `${name} challenged ${target}` }
      : { tag: "Backing", title: `Back ${name}` };
  }
  if (kind === "reward") return { tag: "You have been challenged", title: `${name} challenged you` };
  const stake = input.stake ?? null;
  return {
    tag: "Match the stake",
    title: stake !== null ? `Match ${name}'s ${stake} USDC stake` : `Match ${name}'s stake`,
  };
}

/** The rally card: the backer link, sent on from the accept or backer page. */
export function rallyCopyOf(
  kind: ChallengeRunKind,
  name: string,
): { heading: string; detail: string; title: string; message: string; emailSubject: string; shareLabel: string } {
  if (kind === "reward") {
    return {
      heading: "Rally your friends",
      detail:
        "This link opens as a backer page: friends can add to the pot, and it never signs them up for the challenge.",
      title: "Back this challenge on GoHealthMe",
      message: "Back this challenge on GoHealthMe. Add test USDC to the pot:",
      emailSubject: "Back this challenge",
      shareLabel: "Rally friends",
    };
  }
  return {
    heading: `Rally backers for ${name}`,
    detail: `This link opens as a backer page: friends can add to the pot on ${name}'s challenge, and it never stakes them in.`,
    title: `Back ${name} on GoHealthMe`,
    message: `Back ${name} on GoHealthMe. Add test USDC to the pot on their challenge:`,
    emailSubject: `Back ${name}`,
    shareLabel: "Rally backers",
  };
}

// ------------------------------------------------------------ chip in

/** Who a sentence names: a display name, or the viewer themselves. */
export interface ChipInParty {
  name: string;
  /** The viewer is this person: the copy says "you". */
  you: boolean;
}

/**
 * The warning above every chip-in (ChallengeContribute and the public pot
 * top-up), worded per bounty model (MONEY-FLOWS F5):
 *   - 2: split equally among whoever hits (C:587); nobody hits, the creator
 *     sweeps it (C:466-476). On a stake-on-yourself run the creator is the
 *     person being backed, so with one staker it reaches them hit or miss.
 *   - 0: left over for the sponsor unless the fixed bounties outgrow the pot
 *     (C:533-537).
 *   - 1: grows the pot split by result weight (C:538-539).
 * `stakers` is the run's staker count, or null when it did not read (the
 * one-staker line then stays, since it is conditional and still true).
 */
export function chipInWarningOf(input: {
  bountyModel: number;
  creator: ChipInParty;
  /** The creator is staked on their own run (a stake-on-yourself run). */
  selfStake: boolean;
  stakers: number | null;
}): { title: string; lines: string[] } {
  const { bountyModel, creator, selfStake, stakers } = input;
  const solo = selfStake && (stakers === null || stakers <= 1);
  const title = "Before you add";

  if (creator.you) {
    if (bountyModel === 0) {
      return {
        title,
        lines: ["It comes back to you unless the bounties owed to the hitters outgrow the pot."],
      };
    }
    const lines = [
      bountyModel === 1
        ? "It is split by result among whoever hits."
        : "It is split among whoever hits.",
      "If nobody hits, it comes back to you.",
    ];
    if (bountyModel === 2 && solo) {
      lines.push("While you are the only one staked, it comes back to you, hit or miss.");
    }
    return { title, lines };
  }

  const who = creator.name;
  const notRefunded = "It is not refunded to you.";
  if (bountyModel === 0) {
    return {
      title,
      lines: [`It goes back to ${who} unless the bounties owed to the hitters outgrow the pot.`, notRefunded],
    };
  }
  if (bountyModel === 1) {
    return {
      title,
      lines: ["It is split by result among whoever hits.", `If nobody hits, it goes to ${who}.`, notRefunded],
    };
  }
  const lines = ["It is split among whoever hits.", `If nobody hits, it goes to ${who}.`];
  if (bountyModel === 2 && solo) {
    lines.push(`If ${who} is the only one staked, it goes to ${who}, hit or miss.`);
  }
  lines.push(notRefunded);
  return { title, lines };
}

/** The chip-in card's lead and button on a challenge run, per flow. */
export function chipInIntroOf(
  kind: ChallengeRunKind,
  creator: ChipInParty,
): { lead: string; cta: string } {
  if (kind === "reward") {
    return {
      lead: "Anyone with this link can add to the reward. It grows what whoever hits collects when the challenge settles.",
      cta: "Add to the reward",
    };
  }
  return {
    lead: creator.you
      ? "Anyone with your links can add to the pot on your challenge. It is split among whoever hits when the challenge settles."
      : `Anyone with this link can add to the pot on ${creator.name}'s challenge. It is split among whoever hits when the challenge settles.`,
    cta: "Add to the pot",
  };
}
