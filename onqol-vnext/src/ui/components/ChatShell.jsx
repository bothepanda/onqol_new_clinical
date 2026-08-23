import { useEffect, useRef } from "react";

/**
 * The transcript (task brief §23.4): learner turns, environment/patient
 * responses, and mentor interjections, visually distinct from each other.
 * No internal planning text (turn planner state, router output, rule ids,
 * phase names) is ever passed into `messages` - the caller (`App.jsx`) is
 * responsible for only forwarding rendered, learner-facing text here.
 */
export function ChatShell({ messages }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  return (
    <div className="onqol-messages">
      {messages.map((message) => (
        <div key={message.id} className={`onqol-message ${messageClass(message.role)}`}>
          {message.speakerRu && <span className="onqol-message-speaker">{message.speakerRu}</span>}
          {message.textRu}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function messageClass(role) {
  if (role === "learner") return "onqol-message-learner";
  if (role === "mentor") return "onqol-message-mentor";
  return "onqol-message-env";
}
