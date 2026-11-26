import { useId, useRef, useState } from "react";
import "./QuestionPrompt.css";

type Props = {
  /** Who is asking, e.g. "Luma needs your input". */
  title: string;
  prompt: string;
  choices: string[];
  onAnswer: (answer: string) => void;
  busy?: boolean;
  /** Take keyboard focus when the question appears. */
  autoFocus?: boolean;
};

/**
 * A question from the model: its suggested answers as a list, and always a way
 * to answer in your own words. Render with a `key` per question.
 */
export function QuestionPrompt({ title, prompt, choices, onAnswer, busy = false, autoFocus = false }: Props) {
  const [answer, setAnswer] = useState("");
  const [focused, setFocused] = useState(0);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const input = useRef<HTMLInputElement>(null);
  const promptId = useId();

  const submit = (value: string) => {
    if (!busy && value.trim()) onAnswer(value.trim());
  };

  const handleOptionKeys = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      event.preventDefault();
      input.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = focused + (event.key === "ArrowDown" ? 1 : -1);
      if (next >= choices.length) input.current?.focus();
      else options.current[Math.max(0, next)]?.focus();
    } else if (/^[1-9]$/.test(event.key) && Number(event.key) <= choices.length) {
      event.preventDefault();
      submit(choices[Number(event.key) - 1]);
    }
  };

  return <section className="luma-question" aria-labelledby={promptId}>
    <p className="luma-question-title">{title}</p>
    <p className="luma-question-prompt" id={promptId}>{prompt}</p>
    {choices.length > 0 && <div className="luma-question-options" role="group" aria-label="Suggested answers" onKeyDown={handleOptionKeys}>
      {choices.map((choice, index) => <button key={`${index}-${choice}`} ref={(element) => { options.current[index] = element; }} type="button" className="luma-question-option" autoFocus={autoFocus && index === 0} tabIndex={index === focused ? 0 : -1} disabled={busy} onFocus={() => setFocused(index)} onClick={() => submit(choice)}>
        <span className="luma-question-key" aria-hidden="true">{index < 9 ? index + 1 : "·"}</span>
        <span className="luma-question-choice">{choice}</span>
        <span className="luma-question-enter" aria-hidden="true">↵</span>
      </button>)}
    </div>}
    <form className="luma-question-own" onSubmit={(event) => { event.preventDefault(); submit(answer); }}>
      <span className="luma-question-key" aria-hidden="true">✎</span>
      <input ref={input} autoFocus={autoFocus && choices.length === 0} value={answer} maxLength={8000} aria-label="Your own answer" placeholder={choices.length > 0 ? "Something else? Type your own answer" : "Type your answer"} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => {
        if (event.key === "ArrowUp" && !answer && choices.length > 0) {
          event.preventDefault();
          options.current[choices.length - 1]?.focus();
        }
      }} />
      <button type="submit" className="luma-question-send" disabled={busy || !answer.trim()}>Send</button>
    </form>
  </section>;
}
