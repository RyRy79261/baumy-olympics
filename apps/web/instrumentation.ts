import { assertTestModeAllowed } from "@/lib/test-mode";

// Runs once when a Next server starts. next.config.ts makes the same check
// earlier; this one also covers a server started without reading the config.
export function register() {
  assertTestModeAllowed();
}
