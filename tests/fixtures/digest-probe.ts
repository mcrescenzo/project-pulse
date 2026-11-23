// Test-only fixture: bundled by `bun run build` to tests-build/digest-probe.mjs and executed by
// the test runtime with a fixture-local PATH shim, so the exact git argv a digest run produces
// can be recorded by the shim (the child reports the mapped error, or "resolved", on stdout).
import { buildDigest } from "../../src/digest";

const [rootDir, since] = process.argv.slice(2);
try {
  buildDigest(rootDir!, { since });
  process.stdout.write("resolved");
} catch (error) {
  process.stdout.write((error as Error).message);
}
