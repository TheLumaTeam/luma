import { Box, Text } from "ink";
import type { DOMElement, Key } from "ink";
import { useState } from "react";

import { theme } from "../theme";

/**
 * Keyboard state for a question's choices. The row after the last choice is the
 * user's own answer, typed into the surrounding input; typing selects it.
 */
export function useQuestionChoices(
  questionId: string | undefined,
  choices: string[],
  typed: string,
) {
  const [picked, setPicked] = useState({ questionId, index: 0 });
  // A new question starts at the top without waiting for an effect.
  const index = picked.questionId === questionId ? picked.index : 0;
  const active = typed.length > 0 ? choices.length : index;

  return {
    active,
    /** The choice Enter would send, if the user has not typed their own. */
    selected: choices[active] as string | undefined,
    /** Handles navigation keys. `answer` is set when a number picks a choice. */
    handleKey(input: string, key: Key): { handled: boolean; answer?: string } {
      if (!choices.length || typed.length > 0) return { handled: false };
      if (key.upArrow || key.downArrow) {
        const rows = choices.length + 1;
        const next = (index + (key.downArrow ? 1 : rows - 1)) % rows;
        setPicked({ questionId, index: next });
        return { handled: true };
      }
      // Numbers type normally once the user's own answer row is selected.
      const number = /^[1-9]$/.test(input) ? Number(input) - 1 : -1;
      if (!key.ctrl && !key.meta && index < choices.length && number >= 0) {
        if (number < choices.length)
          return { handled: true, answer: choices[number] };
        if (number === choices.length) {
          setPicked({ questionId, index: number });
          return { handled: true };
        }
      }
      return { handled: false };
    },
  };
}

type Props = {
  title: string;
  prompt: string;
  choices: string[];
  active: number;
  /** Whether the user has started typing their own answer. */
  typing: boolean;
  hint: string;
  accent?: string;
  choiceRef?: (index: number, element: DOMElement | null) => void;
};

export function QuestionPrompt({
  title,
  prompt,
  choices,
  active,
  typing,
  hint,
  accent,
  choiceRef,
}: Props) {
  const color = accent ?? theme.brand;
  const rows = choices.length
    ? [...choices, typing ? "Your own answer ↓" : "Something else… (type your own)"]
    : [];
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.border}
      paddingX={1}
      marginBottom={1}
    >
      <Text color={color} bold>
        ◆ {title}
      </Text>
      <Box marginTop={1}>
        <Text color={theme.text} bold>
          {prompt}
        </Text>
      </Box>
      {rows.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {rows.map((row, index) => {
            const isActive = index === active;
            const isOwn = index === choices.length;
            return (
              <Box
                key={`${index}-${row}`}
                ref={(element) => choiceRef?.(index, element)}
                flexDirection="row"
              >
                <Box flexShrink={0}>
                  <Text color={isActive ? color : theme.chrome} bold={isActive}>
                    {isActive ? "› " : "  "}
                    {index < 9 ? `${index + 1}  ` : "   "}
                  </Text>
                </Box>
                <Text
                  color={isActive ? color : isOwn ? theme.muted : theme.secondary}
                  bold={isActive}
                >
                  {row}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={theme.chrome}>{hint}</Text>
      </Box>
    </Box>
  );
}
