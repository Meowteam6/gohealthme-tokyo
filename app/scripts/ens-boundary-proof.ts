// Prove SPOTTER's ENS permission boundary against live Sepolia with eth_call.
//
// Run from app/:  npm run ens:proof
//
// Needs no private key. The agent is whoever spotter.<parent> resolves to
// (addr(60)); the owner is whoever owns <parent> in the ETHRegistry. Each row
// simulates one call from that address against GoHealthMe's own registry and
// Permissioned Resolver (both discovered from the ETHRegistry). An allowed row
// is a call the contract accepts; a denied row is a real revert
// (EACUnauthorizedAccountRoles from Enhanced Access Control).
//
// Exit code is 0 only when the boundary holds: the agent can write the receipt
// key and nothing else, and a stranger cannot write it.

import { agentName, firstLabel } from "@/lib/ens/names";
import { discoverNamespace, ensParentName, ensPublicClient } from "@/lib/server/ens/client";
import { ENS_SEPOLIA, REGISTRY_ABI } from "@/lib/server/ens/deployments";
import { liveResolveDeps, permissionMatrix, resolveAddress } from "@/lib/server/ens/resolve";

async function main(): Promise<void> {
  const client = ensPublicClient();
  const parent = ensParentName();
  const ns = await discoverNamespace(client);
  if (ns === null) {
    console.error(`${parent} is not bootstrapped on Sepolia yet (ETHRegistry has no subregistry). Run npm run ens:bootstrap first.`);
    process.exit(2);
  }
  const agent = await resolveAddress(agentName(parent));
  const owner = await client.readContract({
    address: ENS_SEPOLIA.ethRegistry,
    abi: REGISTRY_ABI,
    functionName: "findOwner",
    args: [firstLabel(parent)],
  });
  console.log(`parent   ${parent}`);
  console.log(`registry ${ns.registry}`);
  console.log(`resolver ${ns.resolver}`);
  console.log(`agent    ${agent ?? "(spotter has no addr(60))"}  (resolved from ${agentName(parent)})`);
  console.log(`owner    ${owner}`);
  console.log("");

  const rows = await permissionMatrix(liveResolveDeps(), { agent, owner });
  for (const r of rows) {
    console.log(`${r.allowed ? "ALLOWED" : "DENIED "}  ${r.actor.padEnd(8)} ${r.action}${r.detail ? `  [${r.detail}]` : ""}`);
  }

  const agentRows = rows.filter((r) => r.actor === "agent");
  const holds =
    agent !== null &&
    agentRows.length > 1 &&
    agentRows[0].allowed &&
    agentRows.slice(1).every((r) => !r.allowed) &&
    rows.filter((r) => r.actor === "stranger").every((r) => !r.allowed);
  console.log("");
  console.log(holds ? "BOUNDARY HOLDS: the agent writes receipts and nothing else." : "BOUNDARY NOT PROVEN (see rows above).");
  process.exit(holds ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
