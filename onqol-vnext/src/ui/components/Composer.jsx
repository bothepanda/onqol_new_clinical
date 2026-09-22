import { useState } from "react";
import { t } from "../i18n/strings.js";

export function Composer({ locale, disabled, onSubmit, mentorEnabled = false }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
    setValue("");
  };

  return (
    <div className="onqol-composer-area">
      <div className="onqol-composer">
        <textarea
          value={value}
          placeholder={mentorEnabled ? "Действие, вопрос или рассуждение…" : t(locale, "composer.placeholder")}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" onClick={submit} disabled={disabled || !value.trim()} aria-label={t(locale, "composer.send")}>
          ↑
        </button>
      </div>
    </div>
  );
}
