import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ONQOLTrainer from "./ONQOLTrainer.jsx";

export function V1App() {
  return (
    <>
      <div className="v1-warning" role="note">
        Закрытый тест V1 · разговорный прототип · не для клинической оценки
      </div>
      <ONQOLTrainer />
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <V1App />
  </StrictMode>,
);
