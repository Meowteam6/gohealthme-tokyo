// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HealthVerdict
/// @notice On-chain verdict registry for GoHealthMe (ETHGlobal NY 2026). A
///         Chainlink Confidential AI run produces a signed inference digest and
///         a structured verdict off-chain; the authorized attester writes that
///         verdict here, causing an on-chain state change. HealthPools.settle()
///         consults this registry as an additional proof layer when configured.
///
/// Privacy invariant: no raw health data ever lands on chain. We store only the
/// boolean outcome, a confidence tier, a facet bitmap, and the keccak digest of
/// the signed inference — never the inputs.
///
/// One verdict per goalId. A verdict is one-shot by default (re-recording by the
/// attester reverts). The owner can force an override via overrideVerdict() to
/// recover from a bad attestation; overrides emit a distinct event so the audit
/// trail shows the correction explicitly.
///
/// Two ingestion paths, both landing in the same verdict storage:
///   1. recordVerdict(...) — the attester-EOA path. A relayer that holds the
///      attester role submits the Confidential AI result directly. Kept for
///      backward compatibility and for non-CRE flows.
///   2. onReport(metadata, report) — the Chainlink CRE / KeystoneForwarder path.
///      The CRE wf-goal-verification workflow ABI-encodes the verdict, wraps it
///      in a DON-signed report, and the KeystoneForwarder calls onReport here.
///      Only the configured forwarder may call it. This is the IReceiver
///      interface the forwarder expects.

/// @notice Minimal CRE receiver interface. The KeystoneForwarder calls
///         `onReport` with workflow metadata and the ABI-encoded report.
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

contract HealthVerdict is IReceiver {
    // ----------------------------------------------------------- confidence

    /// Confidence tiers. canSettle() requires anything above LOW.
    uint8 public constant CONFIDENCE_LOW = 0;
    uint8 public constant CONFIDENCE_MEDIUM = 1;
    uint8 public constant CONFIDENCE_HIGH = 2;

    // -------------------------------------------------------- facet bitmap

    /// Each bit of Verdict.bitmap records one verification facet that the
    /// off-chain pipeline confirmed. They are advisory metadata for the UI and
    /// for richer settlement policies; canSettle() itself only gates on
    /// verified + confidence, so the facet meaning can evolve without changing
    /// the settlement contract.
    uint16 public constant FACET_WEARABLE = 1 << 0; // bit0: wearable data verified
    uint16 public constant FACET_WORLD_ID = 1 << 1; // bit1: World ID confirmed
    uint16 public constant FACET_AI_ATTESTED = 1 << 2; // bit2: AI attested
    uint16 public constant FACET_NOT_DUPLICATE = 1 << 3; // bit3: not a duplicate claim

    /// Mask of all currently defined facet bits. Recording a bitmap with unknown
    /// bits set reverts, so the on-chain record stays meaningful.
    uint16 public constant FACET_MASK =
        FACET_WEARABLE | FACET_WORLD_ID | FACET_AI_ATTESTED | FACET_NOT_DUPLICATE;

    // -------------------------------------------------------------- types

    struct Verdict {
        bool verified; // did the goal pass verification
        uint8 confidence; // 0 = low, 1 = medium, 2 = high
        bytes32 digest; // keccak of the signed inference from the attester
        address attester; // who wrote this verdict
        uint64 timestamp; // block time the verdict was recorded
        uint16 bitmap; // verification facets (see FACET_* constants)
    }

    // ------------------------------------------------------------ storage

    address public owner;
    address public attester; // the only address allowed to recordVerdict
    address public forwarder; // the only address allowed to call onReport (CRE KeystoneForwarder)
    mapping(bytes32 => Verdict) internal verdicts;
    mapping(bytes32 => bool) public recorded; // true once a goalId has any verdict

    // ------------------------------------------------------------- events

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AttesterUpdated(address indexed previousAttester, address indexed newAttester);
    event ForwarderUpdated(address indexed previousForwarder, address indexed newForwarder);
    event VerdictRecorded(
        bytes32 indexed goalId,
        bool verified,
        uint8 confidence,
        bytes32 digest,
        address indexed attester,
        uint16 bitmap
    );
    event VerdictOverridden(
        bytes32 indexed goalId,
        bool verified,
        uint8 confidence,
        bytes32 digest,
        address indexed overrider,
        uint16 bitmap
    );

    // ---------------------------------------------------------- modifiers

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyAttester() {
        require(msg.sender == attester, "NOT_ATTESTER");
        _;
    }

    modifier onlyForwarder() {
        require(msg.sender == forwarder, "NOT_FORWARDER");
        _;
    }

    // -------------------------------------------------------- constructor

    /// @param attester_ the address allowed to record verdicts (the relayer that
    ///        submits the Chainlink Confidential AI result on chain).
    constructor(address attester_) {
        require(attester_ != address(0), "ZERO_ATTESTER");
        owner = msg.sender;
        attester = attester_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AttesterUpdated(address(0), attester_);
    }

    // -------------------------------------------------------------- admin

    function setAttester(address newAttester) external onlyOwner {
        require(newAttester != address(0), "ZERO_ATTESTER");
        emit AttesterUpdated(attester, newAttester);
        attester = newAttester;
    }

    /// @notice Set the trusted CRE KeystoneForwarder allowed to call onReport.
    ///         Defaults to the zero address (the onReport path is disabled until
    ///         the owner points it at the real Forwarder on the target chain, or
    ///         a mock forwarder in tests).
    function setForwarder(address newForwarder) external onlyOwner {
        require(newForwarder != address(0), "ZERO_FORWARDER");
        emit ForwarderUpdated(forwarder, newForwarder);
        forwarder = newForwarder;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ------------------------------------------------------------ actions

    /// @notice Record the verdict for a goal. One-shot: reverts if the goalId
    ///         already has a verdict (use overrideVerdict to correct one).
    /// @param goalId     deterministic id, see computeGoalId.
    /// @param verified   whether the goal passed verification.
    /// @param confidence 0 = low, 1 = medium, 2 = high.
    /// @param digest     keccak of the signed inference (never the raw inputs).
    /// @param bitmap     facet bits, must be a subset of FACET_MASK.
    function recordVerdict(
        bytes32 goalId,
        bool verified,
        uint8 confidence,
        bytes32 digest,
        uint16 bitmap
    ) external onlyAttester {
        require(!recorded[goalId], "ALREADY_RECORDED");
        require(confidence <= CONFIDENCE_HIGH, "BAD_CONFIDENCE");
        require(bitmap & ~FACET_MASK == 0, "BAD_BITMAP");

        recorded[goalId] = true;
        verdicts[goalId] = Verdict({
            verified: verified,
            confidence: confidence,
            digest: digest,
            attester: msg.sender,
            timestamp: uint64(block.timestamp),
            bitmap: bitmap
        });

        emit VerdictRecorded(goalId, verified, confidence, digest, msg.sender, bitmap);
    }

    /// @notice CRE / KeystoneForwarder ingestion path. The wf-goal-verification
    ///         workflow ABI-encodes the verdict and wraps it in a DON-signed
    ///         report; the KeystoneForwarder delivers it here.
    ///
    /// @dev The forwarder calls onReport(metadata, report). `metadata` carries
    ///      the workflow id / DON id and is unused in this minimal receiver. The
    ///      `report` body must decode to the exact tuple the workflow encodes:
    ///        abi.encode(bytes32 goalId, bool verified, uint8 confidence,
    ///                   bytes32 digest, uint16 bitmap)
    ///      One-shot, same as recordVerdict: a goalId that already has a verdict
    ///      reverts (use overrideVerdict to correct one). The recorded verdict's
    ///      `attester` field is set to the forwarder for an explicit audit trail
    ///      of the CRE-delivered record.
    function onReport(bytes calldata, bytes calldata report) external onlyForwarder {
        (bytes32 goalId, bool verified, uint8 confidence, bytes32 digest, uint16 bitmap) =
            abi.decode(report, (bytes32, bool, uint8, bytes32, uint16));

        require(!recorded[goalId], "ALREADY_RECORDED");
        require(confidence <= CONFIDENCE_HIGH, "BAD_CONFIDENCE");
        require(bitmap & ~FACET_MASK == 0, "BAD_BITMAP");

        recorded[goalId] = true;
        verdicts[goalId] = Verdict({
            verified: verified,
            confidence: confidence,
            digest: digest,
            attester: msg.sender,
            timestamp: uint64(block.timestamp),
            bitmap: bitmap
        });

        emit VerdictRecorded(goalId, verified, confidence, digest, msg.sender, bitmap);
    }

    /// @notice Owner escape hatch to correct a bad attestation. Works whether or
    ///         not a verdict already exists, and is logged distinctly so the
    ///         audit trail shows the correction.
    function overrideVerdict(
        bytes32 goalId,
        bool verified,
        uint8 confidence,
        bytes32 digest,
        uint16 bitmap
    ) external onlyOwner {
        require(confidence <= CONFIDENCE_HIGH, "BAD_CONFIDENCE");
        require(bitmap & ~FACET_MASK == 0, "BAD_BITMAP");

        recorded[goalId] = true;
        verdicts[goalId] = Verdict({
            verified: verified,
            confidence: confidence,
            digest: digest,
            attester: msg.sender,
            timestamp: uint64(block.timestamp),
            bitmap: bitmap
        });

        emit VerdictOverridden(goalId, verified, confidence, digest, msg.sender, bitmap);
    }

    // ---------------------------------------------------------------- views

    /// @notice Settlement gate: a goal may settle only if it has a recorded
    ///         verdict that is verified AND has at least MEDIUM confidence.
    function canSettle(bytes32 goalId) external view returns (bool) {
        Verdict storage v = verdicts[goalId];
        return v.verified && v.confidence != CONFIDENCE_LOW;
    }

    function getVerdict(bytes32 goalId) external view returns (Verdict memory) {
        return verdicts[goalId];
    }

    /// @notice True if a specific facet bit is set in a goal's verdict.
    function hasFacet(bytes32 goalId, uint16 facet) external view returns (bool) {
        return verdicts[goalId].bitmap & facet == facet;
    }

    // -------------------------------------------------------------- helpers

    /// @notice Deterministic goal id shared by the off-chain CRE pipeline and the
    ///         on-chain contracts. Every side must compute it identically.
    ///
    /// @dev Domain-separated by the HealthPools instance. This registry is a
    ///      standalone contract that several pool contracts may share, so keying
    ///      on (poolId, participant) alone would let pool id 1 on one HealthPools
    ///      collide with pool id 1 on another — a verdict recorded against one
    ///      deployment would satisfy canSettle() on the other. Including `pools`
    ///      scopes each verdict to the contract that will consume it.
    ///
    ///      `periodStart` scopes the verdict to the pool's period, so a recurring
    ///      pool can carry one verdict per period rather than one for all time.
    ///
    ///      The goal's metric is deliberately NOT part of the id: a pool has a
    ///      single goalSpec, so poolId already pins the metric, and hashing a
    ///      free-form string would force identical canonicalization across
    ///      Solidity and two TypeScript call sites for no disambiguation gain.
    function computeGoalId(address pools, uint256 poolId, address participant, uint64 periodStart)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(pools, poolId, participant, periodStart));
    }
}
