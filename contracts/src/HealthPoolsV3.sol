// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal surface of the Chainlink Confidential AI verdict registry. When
///      configured, an achiever must also be cleared by canSettle(goalId).
interface IHealthVerdict {
    function canSettle(bytes32 goalId) external view returns (bool);
}

/// @title  HealthPoolsV3 (Base fork)
/// @notice Sponsor-funded health-goal reward pools settled in USDC on Base.
///         Hardened rebuild of the settlement contract for the CRE-first,
///         testnet-only Base pilot. UNAUDITED. A professional audit is required
///         before any mainnet deployment or real-money settlement.
///
/// @dev    What this closes versus the live v1 / the V2 remediation candidate:
///         C-1  Pull-payment settlement. settle() only CREDITS owed[user]; each
///              recipient later pulls with withdraw(). No transfer happens inside
///              the settle loop, so one USDC-blacklisted or reverting recipient
///              can never lock the pool or block anyone else's payout.
///         C-2  Roles are split across three distinct keys (owner, oracle,
///              settler) enforced at construction AND on every setter (B-3), so
///              the split can never be silently collapsed after deploy. The
///              verdict gate can be turned ON but never silently turned back OFF
///              (setHealthVerdict rejects the zero address once any registry is
///              configured). Deploy owner as a Safe/timelock — the on-chain split
///              plus that latch is the code half of C-2; timelocked ownership is
///              the deployment half.
///         H-1  createPool reverts DEAD_CONFIG on entryFee == 0. Every joiner
///              therefore stakes, so every winner is a staker.
///         H-2  Authorized-settler role with a public grace fallback: only the
///              settler may settle within SETTLE_GRACE after periodEnd (so slow
///              verdicts are not front-run into forfeiture); after the grace
///              window anyone may settle, so the settler can never grief liveness.
///         B-1  cancelPool -> sweep rug closed. A cancelled pool records its full
///              refund liability; sweep() reverts REFUNDS_PENDING until every
///              participant has claimed, so a creator can only ever sweep true
///              surplus, never staked entry fees earmarked for refund.
///         B-2  Oracle non-response is a refund, not a forfeiture. settle()
///              credits the entry fee of any participant the oracle never
///              adjudicated back to that participant's own owed[] ledger.
///              Forfeiture-to-sponsor only ever follows an explicit
///              verdict == false, so verification downtime can never become a
///              silent mass loss of stakers' funds.
///
///         Solvency is structural: settle moves value from pool.balance into
///         owed[] claims one-for-one under checked arithmetic, and the frozen-pot
///         scaling caps total credited at the pot, so payouts can never exceed the
///         pool. USDC is 6 decimals; all amounts are raw base units.
contract HealthPoolsV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------- types

    struct Pool {
        address creator;
        uint8 bountyModel; // 0 = fixed bounty, 1 = pro-rata pot split, 2 = commitment (equal split)
        bool settled; // locked once settlement runs (or the pool is cancelled)
        bool cancelled; // locked for refunds instead of payouts
        uint64 periodStart;
        uint64 periodEnd;
        uint256 entryFee; // USDC (6 decimals); must be > 0 (H-1)
        uint256 balance; // USDC currently attributable to this pool
        string initiative;
        string goalSpec;
    }

    struct Participant {
        bool joined;
        bool resultRecorded;
        bool verdict;
        bool refunded;
        uint16 multiplierBps; // 10000 = 1x, capped at 30000 (3x)
    }

    // --------------------------------------------------------------- constants

    uint256 public constant BPS = 10_000;
    uint16 public constant MAX_MULTIPLIER_BPS = 30_000;
    uint256 public constant MAX_PARTICIPANTS = 200; // bounds the settle loop
    uint256 public constant SETTLE_GRACE = 24 hours; // settler-only window (H-2)
    uint16 public constant MAX_COMMITMENT_FEE_BPS = 2_000; // 20% cap on the model-2 forfeiture fee

    // ----------------------------------------------------------------- storage

    IERC20 public immutable usdc;
    address public owner; // deploy as a Safe/timelock (C-2)
    address public oracle; // records verdicts (C-2, distinct key)
    address public authorizedSettler; // privileged settler in grace window (C-2/H-2)
    address public healthVerdict; // optional verdict registry; write-once-on latch
    uint16 public commitmentFeeBps; // model-2 fee on forfeitures only; 0 = waived (pilot default)

    /// @notice Closed-pilot join gate (compliance). When joinGateEnabled is
    ///         true, only allowlisted wallets may joinPool — the on-chain
    ///         enforcement behind the family-and-friends closed real-money test,
    ///         so the money-in path is gated by the contract, not by obscurity.
    ///         Default OFF, so open testnet flows are unchanged; the owner turns
    ///         it ON for the pilot and allowlists each participant.
    bool public joinGateEnabled;
    mapping(address => bool) public joinAllowed;

    uint256 public poolCount; // pool ids run 1..poolCount
    mapping(uint256 => Pool) internal pools;
    mapping(uint256 => address[]) internal participantList;
    mapping(uint256 => mapping(address => Participant)) internal participants;
    mapping(uint256 => mapping(address => bool)) internal achieverFlag;

    /// @notice Pull-payment ledger (C-1). Credited at settlement/refund; drained
    ///         by the recipient via withdraw(). A stuck recipient stalls only its
    ///         own balance.
    mapping(address => uint256) public owed;

    /// @notice Count of participants the oracle has explicitly adjudicated (B-2).
    ///         Used only for observability; the settle refund pass keys off each
    ///         participant's own resultRecorded flag.
    mapping(uint256 => uint256) public recordedCount;

    /// @notice Outstanding entry-fee refund liability on a cancelled pool (B-1).
    ///         Set to entryFee * participantCount on cancel, decremented as each
    ///         participant claims. sweep() is gated on this being zero so a
    ///         creator can never sweep money earmarked for participant refunds.
    mapping(uint256 => uint256) public refundLiability;

    // ------------------------------------------------------------------ events

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        string initiative,
        string goalSpec,
        uint256 entryFee,
        uint64 periodStart,
        uint64 periodEnd,
        uint8 bountyModel
    );
    event PoolJoined(uint256 indexed poolId, address indexed participant);
    event ResultRecorded(uint256 indexed poolId, address indexed participant, bool verdict, uint16 multiplierBps);
    event PoolFunded(uint256 indexed poolId, address indexed funder, uint256 amount);
    event AchieverPaid(uint256 indexed poolId, address indexed participant, uint256 amount);
    event PoolSettled(uint256 indexed poolId, uint256 achieverCount, uint256 totalPaid);
    event PoolCancelled(uint256 indexed poolId);
    event RefundCredited(uint256 indexed poolId, address indexed participant, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event FundsSwept(uint256 indexed poolId, address indexed creator, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event OracleUpdated(address indexed previousOracle, address indexed newOracle);
    event SettlerUpdated(address indexed previousSettler, address indexed newSettler);
    event HealthVerdictUpdated(address indexed previousRegistry, address indexed newRegistry);
    event CommitmentFeeUpdated(uint16 previousBps, uint16 newBps);
    event JoinGateToggled(bool enabled);
    event JoinAllowlistUpdated(address indexed account, bool allowed);

    // --------------------------------------------------------------- modifiers

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle, "NOT_ORACLE");
        _;
    }

    // ------------------------------------------------------------- constructor

    /// @param token   ERC-20 used for accounting (Base USDC in prod, a mock in tests).
    /// @param oracle_ signer allowed to record verdicts.
    /// @param settler_ privileged settler for the grace window.
    /// @param verdict_ optional verdict registry (address(0) = oracle-only for the
    ///                 early pilot; once set non-zero the gate cannot be disabled).
    constructor(address token, address oracle_, address settler_, address verdict_) {
        require(token.code.length > 0, "TOKEN_NOT_CONTRACT");
        require(oracle_ != address(0) && settler_ != address(0), "ZERO_ROLE");
        // C-2: the three money-touching roles must be distinct keys.
        require(oracle_ != msg.sender && settler_ != msg.sender && oracle_ != settler_, "ROLES_NOT_DISTINCT");

        usdc = IERC20(token);
        owner = msg.sender;
        oracle = oracle_;
        authorizedSettler = settler_;
        healthVerdict = verdict_;

        emit OwnershipTransferred(address(0), msg.sender);
        emit OracleUpdated(address(0), oracle_);
        emit SettlerUpdated(address(0), settler_);
        if (verdict_ != address(0)) emit HealthVerdictUpdated(address(0), verdict_);
    }

    // ------------------------------------------------------------- role admin

    /// @notice Transfer ownership. B-3: the new owner must stay distinct from the
    ///         oracle and settler so the three-key split cannot be collapsed.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        require(newOwner != oracle && newOwner != authorizedSettler, "ROLES_NOT_DISTINCT");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Rotate the oracle key. B-3: it must stay distinct from owner and settler.
    function setOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "ZERO_ORACLE");
        require(newOracle != owner && newOracle != authorizedSettler, "ROLES_NOT_DISTINCT");
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /// @notice Rotate the settler key. B-3: it must stay distinct from owner and oracle.
    function setAuthorizedSettler(address newSettler) external onlyOwner {
        require(newSettler != address(0), "ZERO_SETTLER");
        require(newSettler != owner && newSettler != oracle, "ROLES_NOT_DISTINCT");
        emit SettlerUpdated(authorizedSettler, newSettler);
        authorizedSettler = newSettler;
    }

    /// @notice Enable or swap the verdict registry. C-2: it can never be set back
    ///         to address(0), so a compromised owner cannot silently disable the
    ///         confidential-verification gate to force through fake achievers.
    function setHealthVerdict(address newRegistry) external onlyOwner {
        require(newRegistry != address(0), "GATE_CANNOT_DISABLE");
        emit HealthVerdictUpdated(healthVerdict, newRegistry);
        healthVerdict = newRegistry;
    }

    /// @notice Set the model-2 commitment fee, in bps of the forfeited stakes.
    ///         0 waives it (the pilot default). Capped at MAX_COMMITMENT_FEE_BPS.
    ///         The fee is only ever taken from forfeited stakes, never from a
    ///         returned one, so an achiever always recovers at least their stake.
    function setCommitmentFeeBps(uint16 newBps) external onlyOwner {
        require(newBps <= MAX_COMMITMENT_FEE_BPS, "FEE_TOO_HIGH");
        emit CommitmentFeeUpdated(commitmentFeeBps, newBps);
        commitmentFeeBps = newBps;
    }

    /// @notice Toggle the closed-pilot join gate. OFF (default) = anyone may
    ///         join; ON = only allowlisted wallets may join. This is the
    ///         on-chain half of the family-and-friends closed real-money test.
    function setJoinGateEnabled(bool enabled) external onlyOwner {
        joinGateEnabled = enabled;
        emit JoinGateToggled(enabled);
    }

    /// @notice Allow or disallow a single wallet from joining while the gate is
    ///         on. No effect while the gate is off.
    function setJoinAllowed(address account, bool allowed) external onlyOwner {
        joinAllowed[account] = allowed;
        emit JoinAllowlistUpdated(account, allowed);
    }

    /// @notice Batch form of setJoinAllowed — approve the whole family list in a
    ///         single transaction.
    function setJoinAllowedBatch(address[] calldata accounts, bool allowed) external onlyOwner {
        for (uint256 i; i < accounts.length; ++i) {
            joinAllowed[accounts[i]] = allowed;
            emit JoinAllowlistUpdated(accounts[i], allowed);
        }
    }

    // ---------------------------------------------------------------- actions

    /// @notice Permissionless pool creation. Pulls initialFunding from the caller.
    function createPool(
        string calldata initiative,
        string calldata goalSpec,
        uint256 entryFee,
        uint64 periodStart,
        uint64 periodEnd,
        uint8 bountyModel,
        uint256 initialFunding
    ) external nonReentrant returns (uint256 poolId) {
        require(periodEnd > periodStart, "BAD_PERIOD");
        require(periodEnd > block.timestamp, "PERIOD_IN_PAST");
        require(bountyModel <= 2, "BAD_BOUNTY_MODEL");
        // H-1: a fee-free pool cannot pay a fixed bounty and lets winners join
        // without staking. Require a real stake so every winner is a staker.
        require(entryFee > 0, "DEAD_CONFIG");

        poolId = ++poolCount;
        Pool storage p = pools[poolId];
        p.creator = msg.sender;
        p.bountyModel = bountyModel;
        p.periodStart = periodStart;
        p.periodEnd = periodEnd;
        p.entryFee = entryFee;
        p.initiative = initiative;
        p.goalSpec = goalSpec;

        if (initialFunding > 0) p.balance = _pull(msg.sender, initialFunding);

        emit PoolCreated(poolId, msg.sender, initiative, goalSpec, entryFee, periodStart, periodEnd, bountyModel);
    }

    /// @notice Join a pool. One wallet = one entry (World ID was removed in the
    ///         Circle build; entry is gated on the address here). Pulls entryFee.
    function joinPool(uint256 poolId) external nonReentrant {
        // Closed-pilot gate: when on, only allowlisted wallets may stake. Off by
        // default, so this is a no-op until the owner enables the pilot.
        require(!joinGateEnabled || joinAllowed[msg.sender], "NOT_ALLOWLISTED");
        Pool storage p = _existingPool(poolId);
        require(!p.settled, "SETTLED");
        require(block.timestamp < p.periodEnd, "PERIOD_ENDED");
        require(!participants[poolId][msg.sender].joined, "ALREADY_JOINED");
        require(participantList[poolId].length < MAX_PARTICIPANTS, "POOL_FULL");

        participants[poolId][msg.sender].joined = true;
        participantList[poolId].push(msg.sender);
        p.balance += _pull(msg.sender, p.entryFee);

        emit PoolJoined(poolId, msg.sender);
    }

    /// @notice Oracle posts a participant's verdict. One shot per participant.
    function recordResult(uint256 poolId, address user, bool verdict, uint16 multiplierBps) external onlyOracle {
        Pool storage p = _existingPool(poolId);
        require(!p.settled, "SETTLED");
        require(multiplierBps <= MAX_MULTIPLIER_BPS, "MULTIPLIER_TOO_HIGH");

        Participant storage part = participants[poolId][user];
        require(part.joined, "NOT_PARTICIPANT");
        require(!part.resultRecorded, "ALREADY_RECORDED");

        part.resultRecorded = true;
        part.verdict = verdict;
        part.multiplierBps = multiplierBps;
        recordedCount[poolId] += 1; // B-2: track adjudication coverage

        emit ResultRecorded(poolId, user, verdict, multiplierBps);
    }

    /// @notice Top up an unsettled, un-cancelled pool.
    function fundPool(uint256 poolId, uint256 amount) external nonReentrant {
        Pool storage p = _existingPool(poolId);
        require(!p.settled, "SETTLED");
        require(amount > 0, "ZERO_AMOUNT");
        p.balance += _pull(msg.sender, amount);
        emit PoolFunded(poolId, msg.sender, amount);
    }

    /// @notice Cancel an unsettled pool. Locks it and opens per-participant
    ///         entry-fee refunds via claimRefund(). Creator sweeps only the true
    ///         surplus, and only once every refund is claimed (B-1).
    function cancelPool(uint256 poolId) external {
        Pool storage p = _existingPool(poolId);
        require(msg.sender == p.creator, "NOT_CREATOR");
        require(!p.settled, "SETTLED");
        p.settled = true; // lock joins/records/funds
        p.cancelled = true;
        // B-1: record the full entry-fee liability owed back to participants so
        // sweep() cannot drain staked fees before refunds are claimed.
        refundLiability[poolId] = p.entryFee * participantList[poolId].length;
        emit PoolCancelled(poolId);
    }

    /// @notice Settle a pool after its period ends. Credits achievers to the
    ///         pull-payment ledger (C-1); never transfers here. H-2: settler-only
    ///         within the grace window, permissionless afterwards. B-2: any
    ///         participant the oracle never adjudicated is refunded, not forfeited.
    function settle(uint256 poolId) external nonReentrant {
        Pool storage p = _existingPool(poolId);
        require(!p.settled, "ALREADY_SETTLED");
        require(block.timestamp > p.periodEnd, "PERIOD_NOT_ENDED");
        if (block.timestamp <= uint256(p.periodEnd) + SETTLE_GRACE) {
            require(msg.sender == authorizedSettler, "NOT_SETTLER");
        }
        p.settled = true;

        address[] storage plist = participantList[poolId];
        uint256 n = plist.length;

        // Pass 1 — tally achievers and refund the unadjudicated (B-2). A missing
        // verdict means the oracle never showed up: that is downtime, not a
        // failure, so the stake is credited back to its owner as a refund and
        // removed from the pot. Only an explicit verdict == false forfeits a
        // stake to the pool (and thence to the sponsor via sweep).
        uint256 achieverCount;
        uint256 sumMult;
        uint256 totalOwed;
        uint256 totalWeight;
        for (uint256 i; i < n; ++i) {
            address user = plist[i];
            Participant storage part = participants[poolId][user];
            if (!part.resultRecorded) {
                // B-2: refund the unadjudicated participant's own stake.
                uint256 refund = p.entryFee;
                p.balance -= refund; // checked: cannot refund more than the pot holds
                owed[user] += refund;
                emit RefundCredited(poolId, user, refund);
                continue;
            }
            if (_isAchiever(poolId, user)) {
                achieverFlag[poolId][user] = true;
                uint256 w = p.entryFee * part.multiplierBps;
                achieverCount++;
                sumMult += part.multiplierBps;
                totalOwed += w / BPS;
                totalWeight += w;
            }
        }

        // Pass 2 — credit each achiever from the frozen (post-refund) pot. No
        // external calls; a stuck recipient can never block this loop (C-1).
        uint256 pot = p.balance;
        uint256 totalPaid;
        if (p.bountyModel == 2) {
            // Commitment / DietBet: equal split of the frozen pot among achievers
            // (own stake back + an equal share of forfeitures), or a full refund to
            // every adjudicated staker when nobody hit. Multipliers are ignored.
            totalPaid = _settleCommitment(poolId, p, plist, n, pot, achieverCount);
        } else if (achieverCount > 0 && pot > 0) {
            for (uint256 i; i < n; ++i) {
                address user = plist[i];
                if (!achieverFlag[poolId][user]) continue;
                uint256 payout = _achieverPayout(
                    p.bountyModel, p.entryFee, participants[poolId][user].multiplierBps, pot, totalOwed, totalWeight, sumMult
                );
                if (payout == 0) continue;
                require(payout <= p.balance, "INSOLVENT"); // structural solvency guard
                p.balance -= payout;
                owed[user] += payout;
                totalPaid += payout;
                emit AchieverPaid(poolId, user, payout);
            }
        }

        emit PoolSettled(poolId, achieverCount, totalPaid);
    }

    /// @notice Credit a participant's entry-fee refund on a cancelled pool. Pull
    ///         model: the refund lands in owed[], claimed via withdraw(). B-1:
    ///         decrements the pool's refund liability so the creator can only
    ///         sweep once everyone is made whole.
    function claimRefund(uint256 poolId) external nonReentrant {
        Pool storage p = _existingPool(poolId);
        require(p.cancelled, "NOT_CANCELLED");
        Participant storage part = participants[poolId][msg.sender];
        require(part.joined, "NOT_PARTICIPANT");
        require(!part.refunded, "ALREADY_REFUNDED");

        part.refunded = true;
        uint256 amount = p.entryFee;
        refundLiability[poolId] -= amount; // B-1: once-per-participant (guarded above)
        p.balance -= amount; // checked: cannot refund more than the pool holds
        owed[msg.sender] += amount;

        emit RefundCredited(poolId, msg.sender, amount);
    }

    /// @notice Pull whatever the caller is owed. C-1: a reverting/blacklisted
    ///         caller can only ever stall its own balance, never anyone else's.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = owed[msg.sender];
        require(amount > 0, "NOTHING_OWED");
        owed[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Creator reclaims the pool remainder after settlement/cancellation.
    ///         B-1: on a cancelled pool this reverts REFUNDS_PENDING until every
    ///         participant has claimed, so only true surplus can ever be swept.
    function sweep(uint256 poolId) external nonReentrant {
        Pool storage p = _existingPool(poolId);
        require(p.settled, "NOT_SETTLED");
        require(msg.sender == p.creator, "NOT_CREATOR");
        require(refundLiability[poolId] == 0, "REFUNDS_PENDING");
        uint256 amount = p.balance;
        require(amount > 0, "NOTHING_TO_SWEEP");
        p.balance = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit FundsSwept(poolId, msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function getPool(uint256 poolId) external view returns (Pool memory) {
        return pools[_requirePool(poolId)];
    }

    function getParticipant(uint256 poolId, address user) external view returns (Participant memory) {
        return participants[poolId][user];
    }

    function participantCount(uint256 poolId) external view returns (uint256) {
        return participantList[poolId].length;
    }

    /// @notice Deterministic goal id shared with the CRE pipeline and the verdict
    ///         registry. All layers must agree on this hash.
    function computeGoalId(uint256 poolId, address participant) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), poolId, participant, pools[poolId].periodStart));
    }

    // -------------------------------------------------------------- internals

    function _existingPool(uint256 poolId) internal view returns (Pool storage p) {
        require(poolId >= 1 && poolId <= poolCount, "NO_POOL");
        p = pools[poolId];
    }

    function _requirePool(uint256 poolId) internal view returns (uint256) {
        require(poolId >= 1 && poolId <= poolCount, "NO_POOL");
        return poolId;
    }

    /// @dev An achiever passed the oracle AND, when a registry is configured, the
    ///      confidential verdict gate. With healthVerdict == 0 this is oracle-only.
    function _isAchiever(uint256 poolId, address user) internal view returns (bool) {
        Participant storage part = participants[poolId][user];
        if (!(part.resultRecorded && part.verdict)) return false;
        address registry = healthVerdict;
        if (registry == address(0)) return true;
        return IHealthVerdict(registry).canSettle(computeGoalId(poolId, user));
    }

    /// @dev One achiever's payout from the frozen pot. Fixed-bounty (model 0)
    ///      multiplies before dividing (F-6) so scaled payouts never exceed the
    ///      pot; pot-split (model 1) shares the pot by multiplier weight.
    function _achieverPayout(
        uint8 model,
        uint256 entryFee,
        uint16 mult,
        uint256 pot,
        uint256 totalOwed,
        uint256 totalWeight,
        uint256 sumMult
    ) internal pure returns (uint256) {
        if (pot == 0) return 0;
        if (model == 0) {
            if (totalOwed == 0) return 0;
            uint256 w = entryFee * mult;
            return totalOwed > pot ? (w * pot) / totalWeight : w / BPS;
        }
        if (sumMult == 0) return 0;
        return (pot * mult) / sumMult;
    }

    /// @dev Model 2 (commitment / DietBet). Multipliers are ignored; every
    ///      achiever is treated equally. With one or more achievers the frozen pot
    ///      is split equally (pot / achieverCount each). Because the post-refund
    ///      pot holds exactly the adjudicated stakes (achievers' own + forfeiters')
    ///      plus any surplus, an equal split returns each achiever their own stake
    ///      plus an equal share of the forfeitures. The fee is taken from the
    ///      forfeited stakes only (never a returned stake, never sponsor surplus),
    ///      so surplus flows to achievers untaxed; integer dust stays in the pool.
    ///      With NO achievers ("nobody hit") every
    ///      adjudicated staker is refunded and nothing is forfeited or taxed.
    ///      Solvency is structural: total credited <= pot under checked math.
    function _settleCommitment(
        uint256 poolId,
        Pool storage p,
        address[] storage plist,
        uint256 n,
        uint256 pot,
        uint256 achieverCount
    ) internal returns (uint256 totalPaid) {
        uint256 entryFee = p.entryFee;

        // Nobody hit: refund every adjudicated staker; forfeit and tax nothing.
        if (achieverCount == 0) {
            for (uint256 i; i < n; ++i) {
                address user = plist[i];
                Participant storage part = participants[poolId][user];
                if (!part.resultRecorded) continue; // unadjudicated already refunded (B-2)
                p.balance -= entryFee; // checked: every recorded stake is in the pot
                owed[user] += entryFee;
                emit RefundCredited(poolId, user, entryFee);
            }
            return 0;
        }

        // Fee base is the forfeited STAKES only: adjudicated non-achievers
        // (recordedCount - achieverCount) each staked entryFee. This never taxes an
        // achiever's returned stake, and never taxes sponsor surplus (surplus flows
        // to achievers untaxed via the equal split below). Credited to owner owed[].
        uint256 forfeited = (recordedCount[poolId] - achieverCount) * entryFee;
        uint256 fee = (forfeited * commitmentFeeBps) / BPS;
        if (fee > 0) {
            p.balance -= fee; // checked
            owed[owner] += fee;
        }

        uint256 share = (pot - fee) / achieverCount; // equal split; dust stays in pool
        if (share == 0) return 0;

        for (uint256 i; i < n; ++i) {
            address user = plist[i];
            if (!achieverFlag[poolId][user]) continue;
            require(share <= p.balance, "INSOLVENT"); // structural solvency guard
            p.balance -= share;
            owed[user] += share;
            totalPaid += share;
            emit AchieverPaid(poolId, user, share);
        }
    }

    /// @dev SafeERC20 transferFrom, crediting the ACTUAL balance delta so a
    ///      fee-on-transfer token can never overstate the ledger.
    function _pull(address from, uint256 amount) internal returns (uint256 received) {
        uint256 balBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        received = usdc.balanceOf(address(this)) - balBefore;
    }
}
