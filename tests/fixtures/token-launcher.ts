// Test-only fixture: bundled by `bun run build` to tests-build/token-launcher.mjs and executed by
// the test runtime. Simulates a simultaneous `pp view` launch racing for the persisted token.
import { loadOrCreateAccessToken } from "../../src/http-security";

process.stdout.write(loadOrCreateAccessToken(process.argv[2]!));
