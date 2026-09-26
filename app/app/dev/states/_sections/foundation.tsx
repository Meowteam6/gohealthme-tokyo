"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  ChevronLink,
  Chip,
  EmptyState,
  ErrorNote,
  Fine,
  Money,
  RunCard,
  Skeleton,
  Stamp,
  Stat,
  StatRow,
  Tag,
  TEXT_LINK,
  Verdict,
} from "@/components/ui";
import HoldCoin from "@/components/spotter/HoldCoin";
import Moon from "@/components/spotter/Moon";
import Perch from "@/components/spotter/Perch";
import Spotter from "@/components/spotter/Spotter";
import SpotterCaption from "@/components/spotter/SpotterCaption";
import { commitmentOutcome } from "@/lib/commitment";
import { formatUsdc } from "@/lib/contract";
import { NIGHT_POSES } from "@/lib/spotter-poses";
import { GallerySection, StateFrame, type SectionProps } from "../_kit";

// The foundation's primitives with fixture props (docs/DESIGN.md). Every
// number is computed by lib/commitment.ts from the fixture below, never typed.

const USDC = 1_000_000n;
/** Fixture run: 1.00 stake, a 2.00 sponsor pot, nobody in yet. */
const FIXTURE = { entryFee: USDC, sponsorPot: 2n * USDC, players: 0 } as const;

function aloneOutcome(): string {
  const o = commitmentOutcome({
    entryFee: FIXTURE.entryFee,
    sponsorPot: FIXTURE.sponsorPot,
    players: FIXTURE.players + 1,
    achievers: 1,
  });
  return formatUsdc(o.kind === "paid" ? o.perAchiever : o.refundEach);
}

const SWATCHES: readonly { token: string; role: string }[] = [
  { token: "surface-deep", role: "Footer, inputs" },
  { token: "background", role: "Page" },
  { token: "surface", role: "Card" },
  { token: "surface-raised", role: "Chips, wells, caption" },
  { token: "foreground", role: "Text, moon face" },
  { token: "muted", role: "Secondary text" },
  { token: "haze", role: "Meta text" },
  { token: "gold", role: "Money only" },
  { token: "moonlight", role: "Moon, tags, Hit" },
  { token: "dusk", role: "Miss, 0.00" },
  { token: "danger", role: "Form errors" },
  { token: "otter", role: "Art and mark only" },
];

const WEARABLES = ["WHOOP", "Oura", "Garmin", "Fitbit", "Apple Watch", "None yet"] as const;

function HeroStage() {
  const stake = formatUsdc(FIXTURE.entryFee);
  const pot = formatUsdc(FIXTURE.sponsorPot);
  const alone = aloneOutcome();
  return (
    <div className="relative max-w-[500px] max-[899px]:-mx-[var(--gutter)] max-[899px]:overflow-x-clip max-[899px]:px-[var(--gutter)]">
      <Moon
        id="gallery-moon"
        className="absolute left-[calc(50%-16px)] top-0.5 z-0 min-[900px]:left-auto min-[900px]:right-[-8px] min-[900px]:top-[-18px]"
      />
      <Perch state="landing-hero" side="left" inset={[6, 18]} decorative>
        <RunCard
          id="gallery-run"
          tag={<Tag>Open tonight</Tag>}
          ends={
            <>
              Ends <b>Sun 08:30</b>, in 16h 44m
            </>
          }
          title="Sleep 7 hours Saturday night"
          stats={
            <StatRow>
              <Stat label="Stake" value={stake} unit="USDC" size="lg" />
              <Stat label="Pot" value={pot} unit="USDC" tone="money" size="lg" />
              <Stat label="Players in" value={FIXTURE.players} size="lg" />
            </StatRow>
          }
          note={
            <>
              Nobody&apos;s in yet. Hit it alone and <b>{alone}</b> comes back: your {stake} plus
              the {pot} pot.
            </>
          }
          action={<Button block>Put 1 USDC on myself</Button>}
          fine="Test USDC during beta. Refunded if nobody hits."
        />
      </Perch>
    </div>
  );
}

function Outcome({
  state,
  title,
  body,
  label,
  value,
  tone,
}: {
  state: "outcome-hit" | "outcome-miss" | "outcome-none";
  title: string;
  body: string;
  label: string;
  value: string;
  tone: "money" | "dusk" | "default";
}) {
  const color = tone === "money" ? "text-gold" : tone === "dusk" ? "text-dusk" : "text-foreground";
  return (
    <Perch state={state} reserve={[110, 139]} decorative>
      <Card className="min-h-[172px]">
        <h3 className="m-0 max-w-[calc(100%-6rem)] text-[1.1875rem] font-semibold leading-snug">{title}</h3>
        <p className="m-0 mt-2 text-[0.9375rem] text-muted">{body}</p>
        <p className="num m-0 mt-3.5 flex items-baseline justify-between gap-3 border-t border-edge pt-3 text-[0.9375rem] text-muted">
          <span>{label}</span>
          <b className={`text-[1.375rem] font-bold tracking-[-0.01em] ${color}`}>{value}</b>
        </p>
      </Card>
    </Perch>
  );
}

export default function FoundationStates({ meta }: SectionProps) {
  const [wearable, setWearable] = useState<(typeof WEARABLES)[number]>("WHOOP");
  const [commits, setCommits] = useState(0);
  const [holdKey, setHoldKey] = useState(0);
  const alone = aloneOutcome();
  const stake = formatUsdc(FIXTURE.entryFee);

  return (
    <GallerySection meta={meta}>
      <StateFrame name="tokens" note="semantic tokens from globals.css">
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 min-[640px]:grid-cols-4 min-[1024px]:grid-cols-6">
          {SWATCHES.map((s) => (
            <li key={s.token} className="min-w-0">
              <span
                className="block h-14 rounded-control shadow-[inset_0_0_0_1px_var(--border-strong)]"
                style={{ background: `var(--${s.token})` }}
              />
              <span className="mt-1.5 block truncate font-mono text-xs text-muted">--{s.token}</span>
              <span className="block text-xs text-haze">{s.role}</span>
            </li>
          ))}
        </ul>
      </StateFrame>

      <StateFrame name="type" note="Fraunces for words, Figtree for UI and every number">
        <div className="grid gap-4">
          <p className="type-display m-0 text-[2.75rem] min-[900px]:text-[5rem] min-[900px]:leading-[0.98]">
            Put money on yourself.
          </p>
          <p className="type-title m-0 text-[2rem] min-[900px]:text-[3rem]">
            Everyone stakes the same. Your night decides the rest.
          </p>
          <p className="type-heading m-0 text-[1.75rem]">You&apos;re in. Goodnight.</p>
          <p className="m-0">
            <span className="num block text-[3.75rem] font-bold leading-[0.95] tracking-[-0.035em] min-[900px]:text-[7rem]">
              7 hours
            </span>
            <span className="type-heading mt-2 block text-[1.375rem] min-[900px]:text-[2.125rem]">
              of sleep, Saturday night
            </span>
          </p>
          <p className="m-0 max-w-[60ch] text-base text-muted">
            Body copy is Figtree 16/1.5 in muted. <b className="font-semibold text-foreground">Emphasis</b>{" "}
            reads in the foreground. Money is <Money usd={alone} size="sm" />, gold and tabular.
          </p>
          <Fine>Small print: Beta on Base Sepolia with test USDC, so no real money moves.</Fine>
        </div>
      </StateFrame>

      <StateFrame name="buttons" note="primary (moon), secondary, tertiary; md 52px, sm 44px">
        <div className="grid max-w-[520px] gap-3">
          <Button block>Put 1 USDC on myself</Button>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Go again tonight</Button>
            <Button variant="secondary">Challenge a friend</Button>
            <Button variant="tertiary">Tap to confirm instead</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Stake 1.00 USDC</Button>
            <Button size="sm" variant="secondary">
              Not now
            </Button>
            <Button size="sm" disabled>
              Disabled
            </Button>
            <ButtonLink href="/pools" size="sm" variant="secondary">
              Sign in
            </ButtonLink>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <ChevronLink href="/pools">See all 3 open runs</ChevronLink>
            <a href="#buttons" className={TEXT_LINK}>
              See the stake on Basescan
            </a>
          </div>
        </div>
      </StateFrame>

      <StateFrame name="chips" note="radiogroup; the selected chip takes the moon face">
        <div>
          <p id="wear-q" className="m-0 text-[0.9375rem] font-semibold">
            What do you wear?
          </p>
          <div role="radiogroup" aria-labelledby="wear-q" className="mt-2.5 flex flex-wrap gap-2">
            {WEARABLES.map((w) => (
              <Chip key={w} role="radio" selected={wearable === w} onClick={() => setWearable(w)}>
                {w}
              </Chip>
            ))}
          </div>
        </div>
      </StateFrame>

      <StateFrame name="tags-and-stamps">
        <div className="flex flex-wrap items-center gap-2.5">
          <Tag>Open tonight</Tag>
          <Tag tone="ended">Ended</Tag>
          <Tag tone="muted" dot={false}>
            Sleep
          </Tag>
          <Badge>Wearable</Badge>
          <Badge tone="warning">Self-reported</Badge>
          <Stamp>Joined</Stamp>
          <Stamp tone="danger">Refused</Stamp>
          <Verdict verified />
          <Verdict verified={false} />
          <span className="rounded-tag bg-paper p-2">
            <Stamp tone="ink">Paid</Stamp>
          </span>
        </div>
      </StateFrame>

      <StateFrame name="stats" note="StatRow + Stat, from lib/commitment fixture">
        <Card className="max-w-[420px]">
          <StatRow>
            <Stat label="Stake" value={stake} unit="USDC" />
            <Stat label="Pot" value={formatUsdc(FIXTURE.sponsorPot)} unit="USDC" tone="money" />
            <Stat label="Players in" value={0} />
          </StatRow>
          <div className="mt-4 border-t border-edge pt-4">
            <StatRow>
              <Stat label="You put in" value={stake} unit="USDC" />
              <Stat label="You get back" value="0.00" tone="dusk" />
            </StatRow>
          </div>
        </Card>
      </StateFrame>

      <StateFrame name="hero-run-card" note="Moon + sleeping SPOTTER perched on the RunCard (fixture numbers)">
        <HeroStage />
      </StateFrame>

      <StateFrame name="cards" note="default, flat, raised, paper">
        <div className="grid items-start gap-4 min-[900px]:grid-cols-2">
          <Card>
            <p className="m-0 text-[1.0625rem] font-semibold">Your night</p>
            <p className="m-0 mt-1 text-sm text-haze">Default card: lit top edge</p>
            <SpotterCaption
              line="Wear your WHOOP to bed. I read your night at 08:30 and tell you first."
              className="mt-3.5"
            />
          </Card>
          <Card variant="flat">
            <p className="m-0 text-[1.0625rem] font-semibold">Sleep efficiency 85 tonight</p>
            <p className="num m-0 mt-1 flex gap-3.5 text-sm text-haze">
              <span>Ends Sun 10:30</span>
              <span>Nobody in yet</span>
            </p>
          </Card>
          <Card variant="raised" padding="sm">
            <p className="m-0 text-[0.9375rem]">Raised well inside a card.</p>
          </Card>
          <Perch state="verdict-paid" side="right" inset={18} decorative>
            <Card variant="paper" padding="sm" className="px-[18px] py-4">
              <div className="flex items-center justify-between gap-2.5">
                <Stamp tone="ink">Paid</Stamp>
                <span className="text-sm font-medium text-ink-2">mika.gohealthme.eth</span>
              </div>
              <p className="num m-0 mt-3 text-[2.5rem] font-bold leading-none tracking-[-0.02em]">
                {alone}
                <small className="ml-1.5 text-[0.9375rem] font-semibold tracking-normal text-ink-2">USDC</small>
              </p>
            </Card>
          </Perch>
        </div>
      </StateFrame>

      <StateFrame name="outcomes" note="one pose per outcome, standing on the card edge">
        <div className="grid items-start gap-6 min-[900px]:grid-cols-3">
          <Outcome
            state="outcome-hit"
            title="Your stake comes back, plus a share."
            body="An equal share of the missed stakes and the sponsor pot goes to everyone who hits."
            label="Tonight, if you hit alone"
            value={alone}
            tone="money"
          />
          <Outcome
            state="outcome-miss"
            title="Your stake goes to the players who hit."
            body="Your stake is shared equally among everyone whose wearable shows they hit."
            label="You get back"
            value="0.00"
            tone="dusk"
          />
          <Outcome
            state="outcome-none"
            title="Everyone gets their stake back."
            body="If nobody's wearable shows a hit, every stake is refunded in full."
            label="Your stake back"
            value={stake}
            tone="default"
          />
        </div>
      </StateFrame>

      <StateFrame name="poses" note="the only eight poses allowed on a night field">
        <ul className="m-0 grid list-none grid-cols-2 gap-6 p-0 min-[640px]:grid-cols-4">
          {NIGHT_POSES.map((pose) => (
            <li key={pose} className="flex flex-col items-center justify-end gap-3">
              <Spotter pose={pose} width={96} />
              <span className="font-mono text-xs text-haze">{pose}</span>
            </li>
          ))}
        </ul>
      </StateFrame>

      <StateFrame name="hold-button" note="hold 1.2s, or tap to confirm inline; Enter/Space commits">
        <div className="grid max-w-[420px] gap-5">
          <div>
            <HoldCoin
              key={holdKey}
              label={`Hold to stake ${stake} USDC`}
              confirmPrompt={`Stake ${stake} USDC on Sleep 7 hours Saturday night?`}
              confirmLabel={`Stake ${stake} USDC`}
              onCommit={() => setCommits((n) => n + 1)}
            />
            <p className="num m-0 mt-2 text-sm text-haze" aria-live="polite">
              Commits so far: {commits}{" "}
              <Button variant="tertiary" size="sm" onClick={() => setHoldKey((k) => k + 1)}>
                Reset the button
              </Button>
            </p>
          </div>
          <HoldCoin
            label={`Hold to stake ${stake} USDC`}
            disabled
            disabledReason="Checking your balance"
            onCommit={() => undefined}
          />
        </div>
      </StateFrame>

      <StateFrame name="feedback" note="error, empty, loading">
        <div className="grid gap-5 min-[900px]:grid-cols-2">
          <ErrorNote
            title="The stake did not go through"
            detail="Nothing left your wallet. The network did not confirm in time."
            raw="TransactionExecutionError: timeout after 30000ms"
            onRetry={() => undefined}
            retryLabel="Try the stake again"
          />
          <div className="grid gap-3" aria-busy="true">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
          <div className="min-[900px]:col-span-2">
            <EmptyState
              title="No runs open right now"
              detail="New runs open every evening. Start one for a friend and it shows up here."
              line="Quiet night. Nothing to read yet."
              action={<Button variant="secondary">Challenge a friend</Button>}
            />
          </div>
        </div>
      </StateFrame>
    </GallerySection>
  );
}
