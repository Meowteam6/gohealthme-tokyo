// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthPoolsV3} from "../src/HealthPoolsV3.sol";

/// @dev 6-decimal USDC mock. Optionally blacklists an address so transfers TO it
///      revert — this is how USDC's own blacklist behaves, and it is the C-1
///      failure mode: a recipient that cannot receive must not lock the pool.
contract MockUSDC {
    string public constant name = "Mock USDC";
    string public constant symbol = "USDC";
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function blacklist(address a) external {
        blocked[a] = true;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) public returns (bool) {
        require(!blocked[to], "USDC_BLACKLISTED");
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        require(!blocked[to], "USDC_BLACKLISTED");
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// @dev Verdict registry mock. Defaults to clearing every goal (gate ON, all
///      pass); a specific goalId can be forced to fail.
contract MockVerdict {
    mapping(bytes32 => bool) public failed;

    function fail(bytes32 goalId) external {
        failed[goalId] = true;
    }

    function canSettle(bytes32 goalId) external view returns (bool) {
        return !failed[goalId];
    }
}

contract HealthPoolsV3Test is Test {
    HealthPoolsV3 internal pools;
    MockUSDC internal usdc;
    MockVerdict internal verdict;

    address internal oracle = makeAddr("oracle");
    address internal settler = makeAddr("settler");
    address internal creator = makeAddr("creator");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant FEE = 10e6; // 10 USDC (6 decimals)
    uint64 internal periodEnd;

    function setUp() public {
        usdc = new MockUSDC();
        verdict = new MockVerdict();
        // Deployer (this) is owner; oracle/settler are distinct keys (C-2).
        pools = new HealthPoolsV3(address(usdc), oracle, settler, address(verdict));

        periodEnd = uint64(block.timestamp + 7 days);

        address[4] memory funded = [creator, alice, bob, carol];
        for (uint256 i; i < funded.length; ++i) {
            usdc.mint(funded[i], 1_000e6);
            vm.prank(funded[i]);
            usdc.approve(address(pools), type(uint256).max);
        }
    }

    // --------------------------------------------------------------- helpers

    /// @dev Model-0 fixed-bounty pool, funded so it can pay everyone at 1x.
    function _newFundedPool(uint256 funding) internal returns (uint256 poolId) {
        vm.prank(creator);
        poolId = pools.createPool("Sleep", "8h x5", FEE, uint64(block.timestamp), periodEnd, 0, funding);
    }

    function _join(uint256 poolId, address who) internal {
        vm.prank(who);
        pools.joinPool(poolId);
    }

    function _record(uint256 poolId, address who, bool pass, uint16 mult) internal {
        vm.prank(oracle);
        pools.recordResult(poolId, who, pass, mult);
    }

    // ------------------------------------------------ join / settle / withdraw

    function test_Join_debitsExactlyEntryFee() public {
        uint256 poolId = _newFundedPool(0);
        uint256 before = usdc.balanceOf(alice);
        _join(poolId, alice);
        assertEq(before - usdc.balanceOf(alice), FEE, "join debits one entry fee");
        assertEq(pools.getPool(poolId).balance, FEE, "pool credited the fee");
    }

    function test_Settle_creditsOwed_movesNoTokens() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        _record(poolId, alice, true, uint16(pools.BPS()));

        uint256 balBefore = usdc.balanceOf(alice);
        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        // C-1: settle credits the ledger and transfers nothing.
        assertEq(usdc.balanceOf(alice), balBefore, "settle moves no tokens to alice");
        assertEq(pools.owed(alice), FEE, "alice is owed one bounty (1x of her fee)");
    }

    function test_Withdraw_paysOwedAmount() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        _record(poolId, alice, true, uint16(pools.BPS()));
        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pools.withdraw();
        assertEq(usdc.balanceOf(alice) - before, FEE, "withdraw pays the owed delta");
        assertEq(pools.owed(alice), 0, "ledger cleared");
    }

    function test_Refund_returnsEntryFeeOnCancelledPool() public {
        uint256 poolId = _newFundedPool(0);
        _join(poolId, alice);

        vm.prank(creator);
        pools.cancelPool(poolId);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pools.claimRefund(poolId);
        vm.prank(alice);
        pools.withdraw();
        assertEq(usdc.balanceOf(alice) - before, FEE, "refund returns the entry fee");
    }

    // ------------------------------------------------------ C-1: no pool lock

    function test_C1_blacklistedRecipientCannotBlockOthers() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS()));
        _record(poolId, bob, true, uint16(pools.BPS()));

        // Alice's wallet becomes USDC-blacklisted: any transfer to her reverts.
        usdc.blacklist(alice);

        // Settlement still completes — it credits owed[], never transfers (C-1).
        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);
        assertEq(pools.owed(alice), FEE, "alice still credited");
        assertEq(pools.owed(bob), FEE, "bob still credited");

        // Alice's own withdraw reverts (she cannot receive USDC)...
        vm.prank(alice);
        vm.expectRevert(bytes("USDC_BLACKLISTED"));
        pools.withdraw();

        // ...but bob withdraws his full payout regardless. The pool is NOT locked.
        uint256 before = usdc.balanceOf(bob);
        vm.prank(bob);
        pools.withdraw();
        assertEq(usdc.balanceOf(bob) - before, FEE, "bob paid despite alice being stuck");
    }

    // ---------------------------------------------------------- solvency (C-1/H-1)

    function test_Solvency_underfundedPoolNeverExceedsPot() public {
        // Two achievers each owed FEE at 1x = 20 USDC total, but the pool only
        // holds the two entry fees = 20 USDC and no extra funding. Fixed-bounty
        // scaling must cap total credited at the pot and stay solvent.
        uint256 poolId = _newFundedPool(0);
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS()));
        _record(poolId, bob, true, uint16(pools.BPS()));

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 pot = 2 * FEE;
        assertEq(pools.owed(alice) + pools.owed(bob), pot, "credited exactly the pot, never more");
        assertLe(pools.owed(alice) + pools.owed(bob), pot, "payouts never exceed the pool");

        // Both can actually pull — the contract is solvent for everything it owes.
        vm.prank(alice);
        pools.withdraw();
        vm.prank(bob);
        pools.withdraw();
        assertEq(pools.getPool(poolId).balance, 0, "pot fully distributed, nothing stranded");
    }

    function test_Withdraw_revertsWhenNothingOwed() public {
        vm.prank(carol);
        vm.expectRevert(bytes("NOTHING_OWED"));
        pools.withdraw();
    }

    // -------------------------------------------------------------- H-1 config

    function test_DeadConfig_reverts() public {
        vm.prank(creator);
        vm.expectRevert(bytes("DEAD_CONFIG"));
        pools.createPool("Zero", "bad", 0, uint64(block.timestamp), periodEnd, 0, 0);
    }

    // ------------------------------------------------------------- double join

    function test_DoubleJoin_revertsAndDebitsOnce() public {
        uint256 poolId = _newFundedPool(0);
        uint256 before = usdc.balanceOf(alice);
        _join(poolId, alice);

        vm.prank(alice);
        vm.expectRevert(bytes("ALREADY_JOINED"));
        pools.joinPool(poolId);

        assertEq(before - usdc.balanceOf(alice), FEE, "charged exactly once");
        assertEq(pools.participantCount(poolId), 1, "counted once");
    }

    // ------------------------------------------------------------- H-2 settler

    function test_H2_settlerOnlyInGrace_thenPublic() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        _record(poolId, alice, true, uint16(pools.BPS()));

        // Within the grace window a non-settler cannot settle (protects slow verdicts).
        vm.warp(periodEnd + 1);
        vm.prank(bob);
        vm.expectRevert(bytes("NOT_SETTLER"));
        pools.settle(poolId);

        // After the grace window anyone can settle (liveness fallback).
        vm.warp(uint256(periodEnd) + pools.SETTLE_GRACE() + 1);
        vm.prank(bob);
        pools.settle(poolId);
        assertEq(pools.owed(alice), FEE, "public fallback settled the pool");
    }

    function test_Settle_revertsBeforePeriodEnd() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        vm.prank(settler);
        vm.expectRevert(bytes("PERIOD_NOT_ENDED"));
        pools.settle(poolId);
    }

    // ------------------------------------------------ verdict gate (C-2 posture)

    function test_VerdictGate_failedVerdictIsNotAnAchiever() public {
        uint256 poolId = _newFundedPool(100e6);
        _join(poolId, alice);
        _record(poolId, alice, true, uint16(pools.BPS()));

        // Registry rejects alice's goal even though the oracle passed her.
        verdict.fail(pools.computeGoalId(poolId, alice));

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);
        assertEq(pools.owed(alice), 0, "verdict gate blocks a non-cleared achiever");
    }

    function test_Constructor_rejectsNonDistinctRoles() public {
        vm.expectRevert(bytes("ROLES_NOT_DISTINCT"));
        new HealthPoolsV3(address(usdc), oracle, oracle, address(verdict));
    }

    function test_SetHealthVerdict_cannotDisableGate() public {
        vm.expectRevert(bytes("GATE_CANNOT_DISABLE"));
        pools.setHealthVerdict(address(0));
    }

    // --------------------------------------------------------- pot-split model

    function test_PotSplit_sharesPotByMultiplier() public {
        // Model 1: winners split the whole pot pro-rata by multiplier.
        vm.prank(creator);
        uint256 poolId = pools.createPool("Split", "steps", FEE, uint64(block.timestamp), periodEnd, 1, 70e6);
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS())); // 1x
        _record(poolId, bob, true, uint16(2 * pools.BPS())); // 2x

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 pot = 70e6 + 2 * FEE; // funding + two entry fees = 90 USDC
        assertEq(pools.owed(alice), pot / 3, "alice gets 1/3");
        assertEq(pools.owed(bob), (pot * 2) / 3, "bob gets 2/3");
        assertLe(pools.owed(alice) + pools.owed(bob), pot, "split never exceeds the pot");
    }

    // ==================================================================
    // NEW blocking-fix tests — assert on real USDC balance deltas.
    // ==================================================================

    // ------------------------------------------ B-1: cancel -> sweep rug closed

    /// @notice A creator who cancels a pool must not be able to sweep participant
    ///         stakes before refunds are claimed. sweep() reverts REFUNDS_PENDING
    ///         while any participant is unrefunded and, once all refunds are
    ///         claimed, transfers ONLY the true surplus (the initial funding),
    ///         asserted on the creator's USDC balance delta.
    function test_B1_cancelThenSweepRevertsUntilRefundsClaimed() public {
        uint256 funding = 30e6; // true surplus (sponsor's own money)
        uint256 poolId = _newFundedPool(funding);
        _join(poolId, alice);
        _join(poolId, bob);
        // pool now holds funding + 2 stakes = 50 USDC; refund liability = 20 USDC.

        vm.prank(creator);
        pools.cancelPool(poolId);
        assertEq(pools.refundLiability(poolId), 2 * FEE, "liability = both stakes");

        // Rug attempt: sweep before anyone is refunded must revert.
        vm.prank(creator);
        vm.expectRevert(bytes("REFUNDS_PENDING"));
        pools.sweep(poolId);

        // One refund claimed; liability still non-zero -> sweep still reverts.
        vm.prank(alice);
        pools.claimRefund(poolId);
        assertEq(pools.refundLiability(poolId), FEE, "one stake still owed");
        vm.prank(creator);
        vm.expectRevert(bytes("REFUNDS_PENDING"));
        pools.sweep(poolId);

        // Last refund claimed; liability zero -> sweep now allowed.
        vm.prank(bob);
        pools.claimRefund(poolId);
        assertEq(pools.refundLiability(poolId), 0, "all refunds accounted for");

        uint256 creatorBefore = usdc.balanceOf(creator);
        vm.prank(creator);
        pools.sweep(poolId);
        // Swept amount equals ONLY the true surplus (the funding), never the stakes.
        assertEq(usdc.balanceOf(creator) - creatorBefore, funding, "creator sweeps only true surplus");

        // Participants can actually pull their refunded stakes in full.
        uint256 aBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pools.withdraw();
        assertEq(usdc.balanceOf(alice) - aBefore, FEE, "alice recovers her stake");

        uint256 bBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pools.withdraw();
        assertEq(usdc.balanceOf(bob) - bBefore, FEE, "bob recovers his stake");

        assertEq(pools.getPool(poolId).balance, 0, "pool fully drained, nothing stranded");
    }

    // --------------------------- B-2: oracle downtime refunds, never forfeits

    /// @notice When the oracle never adjudicates a participant, settle() must
    ///         refund that participant's stake to their own owed[] ledger, and the
    ///         creator must NOT be able to sweep those unadjudicated stakes. Only
    ///         the sponsor's own funding is sweepable. Asserted on USDC deltas.
    function test_B2_oracleDowntimeRefundsUnresolvedNeverForfeits() public {
        uint256 funding = 30e6; // sponsor's own money = the only sweepable surplus
        uint256 poolId = _newFundedPool(funding);
        _join(poolId, alice);
        _join(poolId, bob);
        // No recordResult calls at all: verification infra is down.
        assertEq(pools.recordedCount(poolId), 0, "nobody adjudicated");

        // Grace window passes; anyone can settle (liveness fallback).
        vm.warp(uint256(periodEnd) + pools.SETTLE_GRACE() + 1);
        vm.prank(carol);
        pools.settle(poolId);

        // Unresolved participants are REFUNDED, not forfeited to the creator.
        assertEq(pools.owed(alice), FEE, "alice refunded her stake");
        assertEq(pools.owed(bob), FEE, "bob refunded his stake");

        // The creator can sweep only the true surplus (the funding), never stakes.
        uint256 creatorBefore = usdc.balanceOf(creator);
        vm.prank(creator);
        pools.sweep(poolId);
        assertEq(usdc.balanceOf(creator) - creatorBefore, funding, "creator cannot sweep unresolved stakes");

        // Both stakers actually recover their money.
        uint256 aBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pools.withdraw();
        assertEq(usdc.balanceOf(alice) - aBefore, FEE, "alice recovers her stake");

        uint256 bBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pools.withdraw();
        assertEq(usdc.balanceOf(bob) - bBefore, FEE, "bob recovers his stake");

        assertEq(pools.getPool(poolId).balance, 0, "pool fully accounted for");
    }

    /// @dev Sanity companion to B-2: an EXPLICIT verdict == false does forfeit the
    ///      stake to the pool (sponsor), which is the only legitimate forfeiture.
    function test_B2_explicitFailureForfeitsToSponsor() public {
        uint256 poolId = _newFundedPool(0);
        _join(poolId, alice);
        _record(poolId, alice, false, uint16(pools.BPS())); // oracle says: did not hit goal

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        assertEq(pools.owed(alice), 0, "explicit failure gets no refund");
        // The forfeited stake is sweepable by the sponsor.
        uint256 creatorBefore = usdc.balanceOf(creator);
        vm.prank(creator);
        pools.sweep(poolId);
        assertEq(usdc.balanceOf(creator) - creatorBefore, FEE, "sponsor keeps the forfeited stake");
    }

    // ---------------------------------------- B-3: roles cannot collapse via setters

    /// @notice The three-key split is enforced on every setter, not just at
    ///         construction, so a later admin action can never collapse two roles
    ///         into the same key.
    function test_B3_settersRejectRoleCollapse() public {
        // Deployer (this test contract) is owner, so these calls come from owner.
        // Making the oracle equal to the settler must revert.
        vm.expectRevert(bytes("ROLES_NOT_DISTINCT"));
        pools.setOracle(settler);

        // Making the settler equal to the oracle must revert.
        vm.expectRevert(bytes("ROLES_NOT_DISTINCT"));
        pools.setAuthorizedSettler(oracle);

        // Handing ownership to the oracle (or settler) must revert.
        vm.expectRevert(bytes("ROLES_NOT_DISTINCT"));
        pools.transferOwnership(oracle);

        vm.expectRevert(bytes("ROLES_NOT_DISTINCT"));
        pools.transferOwnership(settler);

        // A genuinely distinct rotation still succeeds.
        address newOracle = makeAddr("newOracle");
        pools.setOracle(newOracle);
        assertEq(pools.oracle(), newOracle, "distinct oracle rotation allowed");
    }

    // ==================================================================
    // Model 2 — commitment / DietBet settlement. Equal split, multipliers
    // ignored, fee on forfeitures only, nobody-hit refunds all. All money
    // asserted on real owed[]/USDC deltas and on fund conservation.
    // ==================================================================

    /// @dev Model-2 commitment pool: everyone stakes toward their own goal, no
    ///      sponsor funding. Same shape as the pilot.
    function _newCommitmentPool() internal returns (uint256 poolId) {
        vm.prank(creator);
        poolId = pools.createPool("Commit", "8h sleep x7", FEE, uint64(block.timestamp), periodEnd, 2, 0);
    }

    function test_CreatePool_allowsModel2RejectsAbove() public {
        vm.prank(creator);
        uint256 poolId = pools.createPool("Commit", "goal", FEE, uint64(block.timestamp), periodEnd, 2, 0);
        assertEq(pools.getPool(poolId).bountyModel, 2, "model 2 accepted");

        vm.prank(creator);
        vm.expectRevert(bytes("BAD_BOUNTY_MODEL"));
        pools.createPool("Bad", "goal", FEE, uint64(block.timestamp), periodEnd, 3, 0);
    }

    /// @notice One achiever among missers takes the whole pot: own stake back plus
    ///         every forfeiture. This is the core DietBet mechanic.
    function test_Commitment_singleAchieverTakesAllForfeitures() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _join(poolId, carol);
        _record(poolId, alice, true, uint16(pools.BPS())); // hit
        _record(poolId, bob, false, uint16(pools.BPS())); // miss
        _record(poolId, carol, false, uint16(pools.BPS())); // miss

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        assertEq(pools.owed(alice), 3 * FEE, "achiever takes own stake + both forfeitures");
        assertEq(pools.owed(bob), 0, "misser forfeits");
        assertEq(pools.owed(carol), 0, "misser forfeits");
        assertEq(pools.getPool(poolId).balance, 0, "pot fully distributed");

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        pools.withdraw();
        assertEq(usdc.balanceOf(alice) - before, 3 * FEE, "achiever withdraws 3x her stake");
    }

    /// @notice N=2 both-hit: each just gets their own stake back, nobody loses.
    ///         This is what keeps the commitment model off the wager line.
    function test_Commitment_bothHitEachKeepsStake() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS()));
        _record(poolId, bob, true, uint16(pools.BPS()));

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        assertEq(pools.owed(alice), FEE, "alice keeps her stake");
        assertEq(pools.owed(bob), FEE, "bob keeps his stake");
        assertEq(pools.getPool(poolId).balance, 0, "pot fully returned, nobody loses");
    }

    /// @notice Nobody hits -> every adjudicated staker is refunded, nothing forfeited.
    function test_Commitment_nobodyHitsAllRefunded() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, false, uint16(pools.BPS()));
        _record(poolId, bob, false, uint16(pools.BPS()));

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        assertEq(pools.owed(alice), FEE, "alice refunded");
        assertEq(pools.owed(bob), FEE, "bob refunded");
        assertEq(pools.getPool(poolId).balance, 0, "nothing stranded");
    }

    /// @notice The fee is taken from forfeited stakes only, never a returned stake.
    function test_Commitment_feeTakenFromForfeituresOnly() public {
        pools.setCommitmentFeeBps(uint16(1_000)); // 10%
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS())); // hit
        _record(poolId, bob, false, uint16(pools.BPS())); // miss -> forfeits FEE

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 fee = FEE / 10; // 10% of the single forfeited stake
        assertEq(pools.owed(address(this)), fee, "owner earns fee on the forfeiture");
        assertEq(pools.owed(alice), 2 * FEE - fee, "achiever: own stake + net forfeiture");
        assertGe(pools.owed(alice), FEE, "achiever never taxed below her own stake");
        assertEq(pools.owed(bob), 0, "misser forfeits");
        assertEq(pools.owed(address(this)) + pools.owed(alice), 2 * FEE, "fee + payout == pot, conserved");
    }

    /// @notice Regression (adversarial panel, medium): the commitment fee must tax
    ///         forfeited STAKES only, never sponsor surplus. A model-2 pool with a
    ///         100 USDC top-up and a 20% fee must credit the owner 20% of the single
    ///         forfeited stake (2 USDC), not 20% of surplus+stake (22 USDC), and the
    ///         achiever receives the whole untaxed surplus.
    function test_Commitment_feeDoesNotTaxSponsorSurplus() public {
        pools.setCommitmentFeeBps(uint16(2_000)); // 20%
        uint256 surplus = 100e6;
        vm.prank(creator);
        uint256 poolId = pools.createPool("Commit", "goal", FEE, uint64(block.timestamp), periodEnd, 2, surplus);
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS())); // hit
        _record(poolId, bob, false, uint16(pools.BPS())); // miss -> forfeits FEE

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 fee = (FEE * 2_000) / 10_000; // 20% of bob's forfeited stake = 2 USDC
        uint256 pot = surplus + 2 * FEE; // 120 USDC
        assertEq(pools.owed(address(this)), fee, "fee taxes only the forfeited stake, not the surplus");
        assertEq(pools.owed(alice), pot - fee, "achiever gets pot minus the forfeiture fee (surplus untaxed)");
        assertGe(pools.owed(alice), FEE, "achiever recovers at least her stake");
        assertEq(
            pools.owed(alice) + pools.owed(address(this)) + pools.getPool(poolId).balance,
            pot,
            "funds conserved exactly"
        );
    }

    /// @notice Model 2 ignores multipliers entirely: it is an equal split.
    function test_Commitment_ignoresMultipliers() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _record(poolId, alice, true, uint16(pools.BPS())); // 1x
        _record(poolId, bob, true, uint16(3 * pools.BPS())); // 3x -- must be ignored

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        assertEq(pools.owed(alice), FEE, "equal split ignores multiplier");
        assertEq(pools.owed(bob), FEE, "equal split ignores multiplier");
    }

    /// @notice B-2 interaction: an unadjudicated staker is refunded (not forfeited),
    ///         and only the explicit misser's stake is split among achievers.
    function test_Commitment_unadjudicatedRefundedThenForfeituresSplit() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice); // hit
        _join(poolId, bob); // miss
        _join(poolId, carol); // oracle never adjudicates
        _record(poolId, alice, true, uint16(pools.BPS()));
        _record(poolId, bob, false, uint16(pools.BPS()));
        // carol: no record -> downtime

        vm.warp(uint256(periodEnd) + pools.SETTLE_GRACE() + 1);
        vm.prank(carol);
        pools.settle(poolId);

        assertEq(pools.owed(carol), FEE, "unadjudicated refunded (B-2)");
        assertEq(pools.owed(alice), 2 * FEE, "achiever gets own stake + bob's forfeiture, not carol's refund");
        assertEq(pools.owed(bob), 0, "explicit misser forfeits");
        assertEq(pools.getPool(poolId).balance, 0, "pot fully accounted");
    }

    /// @notice Integer-division dust stays in the pool; total credited never
    ///         exceeds the pot. 4 stakes, 3 achievers -> 40/3 each, 1 unit dust.
    function test_Commitment_dustStaysInPoolAndStaysSolvent() public {
        uint256 poolId = _newCommitmentPool();
        _join(poolId, alice);
        _join(poolId, bob);
        _join(poolId, carol);
        address dave = makeAddr("dave");
        usdc.mint(dave, 1_000e6);
        vm.prank(dave);
        usdc.approve(address(pools), type(uint256).max);
        _join(poolId, dave);

        _record(poolId, alice, true, uint16(pools.BPS()));
        _record(poolId, bob, true, uint16(pools.BPS()));
        _record(poolId, carol, true, uint16(pools.BPS()));
        _record(poolId, dave, false, uint16(pools.BPS())); // misser

        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 pot = 4 * FEE;
        uint256 share = pot / 3;
        assertEq(pools.owed(alice), share, "equal floor share");
        assertEq(pools.owed(bob), share, "equal floor share");
        assertEq(pools.owed(carol), share, "equal floor share");
        uint256 credited = pools.owed(alice) + pools.owed(bob) + pools.owed(carol);
        assertLe(credited, pot, "never over-credits the pot");
        assertEq(pools.getPool(poolId).balance, pot - credited, "dust remains in pool, nothing stranded");
        assertGe(share, FEE, "each achiever recovers at least her own stake");
    }

    function test_SetCommitmentFee_capsAndOwnerOnly() public {
        // Hoist the getter calls: an external call inside the args after
        // vm.expectRevert would consume the expectation instead of the setter.
        uint16 cap = pools.MAX_COMMITMENT_FEE_BPS();
        uint16 overCap = cap + 1;

        vm.expectRevert(bytes("FEE_TOO_HIGH"));
        pools.setCommitmentFeeBps(overCap);

        vm.prank(alice);
        vm.expectRevert(bytes("NOT_OWNER"));
        pools.setCommitmentFeeBps(uint16(500));

        pools.setCommitmentFeeBps(cap);
        assertEq(pools.commitmentFeeBps(), cap, "fee set to cap by owner");
    }

    /// @notice PILOT COMPLIANCE LOCK: a freshly deployed pool ships with the
    ///         commitment rake OFF (commitmentFeeBps == 0). The real-money pilot
    ///         depends on the platform taking no cut of losers' forfeited stakes
    ///         — a non-zero default reads as operating a gambling business. If a
    ///         future change sets a non-zero default in the constructor, this
    ///         test must fail loudly. The 20% ceiling is a cap only an explicit
    ///         owner action can approach, never a default.
    function test_Pilot_commitmentFeeDefaultsToZero() public {
        HealthPoolsV3 fresh = new HealthPoolsV3(address(usdc), oracle, settler, address(verdict));
        assertEq(fresh.commitmentFeeBps(), 0, "pilot ships with the commitment rake at 0");
        assertEq(fresh.MAX_COMMITMENT_FEE_BPS(), 2_000, "rake ceiling stays 20% (2000 bps), never a default");
    }

    /// @notice Property: for any staker count, hit pattern, and fee, model-2
    ///         settlement conserves funds exactly (users + owner fee + pool dust ==
    ///         pot) and never taxes an achiever below her own stake.
    function testFuzz_Commitment_conservesFundsAndReturnsStakes(uint8 rawCount, uint16 hitMask, uint16 rawFee)
        public
    {
        uint256 count = bound(rawCount, 2, 8);
        pools.setCommitmentFeeBps(uint16(bound(rawFee, 0, pools.MAX_COMMITMENT_FEE_BPS())));

        uint256 poolId = _newCommitmentPool();

        address[] memory users = new address[](count);
        for (uint256 i; i < count; ++i) {
            users[i] = address(uint160(0xBEEF0000 + i + 1));
            usdc.mint(users[i], 1_000e6);
            vm.prank(users[i]);
            usdc.approve(address(pools), type(uint256).max);
            _join(poolId, users[i]);
        }

        uint256 achievers;
        for (uint256 i; i < count; ++i) {
            bool hit = ((hitMask >> i) & 1) == 1;
            if (hit) achievers++;
            _record(poolId, users[i], hit, uint16(pools.BPS()));
        }

        uint256 pot = count * FEE;
        vm.warp(periodEnd + 1);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 creditedToUsers;
        for (uint256 i; i < count; ++i) creditedToUsers += pools.owed(users[i]);
        uint256 feeCredited = pools.owed(address(this)); // owner == deployer == this
        uint256 remaining = pools.getPool(poolId).balance;
        assertEq(creditedToUsers + feeCredited + remaining, pot, "funds conserved exactly");

        if (achievers == 0) {
            for (uint256 i; i < count; ++i) {
                assertEq(pools.owed(users[i]), FEE, "nobody-hit refunds every stake in full");
            }
            assertEq(feeCredited, 0, "no fee is taken when nobody hit");
        } else {
            for (uint256 i; i < count; ++i) {
                if (((hitMask >> i) & 1) == 1) {
                    assertGe(pools.owed(users[i]), FEE, "achiever recovers at least her own stake");
                } else {
                    assertEq(pools.owed(users[i]), 0, "misser forfeits");
                }
            }
        }
    }
}
