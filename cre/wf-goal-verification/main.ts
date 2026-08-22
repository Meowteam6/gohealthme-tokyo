/**
 * wf-goal-verification — GoHealthMe Chainlink CRE workflow.
 *
 * Architecture: Chainlink Confidential AI Attester CALLBACK model.
 * -----------------------------------------------------------------
 * Reimplemented for HEALTH goals from Chainlink's official, MIT-licensed
 * Confidential AI Attester demo:
 *   https://github.com/smartcontractkit/chainlink-confidential-ai-attester-demo
 * (the undercollateralized-loan reference). See AI_ATTRIBUTION.md and README.md.
 *
 *   ┌────────────────────────┐  POST /v1/inference (health doc + cre_callback)  ┌──────────────┐
 *   │ GoHealthMe app / script │ ───────────────────────────────────────────────▶ │ Confidential │
 *   │ (uploads a goal summary │                                                  │ AI Attester  │
 *   │  / synthetic lab doc)   │                                                  │  (TEE)       │
 *   └────────────────────────┘                                                  └──────┬───────┘
 *        the Attester runs an LLM INSIDE A TEE, decides whether the health goal      │ callback
 *        was met, signs request+response digests, and POSTs the verdict to the       │
 *        cre_callback URL ( = THIS workflow's HTTP-trigger endpoint).                 ▼
 *   ┌──────────────────────────────────────────────────────────────────────────────────────┐
 *   │ CRE workflow (this file)                                                                │
 *   │  1. HTTP trigger receives the callback body (payload.input bytes)                       │
 *   │  2. status !== "completed"  → log + return early                                        │
 *   │  3. parse the verdict JSON from `output` (strip the ```json fence)                      │
 *   │        → { verified, confidence, reason, metric_value, threshold }                      │
 *   │  4. digest = resources[0].response_digest  (the TEE inference transcript hash)          │
 *   │  5. goalId = keccak256(abi.encode(pools, poolId, user, periodStart))                    │
 *   │        [matches HealthVerdict.computeGoalId / HealthPools.computeGoalId]                │
 *   │  6. encodeAbiParameters(bytes32 goalId, bool verified, uint8 confidence,                │
 *   │                         bytes32 digest, uint16 bitmap)                                  │
 *   │  7. runtime.report(...) → DON-signed report  →  EVMClient.writeReport(...)              │
 *   └────────────────────────────────────────────┬───────────────────────────────────────────┘
 *                                                │ signed report, via the KeystoneForwarder
 *                                                ▼
 *   contracts/src/HealthVerdict.sol :: onReport(bytes metadata, bytes report)  [onlyForwarder]
 *     • abi.decode(report) → (goalId, verified, confidence, digest, bitmap)
 *     • records the verdict (same storage as recordVerdict); canSettle(goalId) gates HealthPools
 *
 * Privacy invariant
 * -----------------
 * The raw health document is analysed INSIDE the Attester's TEE; the app never
 * sends raw wearable samples to the DON. The callback this workflow receives
 * carries only the structured verdict and the signed inference digests. On chain
 * we store only { verified, confidence, keccak(transcript digest), facet bitmap }
 * — the inputs never land on chain. This mirrors HealthVerdict.sol's invariant.
 *
 * QuickJS/WASM runtime: no process.env / Buffer / crypto; viem does all ABI
 * encoding and hashing. SDK shapes are from @chainlink/cre-sdk@1.11.0.
 */

import {
  cre,
  Runner,
  type Runtime,
  type HTTPPayload,
  hexToBase64,
} from '@chainlink/cre-sdk'
import {
  encodeAbiParameters,
  keccak256,
  hexToBytes,
  type Hex,
  type Address,
} from 'viem'

// --------------------------------------------------------------------------- config

interface AuthorizedKeyConfig {
  type: 'KEY_TYPE_ECDSA_EVM'
  publicKey: string
}

/** Shape of wf-goal-verification/config.json. */
interface WorkflowConfig {
  /**
   * HealthPools instance that will consume this verdict. Part of the
   * deterministic goalId — it domain-separates the shared HealthVerdict registry
   * across pool deployments. See computeGoalId.
   */
  poolsAddress: Address
  /** Pool the goal belongs to. Part of the deterministic goalId. */
  poolId: number
  /** Participant whose goal is being verified. Part of the deterministic goalId. */
  user: Address
  /**
   * Pool period start, unix seconds. Part of the deterministic goalId — it
   * scopes the verdict to one period so a recurring pool is not limited to a
   * single verdict for all time. Must equal the pool's on-chain periodStart.
   */
  periodStart: number
  /** Receiver contract: HealthVerdict on Arc. Zero address until deployed (see README). */
  healthVerdictAddress: string
  /** Chain selector for the receiver chain (Arc testnet). */
  chainSelector: string
  /** Gas limit for the writeReport forward. */
  writeGasLimit: string
  /** Public keys allowed to sign incoming HTTP trigger requests (the Attester / gateway). */
  authorizedKeys: AuthorizedKeyConfig[]
}

// ------------------------------------------------------ attester callback shape

/**
 * The Confidential AI Attester callback body (only the fields this workflow uses).
 * See simulation/callback-payload.json for a recorded example.
 */
interface InferenceCallback {
  id?: string
  status?: string // "completed" | "failed" | ...
  output?: string // the LLM verdict as JSON, usually wrapped in a ```json fence
  resource_summaries?: { digest?: string; filename?: string }[]
  resources?: { digest?: string; request_digest?: string; response_digest?: string }[]
}

type Confidence = 'low' | 'medium' | 'high'

/**
 * The structured verdict the Attester LLM is prompted to return for a health
 * goal. `metric_value` / `threshold` are the observed vs target metric (e.g.
 * average daily steps); they justify the boolean and feed the demo UI.
 */
interface HealthVerdictJson {
  verified?: boolean
  confidence?: Confidence | string
  reason?: string
  metric_value?: number
  threshold?: number
}

/** Result surfaced from the workflow (also what the simulation prints). */
interface WorkflowResult {
  id: string | null
  status: string | null
  action?: 'skipped'
  goalId?: Hex
  verified?: boolean
  confidence?: Confidence
  reason?: string
  metricValue?: number | null
  threshold?: number | null
  digest?: Hex
  bitmap?: number
  receiver?: string
  /** Hex of the ABI-encoded report body wrapped by runtime.report. */
  encodedReport?: Hex
  /** "live" once a real DON write succeeds; "encoded-only" in simulation. */
  writeMode?: 'live' | 'encoded-only'
  txStatus?: string
}

// ----------------------------------------------------------------- constants

const CONFIDENCE_TO_U8: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }

// HealthVerdict facet bits (mirror HealthVerdict.sol FACET_* constants).
const FACET_WEARABLE = 1 << 0 // bit0: wearable data verified
const FACET_AI_ATTESTED = 1 << 2 // bit2: AI attested

// Report body ABI — must match HealthVerdict.onReport's abi.decode:
//   (bytes32 goalId, bool verified, uint8 confidence, bytes32 digest, uint16 bitmap)
const REPORT_ABI = [
  { name: 'goalId', type: 'bytes32' },
  { name: 'verified', type: 'bool' },
  { name: 'confidence', type: 'uint8' },
  { name: 'digest', type: 'bytes32' },
  { name: 'bitmap', type: 'uint16' },
] as const

// ----------------------------------------------------------------- helpers

/** The LLM output is JSON, often wrapped in a ```json … ``` fence; strip + parse. */
const parseHealthVerdict = (output: string): HealthVerdictJson => {
  const fenced = output.trim().match(/^```(?:[a-zA-Z0-9]+)?\s*([\s\S]*?)\s*```$/)
  const json = fenced?.[1] !== undefined ? fenced[1].trim() : output
  return JSON.parse(json) as HealthVerdictJson
}

/** Normalize an arbitrary confidence string to the strict tier. */
const normalizeConfidence = (c: unknown): Confidence =>
  c === 'high' || c === 'medium' ? c : 'low'

/** Normalize a 32-byte hex digest (with or without 0x) to a bytes32 value. */
const toBytes32 = (hex: string): Hex => {
  const h = hex.replace(/^0[xX]/, '')
  if (h.length !== 64 || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(`expected a 32-byte hex digest, got "${hex}"`)
  }
  return `0x${h.toLowerCase()}` as Hex
}

/**
 * computeGoalId — must match HealthVerdict.computeGoalId:
 *   keccak256(abi.encode(address pools, uint256 poolId,
 *                        address participant, uint64 periodStart))
 *
 * Equivalently HealthPools.computeGoalId(poolId, participant), which reads
 * periodStart from its own storage and uses address(this) as `pools`.
 *
 * `pools` domain-separates the shared HealthVerdict registry so pool id 1 on one
 * HealthPools deployment cannot collide with pool id 1 on another. `periodStart`
 * scopes the verdict to a single pool period.
 */
const computeGoalId = (
  pools: Address,
  poolId: number,
  user: Address,
  periodStart: number,
): Hex =>
  keccak256(
    encodeAbiParameters(
      [
        { name: 'pools', type: 'address' },
        { name: 'poolId', type: 'uint256' },
        { name: 'participant', type: 'address' },
        { name: 'periodStart', type: 'uint64' },
      ],
      [pools, BigInt(poolId), user, BigInt(periodStart)],
    ),
  )

// ----------------------------------------------- HTTP trigger handler (callback)

const onInferenceCallback = (
  runtime: Runtime<WorkflowConfig>,
  payload: HTTPPayload,
): string => {
  const cfg = runtime.config

  // 1) Decode the HTTP body bytes into the Attester callback object.
  const callback = JSON.parse(new TextDecoder().decode(payload.input)) as InferenceCallback
  runtime.log(
    `Inference callback received: id=${callback.id ?? 'unknown'} status=${callback.status ?? 'unknown'}`,
  )

  // 2) Only act on completed inferences.
  if (callback.status !== 'completed') {
    runtime.log(`Status is not "completed"; skipping on-chain write.`)
    return JSON.stringify({ id: callback.id ?? null, status: callback.status ?? null, action: 'skipped' })
  }

  // 3) Parse the structured health verdict from the (fenced) output JSON.
  const v = parseHealthVerdict(callback.output ?? '')
  const verified = v.verified === true
  const confidence = normalizeConfidence(v.confidence)
  const reason = v.reason ?? ''
  runtime.log(
    `Health verdict: verified=${verified} confidence=${confidence} metric=${v.metric_value ?? 'n/a'} threshold=${v.threshold ?? 'n/a'}`,
  )

  // 4) digest = the TEE inference response digest (fall back to document digest).
  const responseDigest = callback.resources?.[0]?.response_digest
  const documentDigest = callback.resources?.[0]?.digest ?? callback.resource_summaries?.[0]?.digest
  const digestSource = responseDigest ?? documentDigest
  if (!digestSource) {
    throw new Error('callback missing response_digest and document digest; cannot attest')
  }
  const digest = toBytes32(digestSource)

  // 5) Deterministic goalId, shared with HealthVerdict + HealthPools on chain.
  const goalId = computeGoalId(cfg.poolsAddress, cfg.poolId, cfg.user, cfg.periodStart)
  runtime.log(`goalId=${goalId} digest=${digest}`)

  // 6) Facet bitmap for the demo: AI attested (bit2) + wearable (bit0).
  const bitmap = FACET_AI_ATTESTED | FACET_WEARABLE

  // 7) ABI-encode the report body exactly as HealthVerdict.onReport decodes it.
  const encodedReport = encodeAbiParameters(REPORT_ABI, [
    goalId,
    verified,
    CONFIDENCE_TO_U8[confidence],
    digest,
    bitmap,
  ])

  const base: WorkflowResult = {
    id: callback.id ?? null,
    status: callback.status,
    goalId,
    verified,
    confidence,
    reason,
    metricValue: v.metric_value ?? null,
    threshold: v.threshold ?? null,
    digest,
    bitmap,
    receiver: cfg.healthVerdictAddress,
    encodedReport,
    writeMode: 'encoded-only',
  }

  // 8) DON-signed report over the encoded body, then forward to HealthVerdict
  //    via the EVM client (the DON delivers it through the KeystoneForwarder,
  //    which calls onReport). Skipped when the receiver is unset so simulation
  //    still produces the full signed report for inspection.
  const report = runtime
    .report({
      encodedPayload: hexToBase64(encodedReport),
      encoderName: 'evm',
      signingAlgo: 'ecdsa',
      hashingAlgo: 'keccak256',
    })
    .result()

  const receiverUnset = /^0x0{40}$/i.test(cfg.healthVerdictAddress)
  if (receiverUnset) {
    runtime.log('healthVerdictAddress unset; returning encoded-only report (no on-chain write).')
    return JSON.stringify(base)
  }

  const evm = new cre.capabilities.EVMClient(BigInt(cfg.chainSelector))
  const writeResult = evm
    .writeReport(runtime, {
      receiver: hexToBytes(cfg.healthVerdictAddress as Hex),
      report,
      gasConfig: { gasLimit: cfg.writeGasLimit },
    })
    .result()

  runtime.log(`On-chain write: txStatus=${String(writeResult.txStatus ?? 'n/a')}`)
  return JSON.stringify({
    ...base,
    writeMode: 'live',
    txStatus: writeResult.txStatus !== undefined ? String(writeResult.txStatus) : undefined,
  })
}

// ----------------------------------------------------------------- wiring

const initWorkflow = (config: WorkflowConfig) => {
  const http = new cre.capabilities.HTTPCapability()
  const trigger = http.trigger({ authorizedKeys: config.authorizedKeys })
  return [cre.handler(trigger, onInferenceCallback)]
}

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<WorkflowConfig>()
  await runner.run(initWorkflow)
}

main()

// Exported for the deterministic offline dry-run (no CRE runtime needed).
export {
  computeGoalId,
  parseHealthVerdict,
  normalizeConfidence,
  toBytes32,
  CONFIDENCE_TO_U8,
  FACET_AI_ATTESTED,
  FACET_WEARABLE,
  REPORT_ABI,
}
