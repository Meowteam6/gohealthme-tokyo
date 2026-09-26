import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts"],
    // File-based tests share .data/ JSON files — run serially to avoid races.
    fileParallelism: false,
    // Pin the JSON store to a local .data dir during tests. The store defaults
    // to os.tmpdir(), where leftover state leaks across runs; tests reset
    // <cwd>/.data, so DATA_DIR must point there for resets to take effect.
    // MISS_RULE_FROM_POOL_ID=1 puts every fixture pool past the miss-rule
    // cutoff (lib/miss-rule.ts); tests of the cutoff itself stub it.
    env: { DATA_DIR: path.resolve(__dirname, ".data"), MISS_RULE_FROM_POOL_ID: "1" },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
