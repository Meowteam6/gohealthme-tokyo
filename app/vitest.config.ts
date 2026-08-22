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
    env: { DATA_DIR: path.resolve(__dirname, ".data") },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
