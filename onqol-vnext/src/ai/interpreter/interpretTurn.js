import { interpretDeterministically } from "./deterministicInterpreter.js";

/**
 * Public interpreter entrypoint. During Wave 2 this remains the only
 * authoritative interpretation and is fully deterministic. Model-backed
 * interpretation is started separately by the session orchestrator and has
 * telemetry-only authority.
 */
export function interpretTurn(input) {
  const result = interpretDeterministically(input);
  // Wave §17: the session record must say which interpreter actually ran each
  // turn. Until the hybrid semantic path is wired, every turn is deterministic.
  return { mode: "deterministic", ...result };
}

export { interpretDeterministically };
