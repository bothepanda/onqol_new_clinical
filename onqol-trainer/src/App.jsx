import { useState } from "react";
import ONQOLTrainer from "./ONQOLTrainer";
import V2Trainer from "./V2Trainer";
import V25Trainer from "./V25Trainer";

function initialVersion() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("version") === "2.5" || window.location.port === "5174") return "v25";
  return "v2";
}

export default function App() {
  const [version, setVersion] = useState(initialVersion);

  if (version === "v1") {
    return (
      <div>
        <button
          onClick={() => setVersion("v2")}
          style={{
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
          }}
        >
          Вернуться в V2
        </button>
        <ONQOLTrainer />
      </div>
    );
  }

  if (version === "v25") {
    return <V25Trainer onOpenV2={() => setVersion("v2")} />;
  }

  return <V2Trainer onOpenV1={() => setVersion("v1")} />;
}
