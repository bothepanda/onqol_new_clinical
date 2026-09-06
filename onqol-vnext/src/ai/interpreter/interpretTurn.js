import { interpretDeterministically } from "./deterministicInterpreter.js";

/**
 * Public interpreter entrypoint. During Wave 2 this remains the only
 * authoritative interpretation and is fully deterministic. Model-backed
 * interpretation is started separately by the session orchestrator and has
 * telemetry-only authority.
 */
export function interpretTurn(input) {
  return interpretDeterministically(input);
}

export { interpretDeterministically };
