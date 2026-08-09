import { useState } from "react";
import ONQOLTrainer from "./ONQOLTrainer";
import V2Trainer from "./V2Trainer";
import V25Trainer from "./V25Trainer";
import V35Preview from "./V35Preview";

/**
 * V3 is the product. The mentor is not an option inside it - it is what makes
 * it V3. The older generations stay reachable for comparison and regression:
 *
 *   ?version=1     V1  conversational, model as the source of truth
 *   ?version=2     V2  data as the source of truth, semantic router
 *   ?version=2.5   V2.5 same engine as V3 but with the mentor off
 *   ?review        faculty review harness: read the corpus, do not play it
 *   (default)      V3  core library + mentor channel
 */
function initialVersion() {
  const params = new URLSearchParams(window.location.search);
  // Not a version of the trainer - a reading tool. Kept on its own flag so it
  // can never be mistaken for a mode a learner is put into.
  if (params.has("review")) return "review";
  const requested = params.get("version");
  if (requested === "1") return "v1";
  if (requested === "2") return "v2";
  if (requested === "2.5") return "v25";
  return "v3";
}

const SWITCH_STYLE = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 10,
  border: "1px solid rgba(22,105,122,0.25)",
  background: "#fff",
  color: "#16697A",
  borderRadius: 4,
  padding: "9px 12px",
  fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
  fontSize: 12,
  cursor: "pointer",
};

export default function App() {
  const [version, setVersion] = useState(initialVersion);

  if (version === "review") {
    return <V35Preview />;
  }

  if (version === "v1") {
    return (
      <div>
        <button style={SWITCH_STYLE} onClick={() => setVersion("v3")}>
          Вернуться в V3
        </button>
        <ONQOLTrainer />
      </div>
    );
  }

  if (version === "v2") {
    return <V2Trainer onOpenV1={() => setVersion("v1")} />;
  }

  // V2.5: the same component with the mentor off, for side-by-side comparison.
  if (version === "v25") {
    return (
      <div>
        <button style={SWITCH_STYLE} onClick={() => setVersion("v3")}>
          Вернуться в V3
        </button>
        <V25Trainer mentor={false} />
      </div>
    );
  }

  return <V25Trainer mentor />;
}
