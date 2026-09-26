// What a self-staked (model 2) run promises about a miss, in one client-safe
// place, so no surface promises a forfeit the run can never deliver.
//
// A recorded miss goes to the players who hit ONLY on a pool the miss rule
// covers (lib/miss-rule.ts): wearable-only, sleep or workouts, a goal whose
// count is plain, created at or after MISS_RULE_FROM_POOL_ID. Every other
// self-staked pool (document or photo proof, steps, calories, distance, a
// goal SPOTTER could read two ways, a pool joined under the old refund copy)
// refunds a miss at settle, and its copy says so before the stake.
//
// Two more truths the forfeit copy carries, because the contract makes them:
//   - a hit pays a share only once it is recorded, and SPOTTER records a hit
//     only after the player opens the run and confirms it with World ID
//   - HealthPoolsV3.cancelPool() works for the creator any time before
//     settle, and then every stake, a recorded miss included, comes back

import {
  missRulePool,
  missRuleReading,
  missRuleWouldApply,
  missRuleFromPoolId,
} from "@/lib/miss-rule";

/** The pool page's join sentence for a self-staked run. */
export function commitmentJoinCopy(
  pool: { id: bigint; bountyModel: number; goalSpec: string },
  entryFeeUsd: string,
  fromPoolId: bigint | null = missRuleFromPoolId(),
): string {
  const rule = missRulePool(pool, fromPoolId);
  if (!rule.ok) {
    return (
      `Stake ${entryFeeUsd} USDC. Hit the goal inside the run and your stake comes back ` +
      "plus an equal share of anything else in the pot. This run cannot record a miss, " +
      "so if you miss it your stake comes back at settle too."
    );
  }
  return (
    `Stake ${entryFeeUsd} USDC. Hit the goal inside the run, open the run and confirm it ` +
    "before it settles, and your stake comes back plus an equal share of the missed " +
    "stakes and the pot. Miss it, with your wearable covering the whole run, and your " +
    "stake goes to the players who hit. No wearable data for the run, nobody hitting, " +
    "or the creator cancelling before it settles, and your stake comes back. " +
    missRuleReading(rule.spec)
  );
}

/** The lobby match card's line under "Stake X USDC on yourself." */
export function commitmentShortCopy(
  pool: { id: bigint; bountyModel: number; goalSpec: string },
  fromPoolId: bigint | null = missRuleFromPoolId(),
): string {
  return missRulePool(pool, fromPoolId).ok
    ? "Hit it and it comes back with a share of the missed stakes. Miss it and it goes to the players who hit; no wearable data for the run and it comes back."
    : "It comes back when the run settles, hit or miss: this run cannot record a miss.";
}

/** The create form's self-staked option, for the goal as it will be encoded
 *  (proof marker included). A new pool is always past the cutoff. */
export function createCommitmentCopy(
  encodedGoalSpec: string,
  fromPoolId: bigint | null = missRuleFromPoolId(),
): string {
  if (missRuleWouldApply({ bountyModel: 2, goalSpec: encodedGoalSpec }, fromPoolId)) {
    return (
      "Everyone stakes the same entry fee on their own goal. Hit it and confirm it, and " +
      "your stake comes back plus an equal share of the missed stakes. A miss the " +
      "wearable shows goes to the players who hit; no wearable data for the run, nobody " +
      "hitting, or a cancel before settle gives the stake back. No sponsor needed - " +
      "initial funding can be zero."
    );
  }
  return (
    "Everyone stakes the same entry fee on their own goal. Hit it and your stake comes " +
    "back plus an equal share of any initial funding. With this goal and proof the run " +
    "cannot record a miss, so a miss is refunded at settle. No sponsor needed - initial " +
    "funding can be zero."
  );
}

/** A self-staked challenge's stake line. Challenges are created with a
 *  document proof floor (CreateChallenge encodeGoal), which the miss rule
 *  never covers, so a miss there is always refunded. */
export function challengeStakeCopy(): string {
  return (
    "Pulled from your wallet when you lock in. Hit the goal and it comes back, plus a " +
    "share of anything else in the pot. A challenge is proven by document, so it cannot " +
    "record a miss: miss it and your stake comes back at settle."
  );
}

/**
 * The miss chip (docs/MONEY-FLOWS.md section 3): what a miss does on this run.
 * On a run that can record a miss (`recordable`, missRulePool(pool).ok) the
 * chip reads "goes to who hits" whatever the count, because it sits at the
 * moment of commitment: once you are in, anyone who joins after you turns a
 * miss your wearable shows into a stake that goes to them. The solo case (you
 * alone, a miss means nobody hit and every stake comes back) is said in the
 * explanatory line beside the chip, never by a friendlier chip.
 */
export type MissChip = "Miss: stake back" | "Miss: goes to who hits";

export function missConsequence(input: { recordable: boolean }): MissChip {
  return input.recordable ? "Miss: goes to who hits" : "Miss: stake back";
}
