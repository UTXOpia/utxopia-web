#!/usr/bin/env bun
/**
 * Hash every JoinSplit `.wasm` / `.zkey` into `src/lib/prover/circuit-manifest.json`.
 *
 * The prover streams these from a CDN and hands the `.wasm` — the witness generator — every
 * private input a JoinSplit has: spending key, nullifying key, note randomness, amounts, the
 * whole Merkle path. Nothing about that fetch is authenticated (SRI does not apply to `fetch`),
 * and the artifacts ship `immutable, max-age=31536000`, so a swapped file survives in browser
 * and edge caches for a year after the origin is cleaned. A proof built from a poisoned witness
 * generator still verifies, so there is no failure for a user to notice.
 *
 * The manifest is committed and imported by the bundle, which is what makes it a check the
 * server cannot talk the client out of.
 *
 * IMPORTANT: the manifest must cover every shape the origin the app points at can serve, not just
 * the ones checked into `public/`. Verification fails closed, so a shape present on the CDN but
 * missing from the manifest is a user who cannot spend. Before deploying against
 * `NEXT_PUBLIC_CIRCUIT_CDN_URL`, regenerate with `--url <that origin>`.
 *
 * Usage:
 *   bun run scripts/gen-circuit-manifest.ts                  # hash ./public/circuits/groth16
 *   bun run scripts/gen-circuit-manifest.ts --dir <path>
 *   bun run scripts/gen-circuit-manifest.ts --url https://circuit.utxopia.com/circuits/v2/groth16
 *   bun run scripts/gen-circuit-manifest.ts --check          # exit 1 if the manifest is stale
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src/lib/prover/circuit-manifest.json");
const DEFAULT_DIR = path.join(ROOT, "public/circuits/groth16");

const arg = (name: string) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Same layout `getJoinSplitArtifactUrls` builds, relative to the circuit root. */
const relPaths = (name: string) => [
  `${name}/${name}_js/${name}.wasm`,
  `${name}/${name}.zkey`,
];

/**
 * Selective-disclosure circuits. `/verify-proof` fetches only their `.vkey.json` — it verifies,
 * it does not prove, so no secret is at stake — but a swapped verifying key makes that page
 * report "valid" for a proof that is not, which is the whole point of the page.
 */
const AUX_CIRCUITS = ["ownership", "range_sum", "range_sum_4", "range_sum_16"];
const auxRelPaths = (name: string) => [`${name}/${name}.vkey.json`];

function shapesFrom(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((d) => /^joinsplit_\d+x\d+$/.test(d))
    .sort();
}

async function main() {
  const url = arg("--url");
  const dir = path.resolve(arg("--dir") ?? DEFAULT_DIR);

  let names: string[];
  let read: (rel: string) => Promise<Uint8Array | null>;

  if (url) {
    const base = url.replace(/\/+$/, "");
    // No listing endpoint on the CDN — enumerate the shapes the program accepts (N+M <= 10).
    names = [];
    for (let n = 1; n <= 9; n++) {
      for (let m = 1; n + m <= 10; m++) names.push(`joinsplit_${n}x${m}`);
    }
    read = async (rel) => {
      const res = await fetch(`${base}/${rel}`);
      if (!res.ok) return null;
      return new Uint8Array(await res.arrayBuffer());
    };
  } else {
    if (!fs.existsSync(dir)) throw new Error(`no circuit directory at ${dir}`);
    names = shapesFrom(dir);
    read = async (rel) => {
      const p = path.join(dir, rel);
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
    };
  }

  const digests: Record<string, string> = {};
  let missing = 0;
  const targets = [
    ...names.flatMap(relPaths),
    ...AUX_CIRCUITS.flatMap(auxRelPaths),
  ];
  for (const rel of targets) {
    const bytes = await read(rel);
    if (!bytes) {
      missing++;
      continue;
    }
    digests[rel] = sha256(bytes);
  }

  const entries = Object.keys(digests).length;
  if (entries === 0) throw new Error("hashed nothing — wrong --dir/--url?");

  const manifest = {
    $comment:
      "SHA-256 of each circuit artifact, verified in the browser before proving. Regenerate with scripts/gen-circuit-manifest.ts whenever circuits are rebuilt.",
    algorithm: "SHA-256",
    source: url ?? path.relative(ROOT, dir),
    artifacts: Object.fromEntries(Object.entries(digests).sort(([a], [b]) => a.localeCompare(b))),
  };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    // Subset check, not a byte-compare: the manifest is generated from the CDN (all 45 shapes)
    // while a dev checkout only holds a handful, so demanding identical files would fail for
    // everyone locally. What matters is that nothing the source serves is unaccounted for, and
    // that nothing it serves disagrees with what shipped.
    if (!fs.existsSync(OUT)) {
      console.error("no circuit manifest — run without --check to create it");
      process.exit(1);
    }
    const recorded = JSON.parse(fs.readFileSync(OUT, "utf-8")).artifacts as Record<string, string>;
    const problems: string[] = [];
    for (const [rel, digest] of Object.entries(digests)) {
      if (!recorded[rel]) problems.push(`missing from manifest: ${rel}`);
      else if (recorded[rel] !== digest) problems.push(`digest changed: ${rel}`);
    }
    if (problems.length) {
      console.error(`circuit manifest is stale — re-run ${path.relative(ROOT, __filename)}`);
      for (const p of problems.slice(0, 10)) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(`manifest covers all ${entries} artifacts in ${manifest.source}`);
    return;
  }

  fs.writeFileSync(OUT, serialized);
  console.log(`wrote ${path.relative(ROOT, OUT)} — ${entries} artifacts, ${missing} missing`);
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
