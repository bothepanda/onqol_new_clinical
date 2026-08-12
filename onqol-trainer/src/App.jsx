import V25Trainer from "./V25Trainer";

/**
 * Learner-facing North Star entry point.
 *
 * Legacy prototypes deliberately live in their own independently built app.
 * Do not add query-string switches or imports from `legacy-v1` here: the main
 * product must keep structured clinical data as its source of truth.
 */
export default function App() {
  return <V25Trainer mentor />;
}
