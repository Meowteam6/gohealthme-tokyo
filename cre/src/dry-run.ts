/**
 * Standalone offline dry-run for wf-goal-verification (callback architecture).
 *
 * The real `cre workflow simulate` runs the workflow inside the CRE WASM host,
 * which supplies the HTTP trigger and the DON report signer. This harness
 * reproduces the DETERMINISTIC core of the callback handler (parse the Attester
 * callback, extract the health verdict, derive the digest, compute goalId, and
 * ABI-encode the exact HealthVerdict.onReport report body) using only viem, so
 * the pipeline can be verified in plain Node without the CRE CLI / DON.
 *
 * What it canNOT do (needs the CRE host): produce a real DON-signed Report or
 * perform the on-chain writeReport. Those are covered by `cre workflow simulate`
 * and, for a live write, the Chainlink booth (see README).
 *
 * Run: npx tsx src/dry-run.ts [path/to/callback-payload.json]
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem'

type Confidence = 'low' | 'medium' | 'high'
const CONFIDENCE_TO_U8: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
const FACET_WEARABLE = 1 << 0
const FACET_AI_ATTESTED = 1 << 2

// Report body ABI — must match HealthVerdict.onReport's abi.decode.
const REPORT_ABI = [
  { name: 'goalId', type: 'bytes32' },
  { name: 'verified', type: 'bool' },
  { name: 'confidence', type: 'uint8' },
  { name: 'digest', type: 'bytes32' },
  { name: 'bitmap', type: 'uint16' },
] as const

interface InferenceCallback {
  id?: string
  status?: string
  output?: string
  resources?: { digest?: string; response_digest?: string }[]
  resource_summaries?: { digest?: string }[]
}

interface HealthVerdictJson {
  verified?: boolean
  confidence?: string
  reason?: string
  metric_value?: number
  threshold?: number
}

const parseHealthVerdict = (output: string): HealthVerdictJson => {
  const fenced = output.trim().match(/^```(?:[a-zA-Z0-9]+)?\s*([\s\S]*?)\s*```$/)
  return JSON.parse(fenced ? fenced[1].trim() : output) as HealthVerdictJson
}

const normalizeConfidence = (c: unknown): Confidence =>
  c === 'high' || c === 'medium' ? c : 'low'

const toBytes32 = (hex: string): Hex => {
  const h = hex.replace(/^0[xX]/, '')
  if (h.length !== 64) throw new Error(`expected a 32-byte hex digest, got "${hex}"`)
  return `0x${h.toLowerCase()}` as Hex
}

/**
 * Must match HealthVerdict.computeGoalId / HealthPools.computeGoalId:
 *   keccak256(abi.encode(address pools, uint256 poolId,
 *                        address participant, uint64 periodStart))
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const payloadPath =
  process.argv[2] ?? resolve(__dirname, '../simulation/callback-payload.json')
const configPath = resolve(__dirname, '../wf-goal-verification/config.json')

const callback = JSON.parse(readFileSync(payloadPath, 'utf8')) as InferenceCallback
const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
  poolsAddress: Address
  poolId: number
  user: Address
  periodStart: number
}

if (callback.status !== 'completed') {
  console.log(JSON.stringify({ id: callback.id ?? null, status: callback.status ?? null, action: 'skipped' }, null, 2))
  process.exit(0)
}

const v = parseHealthVerdict(callback.output ?? '')
const verified = v.verified === true
const confidence = normalizeConfidence(v.confidence)
const digestSource =
  callback.resources?.[0]?.response_digest ??
  callback.resources?.[0]?.digest ??
  callback.resource_summaries?.[0]?.digest
if (!digestSource) throw new Error('callback missing response_digest and document digest')
const digest = toBytes32(digestSource)
const goalId = computeGoalId(
  config.poolsAddress,
  config.poolId,
  config.user,
  config.periodStart,
)
const bitmap = FACET_AI_ATTESTED | FACET_WEARABLE

const encodedReport = encodeAbiParameters(REPORT_ABI, [
  goalId,
  verified,
  CONFIDENCE_TO_U8[confidence],
  digest,
  bitmap,
])

const out = {
  workflow: 'wf-goal-verification',
  mode: 'dry-run (deterministic callback core, no DON signature / no on-chain write)',
  callbackId: callback.id ?? null,
  status: callback.status,
  goalId,
  verdict: { verified, confidence, reason: v.reason ?? '', metricValue: v.metric_value ?? null, threshold: v.threshold ?? null },
  confidenceU8: CONFIDENCE_TO_U8[confidence],
  digest,
  bitmap,
  bitmapBits: { wearable: Boolean(bitmap & FACET_WEARABLE), aiAttested: Boolean(bitmap & FACET_AI_ATTESTED) },
  receiverCall: 'HealthVerdict.onReport(bytes metadata, bytes report)',
  reportBodyAbi: '(bytes32 goalId, bool verified, uint8 confidence, bytes32 digest, uint16 bitmap)',
  encodedReport,
  note: 'In the CRE host this encodedReport is wrapped by runtime.report(...) into a DON-signed report, then EVMClient.writeReport forwards it through the KeystoneForwarder to HealthVerdict.onReport on Arc.',
}

// eslint-disable-next-line no-console
console.log(JSON.stringify(out, null, 2))
