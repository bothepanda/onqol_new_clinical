import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";

// Single Node process only. Multiple replicas require a transactional shared store.
export function fileBudgetStore(file) {
  return {
    load() {
      if (!existsSync(file)) return { sessions: {}, pilotReservedUsd: 0 };
      const state = JSON.parse(readFileSync(file, "utf8"));
      if (!state.sessions || typeof state.sessions !== "object" || !Number.isFinite(state.pilotReservedUsd) || state.pilotReservedUsd < 0) throw new Error("budget_ledger_invalid");
      for (const entry of Object.values(state.sessions)) {
        if (!Number.isInteger(entry.calls) || entry.calls < 0 || !Number.isFinite(entry.reservedUsd) || entry.reservedUsd < 0) throw new Error("budget_ledger_invalid");
      }
      return state;
    },
    save(state) {
      writeFileSync(`${file}.tmp`, JSON.stringify(state), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    },
  };
}
