// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthVerdict} from "../src/HealthVerdict.sol";

/// @dev Stand-in for the Chainlink KeystoneForwarder. In production the real
///      Forwarder verifies the DON signatures over the report and then calls
///      receiver.onReport(metadata, report). For tests we only need the final
///      hop — an authorized caller forwarding the already-encoded report — so
///      this mock just relays the call, mirroring how `cre ... simulate
///      --broadcast` writes through the MockKeystoneForwarder.
contract MockKeystoneForwarder {
    function forward(address receiver, bytes calldata metadata, bytes calldata report) external {
        HealthVerdict(receiver).onReport(metadata, report);
    }
}

contract HealthVerdictTest is Test {
    HealthVerdict internal reg;

    address internal owner = address(this); // deployer is owner
    address internal attester = makeAddr("attester");
    address internal rando = makeAddr("rando");

    bytes32 internal goalId = keccak256("goal-1");
    bytes32 internal digest = keccak256("signed-inference");

    // Mirror constants evaluated at compile time. Calling the contract's public
    // constant getters inside a vm.prank() would consume the prank on the getter
    // call (it is an external call), so recordVerdict would then run from the
    // wrong sender. Using these local copies keeps the prank on recordVerdict.
    uint8 internal constant LOW = 0;
    uint8 internal constant MEDIUM = 1;
    uint8 internal constant HIGH = 2;
    uint16 internal constant FACET_WEARABLE = 1 << 0;
    uint16 internal constant FACET_WORLD_ID = 1 << 1;
    uint16 internal constant FACET_AI_ATTESTED = 1 << 2;
    uint16 internal constant FACET_NOT_DUPLICATE = 1 << 3;
    uint16 internal constant ALL_FACETS =
        FACET_WEARABLE | FACET_WORLD_ID | FACET_AI_ATTESTED | FACET_NOT_DUPLICATE;

    function setUp() public {
        reg = new HealthVerdict(attester);
    }

    // -------------------------------------------------------- constructor

    function test_constructor_setsOwnerAndAttester() public view {
        assertEq(reg.owner(), owner);
        assertEq(reg.attester(), attester);
    }

    function test_constructor_zeroAttesterReverts() public {
        vm.expectRevert(bytes("ZERO_ATTESTER"));
        new HealthVerdict(address(0));
    }

    // ------------------------------------------------------------- record

    function test_recordVerdict_happyPath_highConfidence() public {
        uint16 bitmap = ALL_FACETS;
        vm.prank(attester);
        reg.recordVerdict(goalId, true, HIGH, digest, bitmap);

        HealthVerdict.Verdict memory v = reg.getVerdict(goalId);
        assertTrue(v.verified);
        assertEq(v.confidence, HIGH);
        assertEq(v.digest, digest);
        assertEq(v.attester, attester);
        assertEq(v.bitmap, bitmap);
        assertEq(v.timestamp, uint64(block.timestamp));
        assertTrue(reg.recorded(goalId));
        assertTrue(reg.canSettle(goalId));
    }

    function test_recordVerdict_onlyAttester() public {
        vm.prank(rando);
        vm.expectRevert(bytes("NOT_ATTESTER"));
        reg.recordVerdict(goalId, true, HIGH, digest, 0);

        // even the owner cannot record (only the attester role can)
        vm.expectRevert(bytes("NOT_ATTESTER"));
        reg.recordVerdict(goalId, true, HIGH, digest, 0);
    }

    function test_recordVerdict_oneShotReverts() public {
        vm.startPrank(attester);
        reg.recordVerdict(goalId, true, HIGH, digest, 0);
        vm.expectRevert(bytes("ALREADY_RECORDED"));
        reg.recordVerdict(goalId, false, LOW, digest, 0);
        vm.stopPrank();
    }

    function test_recordVerdict_badConfidenceReverts() public {
        vm.prank(attester);
        vm.expectRevert(bytes("BAD_CONFIDENCE"));
        reg.recordVerdict(goalId, true, 3, digest, 0); // valid tiers are 0..2
    }

    function test_recordVerdict_badBitmapReverts() public {
        uint16 unknownBit = 1 << 4; // outside FACET_MASK
        vm.prank(attester);
        vm.expectRevert(bytes("BAD_BITMAP"));
        reg.recordVerdict(goalId, true, HIGH, digest, unknownBit);
    }

    // -------------------------------------------------- confidence tiers

    function test_canSettle_confidenceTiers() public {
        bytes32 low = keccak256("low");
        bytes32 med = keccak256("med");
        bytes32 high = keccak256("high");

        vm.startPrank(attester);
        reg.recordVerdict(low, true, LOW, digest, 0);
        reg.recordVerdict(med, true, MEDIUM, digest, 0);
        reg.recordVerdict(high, true, HIGH, digest, 0);
        vm.stopPrank();

        assertFalse(reg.canSettle(low)); // low confidence blocks
        assertTrue(reg.canSettle(med));
        assertTrue(reg.canSettle(high));
    }

    function test_canSettle_unverifiedBlocksEvenAtHighConfidence() public {
        vm.prank(attester);
        reg.recordVerdict(goalId, false, HIGH, digest, 0);
        assertFalse(reg.canSettle(goalId));
    }

    function test_canSettle_unknownGoalIsFalse() public view {
        assertFalse(reg.canSettle(keccak256("never-recorded")));
    }

    // ------------------------------------------------------------ bitmap

    function test_hasFacet_individualBits() public {
        uint16 bitmap = FACET_WEARABLE | FACET_AI_ATTESTED;
        vm.prank(attester);
        reg.recordVerdict(goalId, true, HIGH, digest, bitmap);

        assertTrue(reg.hasFacet(goalId, FACET_WEARABLE));
        assertTrue(reg.hasFacet(goalId, FACET_AI_ATTESTED));
        assertFalse(reg.hasFacet(goalId, FACET_WORLD_ID));
        assertFalse(reg.hasFacet(goalId, FACET_NOT_DUPLICATE));
    }

    function test_facetMask_coversAllNamedBits() public view {
        assertEq(reg.FACET_MASK(), ALL_FACETS);
    }

    // ------------------------------------------------------- admin/override

    function test_setAttester_onlyOwnerAndUpdates() public {
        vm.prank(rando);
        vm.expectRevert(bytes("NOT_OWNER"));
        reg.setAttester(rando);

        reg.setAttester(rando); // owner is the test contract
        assertEq(reg.attester(), rando);

        vm.prank(rando);
        reg.recordVerdict(goalId, true, HIGH, digest, 0);
        assertTrue(reg.canSettle(goalId));
    }

    function test_setAttester_zeroReverts() public {
        vm.expectRevert(bytes("ZERO_ATTESTER"));
        reg.setAttester(address(0));
    }

    function test_overrideVerdict_ownerCorrectsBadAttestation() public {
        vm.prank(attester);
        reg.recordVerdict(goalId, true, HIGH, digest, 0);
        assertTrue(reg.canSettle(goalId));

        // owner flips a bad attestation
        bytes32 newDigest = keccak256("corrected");
        reg.overrideVerdict(goalId, false, LOW, newDigest, 0);
        assertFalse(reg.canSettle(goalId));
        assertEq(reg.getVerdict(goalId).digest, newDigest);
        assertEq(reg.getVerdict(goalId).attester, owner);
    }

    function test_overrideVerdict_onlyOwner() public {
        vm.prank(rando);
        vm.expectRevert(bytes("NOT_OWNER"));
        reg.overrideVerdict(goalId, true, HIGH, digest, 0);
    }

    function test_transferOwnership() public {
        reg.transferOwnership(rando);
        assertEq(reg.owner(), rando);
        vm.expectRevert(bytes("NOT_OWNER"));
        reg.setAttester(rando); // old owner can no longer admin
    }

    // ------------------------------------------------------------ helpers

    function test_computeGoalId_matchesKeccak() public {
        address poolsAddr = makeAddr("pools");
        uint256 poolId = 7;
        address participant = makeAddr("participant");
        uint64 periodStart = 1_700_000_000;
        assertEq(
            reg.computeGoalId(poolsAddr, poolId, participant, periodStart),
            keccak256(abi.encode(poolsAddr, poolId, participant, periodStart))
        );
    }

    /// The pool contract address is in the preimage, so two HealthPools
    /// deployments sharing this registry cannot collide on (poolId, participant).
    /// Without it, a verdict recorded against one deployment would satisfy
    /// canSettle() for the same pool id on another.
    function test_computeGoalId_domainSeparatedByPoolsContract() public {
        address participant = makeAddr("participant");
        assertTrue(
            reg.computeGoalId(makeAddr("poolsA"), 1, participant, 1_700_000_000)
                != reg.computeGoalId(makeAddr("poolsB"), 1, participant, 1_700_000_000)
        );
    }

    /// periodStart is in the preimage, so the same participant in the same pool
    /// gets a distinct goal id each period — a recurring pool is not capped at
    /// one verdict for all time.
    function test_computeGoalId_distinctPerPeriod() public {
        address poolsAddr = makeAddr("pools");
        address participant = makeAddr("participant");
        assertTrue(
            reg.computeGoalId(poolsAddr, 1, participant, 1_700_000_000)
                != reg.computeGoalId(poolsAddr, 1, participant, 1_700_604_800)
        );
    }

    // ------------------------------------------------ CRE onReport path

    /// Encode the report body exactly as the wf-goal-verification workflow does:
    ///   abi.encode(bytes32 goalId, bool verified, uint8 confidence, bytes32 digest, uint16 bitmap)
    function _encodeReport(bytes32 goalId_, bool verified, uint8 confidence, bytes32 digest_, uint16 bitmap)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(goalId_, verified, confidence, digest_, bitmap);
    }

    function test_setForwarder_onlyOwnerAndUpdates() public {
        assertEq(reg.forwarder(), address(0)); // disabled by default

        vm.prank(rando);
        vm.expectRevert(bytes("NOT_OWNER"));
        reg.setForwarder(rando);

        reg.setForwarder(rando); // owner is the test contract
        assertEq(reg.forwarder(), rando);
    }

    function test_setForwarder_zeroReverts() public {
        vm.expectRevert(bytes("ZERO_FORWARDER"));
        reg.setForwarder(address(0));
    }

    function test_onReport_happyPathThroughForwarder() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));

        uint16 bitmap = FACET_AI_ATTESTED | FACET_WEARABLE;
        bytes memory report = _encodeReport(goalId, true, HIGH, digest, bitmap);
        fwd.forward(address(reg), bytes(""), report);

        HealthVerdict.Verdict memory v = reg.getVerdict(goalId);
        assertTrue(v.verified);
        assertEq(v.confidence, HIGH);
        assertEq(v.digest, digest);
        assertEq(v.attester, address(fwd)); // recorded as the forwarder
        assertEq(v.bitmap, bitmap);
        assertTrue(reg.recorded(goalId));
        assertTrue(reg.canSettle(goalId));
    }

    function test_onReport_onlyForwarder() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));

        bytes memory report = _encodeReport(goalId, true, HIGH, digest, 0);

        // direct call from a random EOA is rejected
        vm.prank(rando);
        vm.expectRevert(bytes("NOT_FORWARDER"));
        reg.onReport(bytes(""), report);

        // even the attester EOA cannot use the forwarder path
        vm.prank(attester);
        vm.expectRevert(bytes("NOT_FORWARDER"));
        reg.onReport(bytes(""), report);
    }

    function test_onReport_disabledWhenForwarderUnset() public {
        // forwarder defaults to address(0); no real (non-zero) sender can call.
        assertEq(reg.forwarder(), address(0));
        bytes memory report = _encodeReport(goalId, true, HIGH, digest, 0);
        vm.prank(rando);
        vm.expectRevert(bytes("NOT_FORWARDER"));
        reg.onReport(bytes(""), report);
    }

    function test_onReport_oneShotReverts() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));

        fwd.forward(address(reg), bytes(""), _encodeReport(goalId, true, HIGH, digest, 0));
        vm.expectRevert(bytes("ALREADY_RECORDED"));
        fwd.forward(address(reg), bytes(""), _encodeReport(goalId, false, LOW, digest, 0));
    }

    function test_onReport_badConfidenceReverts() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));
        vm.expectRevert(bytes("BAD_CONFIDENCE"));
        fwd.forward(address(reg), bytes(""), _encodeReport(goalId, true, 3, digest, 0));
    }

    function test_onReport_badBitmapReverts() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));
        uint16 unknownBit = 1 << 4;
        vm.expectRevert(bytes("BAD_BITMAP"));
        fwd.forward(address(reg), bytes(""), _encodeReport(goalId, true, HIGH, digest, unknownBit));
    }

    /// The override escape hatch still works on a CRE-delivered verdict.
    function test_onReport_thenOwnerOverride() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));
        fwd.forward(address(reg), bytes(""), _encodeReport(goalId, true, HIGH, digest, 0));
        assertTrue(reg.canSettle(goalId));

        reg.overrideVerdict(goalId, false, LOW, keccak256("corrected"), 0);
        assertFalse(reg.canSettle(goalId));
        assertEq(reg.getVerdict(goalId).attester, owner);
    }

    /// Cross-check: the exact report body the wf-goal-verification workflow
    /// produces (captured from `bun run dry-run` on simulation/callback-payload.json)
    /// must decode through onReport into the expected verdict. This pins viem's
    /// off-chain encodeAbiParameters output to the on-chain abi.decode shape —
    /// a Solidity-only round trip would not catch an encoder mismatch.
    ///
    /// REGENERATING: the goalId depends on cre/wf-goal-verification/config.json
    /// (poolsAddress, poolId, user, periodStart). If that config changes, re-run
    /// `cd cre && bun run dry-run` and update WF_* plus the report body below.
    function test_onReport_decodesWorkflowEncodedReport() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));

        // Mirrors cre/wf-goal-verification/config.json.
        address wfPools = 0xc4274eF2cBe28f77Af31b980055Cc1171818390C;
        uint256 wfPoolId = 1;
        address wfUser = 0x8ba1f109551bD432803012645Ac136ddd64DBA72;
        uint64 wfPeriodStart = 1785190895;

        // From cre dry-run: verified=true; confidence=HIGH(2); bitmap=5;
        // digest = resources[0].response_digest.
        bytes memory workflowReport =
            hex"819ca6183dcc2d337646fd3631791611d0e17ee9474ccd4737c10c990beea692"
            hex"0000000000000000000000000000000000000000000000000000000000000001"
            hex"0000000000000000000000000000000000000000000000000000000000000002"
            hex"0a0124911560a2236e432d30c3e2a90b0666f4c84b40bf10ba01960595c6ecea"
            hex"0000000000000000000000000000000000000000000000000000000000000005";

        fwd.forward(address(reg), bytes(""), workflowReport);

        bytes32 expectedGoalId = reg.computeGoalId(wfPools, wfPoolId, wfUser, wfPeriodStart);
        assertEq(expectedGoalId, bytes32(uint256(0x819ca6183dcc2d337646fd3631791611d0e17ee9474ccd4737c10c990beea692)));

        HealthVerdict.Verdict memory v = reg.getVerdict(expectedGoalId);
        assertTrue(v.verified);
        assertEq(v.confidence, HIGH);
        assertEq(v.digest, bytes32(uint256(0x0a0124911560a2236e432d30c3e2a90b0666f4c84b40bf10ba01960595c6ecea)));
        assertEq(v.bitmap, FACET_AI_ATTESTED | FACET_WEARABLE);
        assertTrue(reg.canSettle(expectedGoalId));
    }

    /// recordVerdict (attester EOA path) still works alongside the onReport path.
    function test_recordVerdict_backwardCompatWithForwarderSet() public {
        MockKeystoneForwarder fwd = new MockKeystoneForwarder();
        reg.setForwarder(address(fwd));

        // attester EOA path
        bytes32 g1 = keccak256("eoa-goal");
        vm.prank(attester);
        reg.recordVerdict(g1, true, HIGH, digest, 0);
        assertEq(reg.getVerdict(g1).attester, attester);

        // forwarder path, distinct goal
        bytes32 g2 = keccak256("cre-goal");
        fwd.forward(address(reg), bytes(""), _encodeReport(g2, true, HIGH, digest, 0));
        assertEq(reg.getVerdict(g2).attester, address(fwd));
    }
}
