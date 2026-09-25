// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HealthPoolsV3} from "../src/HealthPoolsV3.sol";

/// @dev 6-decimal USDC mock, the minimum surface HealthPoolsV3 pulls and pushes.
contract DemoUSDC {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address spender, uint256 amt) external returns (bool) {
        allowance[msg.sender][spender] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        allowance[from][msg.sender] -= amt;
        balanceOf[from] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// @title  Tokyo 2026 demo flow
/// @notice Pins the exact shape scripts/tokyo-deploy.sh seeds on Base Sepolia and
///         the two failure modes the live demo could hit: settling from the wrong
///         wallet inside the 24h grace window, and settling before the period
///         ends. The deployment is oracle-only (healthVerdict == 0), rake 0, join
///         gate off, exactly the constructor values recorded in DEPLOYMENTS.md.
///         Money assertions are on the USDC delta and the AchieverPaid event,
///         never on tx success.
contract TokyoDemoTest is Test {
    event AchieverPaid(uint256 indexed poolId, address indexed participant, uint256 amount);
    event RefundCredited(uint256 indexed poolId, address indexed participant, uint256 amount);

    HealthPoolsV3 internal pools;
    DemoUSDC internal usdc;

    // Three distinct keys, as on chain: deployer (this) owns, oracle records,
    // the Circle developer-controlled wallet settles.
    address internal oracle = makeAddr("oracle");
    address internal settler = makeAddr("circle-spotter");
    address internal andre = makeAddr("andre");

    uint256 internal constant ENTRY = 1e6; // 1 USDC, what tokyo-deploy.sh seeds
    uint256 internal constant SPONSOR_POT = 2e6; // 2 USDC from the deployer per pool
    uint64 internal periodStart;
    uint64 internal periodEnd;

    function setUp() public {
        usdc = new DemoUSDC();
        pools = new HealthPoolsV3(address(usdc), oracle, settler, address(0));

        periodStart = uint64(block.timestamp);
        periodEnd = uint64(block.timestamp + 15 hours); // Saturday-evening JST window

        usdc.mint(address(this), 100e6);
        usdc.approve(address(pools), type(uint256).max);
        usdc.mint(andre, 10e6);
        vm.prank(andre);
        usdc.approve(address(pools), type(uint256).max);
    }

    /// @dev The seed shape: commitment model, 1 USDC entry, sponsor pot pulled
    ///      from the deployer at creation, no proof marker (wearable floor).
    function _seedDemoPool() internal returns (uint256 poolId) {
        poolId = pools.createPool(
            "Sleep 7 hours tonight", "Sleep at least 7 hours for 1 night", ENTRY, periodStart, periodEnd, 2, SPONSOR_POT
        );
    }

    function test_TokyoDeployDefaults_oracleOnlyRakeZeroGateOff() public view {
        assertEq(pools.owner(), address(this), "deployer owns");
        assertEq(pools.oracle(), oracle);
        assertEq(pools.authorizedSettler(), settler);
        assertEq(pools.healthVerdict(), address(0), "oracle-only: no verdict registry");
        assertEq(pools.commitmentFeeBps(), 0, "pilot rake lock");
        assertFalse(pools.joinGateEnabled(), "open join for the demo");
    }

    /// @notice Happy path judges watch: Andre stakes 1 USDC, the oracle records a
    ///         pass, SPOTTER settles inside the grace window, Andre withdraws his
    ///         stake plus the whole sponsor pot. Asserted on the USDC delta.
    function test_TokyoDemo_loneAchieverWithdrawsStakePlusSponsorPot() public {
        uint256 poolId = _seedDemoPool();
        assertEq(usdc.balanceOf(address(pools)), SPONSOR_POT, "pot pulled at creation");

        uint256 andreBefore = usdc.balanceOf(andre);
        vm.prank(andre);
        pools.joinPool(poolId);
        assertEq(andreBefore - usdc.balanceOf(andre), ENTRY, "join debits exactly the entry");

        vm.prank(oracle);
        pools.recordResult(poolId, andre, true, 10_000);

        vm.warp(uint256(periodEnd) + 1);
        vm.expectEmit(true, true, false, true, address(pools));
        emit AchieverPaid(poolId, andre, ENTRY + SPONSOR_POT);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 beforeWithdraw = usdc.balanceOf(andre);
        vm.prank(andre);
        pools.withdraw();
        assertEq(usdc.balanceOf(andre) - beforeWithdraw, ENTRY + SPONSOR_POT, "stake back plus the pot");
        assertEq(pools.getPool(poolId).balance, 0, "pool fully paid out");
        assertEq(usdc.balanceOf(address(pools)), 0, "contract holds nothing after the demo");
    }

    /// @notice The failure the demo could hit live: a settle sent from any wallet
    ///         other than the authorizedSettler inside the 24h grace window, or
    ///         sent before periodEnd, must not move money. After the grace window
    ///         the same call from anyone succeeds (liveness fallback).
    function test_TokyoDemo_wrongWalletOrEarlySettleDoesNotPay() public {
        uint256 poolId = _seedDemoPool();
        vm.prank(andre);
        pools.joinPool(poolId);
        vm.prank(oracle);
        pools.recordResult(poolId, andre, true, 10_000);

        // Too early: even the settler is refused.
        vm.prank(settler);
        vm.expectRevert(bytes("PERIOD_NOT_ENDED"));
        pools.settle(poolId);

        // Inside grace: the owner (deployer) and the participant are refused.
        vm.warp(uint256(periodEnd) + 1);
        vm.expectRevert(bytes("NOT_SETTLER"));
        pools.settle(poolId);
        vm.prank(andre);
        vm.expectRevert(bytes("NOT_SETTLER"));
        pools.settle(poolId);
        assertEq(pools.owed(andre), 0, "nothing credited by a refused settle");
        assertFalse(pools.getPool(poolId).settled);

        // After grace: permissionless, and the payout is identical.
        vm.warp(uint256(periodEnd) + pools.SETTLE_GRACE() + 1);
        vm.prank(andre);
        pools.settle(poolId);
        assertEq(pools.owed(andre), ENTRY + SPONSOR_POT, "public settle pays the same");
    }

    /// @notice If the wearable never syncs, the oracle never records, and settle
    ///         refunds the stake instead of forfeiting it; the sponsor pot stays
    ///         in the pool for the creator to sweep. recordResult after settle
    ///         is refused, so a late verdict cannot rewrite a closed pool.
    function test_TokyoDemo_noVerdictRefundsStakeAndLocksPool() public {
        uint256 poolId = _seedDemoPool();
        vm.prank(andre);
        pools.joinPool(poolId);

        vm.warp(uint256(periodEnd) + 1);
        vm.expectEmit(true, true, false, true, address(pools));
        emit RefundCredited(poolId, andre, ENTRY);
        vm.prank(settler);
        pools.settle(poolId);

        uint256 before = usdc.balanceOf(andre);
        vm.prank(andre);
        pools.withdraw();
        assertEq(usdc.balanceOf(andre) - before, ENTRY, "stake refunded, nothing forfeited");
        assertEq(pools.getPool(poolId).balance, SPONSOR_POT, "sponsor pot untouched");

        vm.prank(oracle);
        vm.expectRevert(bytes("SETTLED"));
        pools.recordResult(poolId, andre, true, 10_000);

        uint256 sponsorBefore = usdc.balanceOf(address(this));
        pools.sweep(poolId);
        assertEq(usdc.balanceOf(address(this)) - sponsorBefore, SPONSOR_POT, "creator sweeps the pot back");
    }

    /// @notice goalId must stay identical across contract, app and scripts:
    ///         keccak256(abi.encode(pools, poolId, participant, periodStart)).
    function test_TokyoDemo_goalIdMatchesAppFormula() public {
        uint256 poolId = _seedDemoPool();
        bytes32 expected = keccak256(abi.encode(address(pools), poolId, andre, periodStart));
        assertEq(pools.computeGoalId(poolId, andre), expected);
    }
}
