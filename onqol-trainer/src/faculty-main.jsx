import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import V35Preview from "./V35Preview.jsx";
import "./index.css";

const enabled = import.meta.env.VITE_ONQOL_INTERNAL_FULL_TEST === "confirmed";
const content = enabled ? (
  <V35Preview />
) : (
    <main style={{ maxWidth: 720, margin: "80px auto", padding: 24, fontFamily: "sans-serif" }}>
      <h1>Внутренний просмотр отключён</h1>
      <p>Эта сборка не создана с профилем полного внутреннего теста.</p>
    </main>
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {content}
  </StrictMode>
);
