/**
 * call-attester.mjs — POST a GoHealthMe health summary to the Chainlink
 * Confidential AI Attester with a cre_callback URL.
 *
 * This is the app-side step of the callback architecture (the equivalent of the
 * `curl` block in the official Chainlink demo's README, scripted). It uploads a
 * SYNTHETIC health summary; the Attester runs inference inside its TEE and POSTs
 * the verdict back to cre_callback — which is the locally-running
 * `cre workflow simulate` HTTP-trigger endpoint (see cre/README.md scenario 2).
 *
 * Reimplemented for health goals from the official MIT-licensed Chainlink demo:
 *   https://github.com/smartcontractkit/chainlink-confidential-ai-attester-demo
 *
 * Usage:
 *   # load env (CONFIDENTIAL_AI_API_KEY) from the repo root first
 *   set -a; source ../.env; set +a
 *   node cre/scripts/call-attester.mjs "https://<ngrok-id>.ngrok-free.dev/trigger"
 *
 * Env:
 *   CONFIDENTIAL_AI_API_KEY  (required)  Bearer token for the Attester
 *   ATTESTER_BASE_URL        (optional)  default https://confidential-ai-dev-preview.cldev.cloud
 *
 * Args:
 *   argv[2]  cre_callback URL (the ngrok tunnel to the local trigger + /trigger)
 *   argv[3]  path to the health doc (default simulation/health-summary.txt)
 *
 * NOTE: this script makes a LIVE network call to the Attester and needs a public
 * callback URL. The offline path (no network) is `cre workflow simulate ...
 * --http-payload ./simulation/callback-payload.json`, which replays a recorded
 * callback — use that for a credential-free, deterministic demo.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const apiKey = process.env.CONFIDENTIAL_AI_API_KEY
if (!apiKey) {
  console.error('CONFIDENTIAL_AI_API_KEY is not set. Run: set -a; source ../.env; set +a')
  process.exit(1)
}

const baseUrl =
  process.env.ATTESTER_BASE_URL ?? 'https://confidential-ai-dev-preview.cldev.cloud'

const callbackUrl = process.argv[2]
if (!callbackUrl) {
  console.error(
    'Usage: node cre/scripts/call-attester.mjs <cre_callback_url> [health_doc_path]\n' +
      '  e.g. node cre/scripts/call-attester.mjs https://abc123.ngrok-free.dev/trigger',
  )
  process.exit(1)
}

const docPath = process.argv[3] ?? resolve(__dirname, '../simulation/health-summary.txt')
const docBytes = readFileSync(docPath)
const contentBase64 = docBytes.toString('base64')

const promptPath = resolve(__dirname, '../simulation/inference-prompt.txt')
// The prompt file has a header; the actual prompt is everything after the rule line.
const promptFile = readFileSync(promptPath, 'utf8')
const prompt = promptFile.split(/^-{10,}\s*$/m).pop().trim()

const systemPrompt =
  'You are a clinical health-goal reviewer. Analyze the provided health summary and ' +
  'answer based strictly on its content. Always respond with a valid JSON object and nothing else.'

const body = {
  model: 'gemma4',
  system_prompt: systemPrompt,
  prompt,
  resources: [
    {
      filename: basename(docPath),
      content_type: 'text/plain',
      content_base64: contentBase64,
    },
  ],
  cre_callback: { url: callbackUrl },
}

console.log(`POST ${baseUrl}/v1/inference`)
console.log(`  doc          = ${docPath} (${docBytes.length} bytes)`)
console.log(`  cre_callback = ${callbackUrl}`)

const res = await fetch(`${baseUrl}/v1/inference`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
})

const text = await res.text()
let parsed
try {
  parsed = JSON.parse(text)
} catch {
  parsed = text
}

console.log(`\nHTTP ${res.status}`)
console.log(typeof parsed === 'string' ? parsed : JSON.stringify({ id: parsed.id, status: parsed.status }, null, 2))
console.log(
  '\nThe Attester now runs inference in its TEE and POSTs the verdict to your\n' +
    'cre_callback URL. Watch the `cre workflow simulate` terminal for the on-chain write.',
)
