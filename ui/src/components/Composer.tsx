import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useEffect, useRef, useState, type RefObject } from "react";

import { glyphs, theme } from "../theme";
import { usePulseColor } from "../hooks/usePulseColor";
import { useMotionFrame } from "../hooks/useMotionFrame";

import type { Status } from "../state";
import type { ChatAttachment } from "../../../shared/attachments";
import type { CommandDescriptor } from "../protocol";
import { Markdown } from "./Markdown";
import { PromptHeader } from "./PromptHeader";
import { useTerminalMouse } from "../hooks/useTerminalMouse";
import { isTerminalControlInput } from "../hooks/isTerminalControlInput";

type Props = {
  status: Status;
  activeTool: string | null;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd_micros: number;
  };
  lastPromptTokens: number | null;
  draftTokensEstimate: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenModelPicker: () => void;
  attachmentTriggerRef: RefObject<DOMElement | null>;
  attachments: ChatAttachment[];
  attachmentMode: boolean;
  attachmentError: string;
  onCancelAttachment: () => void;
  onRemoveAttachment: (index: number) => void;
  confirmation: { name: string; input: string } | null;
  onConfirm: (allowed: boolean) => void;
  question: { question_id: string; prompt: string; choices: string[] } | null;
  onAnswer: (questionId: string, answer: string) => void;
  onCancelQuestion: () => void;
  onCancelRequest: () => void;
  disabled?: boolean;
  commands: CommandDescriptor[];
};

export function Composer({
  status,
  activeTool,
  usage,
  lastPromptTokens,
  draftTokensEstimate,
  value,
  onChange,
  onSubmit,
  onOpenModelPicker,
  attachmentTriggerRef,
  attachments,
  attachmentMode,
  attachmentError,
  onCancelAttachment,
  onRemoveAttachment,
  confirmation,
  onConfirm,
  question,
  onAnswer,
  onCancelQuestion,
  onCancelRequest,
  disabled = false,
  commands,
}: Props) {
  const [cursor, setCursor] = useState(value.length);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const rootElement = useRef<DOMElement>(null);
  const inputElement = useRef<DOMElement>(null);
  const suggestionElements = useRef<Array<DOMElement | null>>([]);
  const approveElement = useRef<DOMElement>(null);
  const rejectElement = useRef<DOMElement>(null);
  const submitElement = useRef<DOMElement>(null);
  const modelElement = useRef<DOMElement>(null);
  const questionChoiceElements = useRef<Array<DOMElement | null>>([]);
  const attachmentElements = useRef<Array<DOMElement | null>>([]);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const lastValue = useRef(value);
  const changeValue = (next: string) => {
    if (next === value) return;
    undoStack.current.push(value);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    lastValue.current = next;
    onChange(next);
  };
  const commandPrefix = value.slice(0, cursor);
  const suggestions =
    !question && commandPrefix.startsWith("/")
      ? commands
          .filter(({ command }) =>
            command.startsWith(commandPrefix.toLowerCase()),
          )
          .map(({ command, description }) => [command, description] as const)
      : [];
  const selectedCommandColor = usePulseColor(
    suggestions.length > 0,
    theme.brand,
    "#B4CFFF",
  );
  const approvalColor = usePulseColor(
    Boolean(confirmation),
    theme.warning,
    "#f0d69b",
  );
  const questionColor = usePulseColor(
    Boolean(question),
    theme.brand,
    "#c0cee2",
  );
  const cursorFrame = useMotionFrame(!disabled, 500);
  const suggestionWindowSize = 7;
  const suggestionStart = Math.max(
    0,
    Math.min(selectedSuggestion - 2, suggestions.length - suggestionWindowSize),
  );
  const visibleSuggestions = suggestions.slice(
    suggestionStart,
    suggestionStart + suggestionWindowSize,
  );

  useTerminalMouse(rootElement, (event, contains) => {
    if (event.action === "wheel" && suggestions.length > 0 && contains(rootElement.current)) {
      setSelectedSuggestion((index) => Math.max(0, Math.min(suggestions.length - 1, index + (event.wheelDirection === "down" ? 1 : -1) * 2)));
      return;
    }
    if (event.action !== "press" || event.button !== 0 || disabled) return;
    if (confirmation && contains(approveElement.current)) {
      onConfirm(true);
      return;
    }
    if (confirmation && contains(rejectElement.current)) {
      onConfirm(false);
      return;
    }
    if (question) {
      const choiceIndex = questionChoiceElements.current.findIndex((element) => contains(element));
      if (choiceIndex >= 0 && question.choices[choiceIndex]) {
        onAnswer(question.question_id, question.choices[choiceIndex]!);
        return;
      }
    }
    const attachmentIndex = attachmentElements.current.findIndex((element) => contains(element));
    if (attachmentIndex >= 0) {
      onRemoveAttachment(attachmentIndex);
      return;
    }
    if (contains(modelElement.current)) {
      onOpenModelPicker();
      return;
    }
    if (contains(submitElement.current)) {
      if (confirmation) return;
      if (question) {
        if (value.trim()) onAnswer(question.question_id, value);
      } else if (status === "thinking" || status === "working" || status === "streaming" || status === "waiting") onCancelRequest();
      else onSubmit();
      return;
    }
    const suggestion = suggestionElements.current.findIndex((element) => contains(element));
    if (suggestion >= 0) {
      const command = suggestions[suggestionStart + suggestion]?.[0];
      if (command) {
        changeValue(`${command} `);
        setCursor(command.length + 1);
      }
      return;
    }
    if (contains(inputElement.current)) setCursor(value.length);
  });

  // Keep the insertion point in sync when the parent clears the prompt after submit.
  useEffect(() => {
    if (value.length === 0) {
      setCursor(0);
      undoStack.current = [];
      redoStack.current = [];
      lastValue.current = "";
    } else if (lastValue.current !== value) {
      setCursor(value.length);
      lastValue.current = value;
    }
  }, [value]);

  useEffect(() => {
    setSelectedSuggestion(0);
  }, [commandPrefix]);

  useInput(
    (input, key) => {
      if (disabled) return;
      if (isTerminalControlInput(input)) return;
      if (attachmentMode && key.escape) {
        onCancelAttachment();
        return;
      }
      if (key.escape || ((key.ctrl || key.meta) && input.toLowerCase() === "c")) {
        if (value.length > 0) {
          changeValue("");
          setCursor(0);
          return;
        }
      }
      if (question) {
        if (
          ((key.ctrl || key.meta) && input.toLowerCase() === "c") ||
          key.escape
        ) {
          onCancelQuestion();
          return;
        }
        if (key.return) {
          if (value.trim()) onAnswer(question.question_id, value);
          return;
        }
      }
      if (
        !confirmation &&
        !question &&
        (status === "thinking" ||
          status === "working" ||
          status === "streaming" ||
          status === "waiting") &&
        (key.escape || ((key.ctrl || key.meta) && input.toLowerCase() === "c"))
      ) {
        onCancelRequest();
        return;
      }
      if (
        (key.ctrl || key.meta) &&
        input.toLowerCase() === "x" &&
        attachments.length > 0
      ) {
        onRemoveAttachment(attachments.length - 1);
        return;
      }
      if (confirmation) {
        if (input.toLowerCase() === "y" || key.return) onConfirm(true);
        else if (input.toLowerCase() === "n" || key.escape) onConfirm(false);
        else if ((key.ctrl || key.meta) && input.toLowerCase() === "c")
          onCancelRequest();
        return;
      }
      if ((key.ctrl || key.meta) && input.toLowerCase() === "z") {
        const source = key.shift ? redoStack : undoStack;
        const destination = key.shift ? undoStack : redoStack;
        const previous = source.current.pop();
        if (previous !== undefined) {
          destination.current.push(value);
          lastValue.current = previous;
          onChange(previous);
          setCursor(previous.length);
        }
        return;
      }
      if (key.ctrl && input.toLowerCase() === "g") {
        onOpenModelPicker();
        return;
      }
      if (key.tab && suggestions.length > 0) {
        const suggestion = suggestions[selectedSuggestion]?.[0];
        if (!suggestion) return;
        const replacementStart = cursor - commandPrefix.length;
        onChange(
          value.slice(0, replacementStart) + suggestion + value.slice(cursor),
        );
        setCursor(replacementStart + suggestion.length);
        setSelectedSuggestion(0);
        return;
      }
      if (key.upArrow && suggestions.length > 0) {
        setSelectedSuggestion(
          (index) => (index + suggestions.length - 1) % suggestions.length,
        );
        return;
      }
      if (key.downArrow && suggestions.length > 0) {
        setSelectedSuggestion((index) => (index + 1) % suggestions.length);
        return;
      }
      if (key.return) {
        if (key.shift) {
          changeValue(value.slice(0, cursor) + "\n" + value.slice(cursor));
          setCursor(cursor + 1);
          return;
        }
        onSubmit();
        return;
      }

      // Most macOS terminals send DEL (\x7f) for the physical Backspace key.
      // Ink exposes that byte as `delete`, while Ctrl+H is `backspace`.
      // Treat both as backward deletion; the forward Delete key is less common
      // and otherwise makes Backspace appear completely broken at end-of-line.
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          changeValue(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor(cursor - 1);
          setSelectedSuggestion(0);
        }
        return;
      }

      if (key.leftArrow) {
        setCursor((position) => Math.max(0, position - 1));
        return;
      }

      if (key.rightArrow) {
        setCursor((position) => Math.min(value.length, position + 1));
        return;
      }

      if (!key.ctrl && !key.meta && (key.upArrow || key.downArrow)) {
        const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
        const column = cursor - lineStart;
        const previousLineEnd = lineStart - 1;
        const nextLineStart = value.indexOf("\n", cursor);
        if (key.upArrow && previousLineEnd >= 0) {
          const previousLineStart =
            value.lastIndexOf("\n", previousLineEnd - 1) + 1;
          setCursor(
            previousLineStart +
              Math.min(column, previousLineEnd - previousLineStart),
          );
        } else if (key.downArrow && nextLineStart >= 0) {
          const nextLineEnd = value.indexOf("\n", nextLineStart + 1);
          const end = nextLineEnd < 0 ? value.length : nextLineEnd;
          setCursor(
            nextLineStart + 1 + Math.min(column, end - nextLineStart - 1),
          );
        }
        return;
      }

      if (key.home) {
        setCursor(0);
        return;
      }

      if (key.end) {
        setCursor(value.length);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        changeValue(value.slice(0, cursor) + input + value.slice(cursor));
        setCursor(cursor + input.length);
        setSelectedSuggestion(0);
      }
    },
    { isActive: !disabled },
  );

  const beforeCursor = value.slice(0, cursor);
  const afterCursor = value.slice(cursor);
  const showMarkdownPreview =
    !attachmentMode &&
    !question &&
    /(?:\*|_|~|`|^#{1,6}(?:\s|$)|^\s*[-*+]\s|^\s*\d+\.\s|^>\s|^\s*```|\[[^\]]+\]\()/m.test(
      value,
    );
  return (
    <Box ref={rootElement} flexDirection="column" width="100%" marginTop={1}>
      <PromptHeader
        status={status}
        activeTool={activeTool}
        usage={usage}
        lastPromptTokens={lastPromptTokens}
        draftTokensEstimate={draftTokensEstimate}
      />
      {suggestions.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.chrome}>Commands · Tab to complete</Text>
          {visibleSuggestions.map(([command, description], index) => {
            const absoluteIndex = suggestionStart + index;
            return (
              <Box key={command} ref={(element) => { suggestionElements.current[index] = element; }}>
              <Text>
                <Text
                  color={
                    absoluteIndex === selectedSuggestion
                      ? selectedCommandColor
                      : theme.brand
                  }
                  bold
                >
                  {absoluteIndex === selectedSuggestion ? "› " : "  "}
                  {command.padEnd(19)}
                </Text>
                <Text color={theme.muted}> {description}</Text>
              </Text>
              </Box>
            );
          })}
          {suggestionStart > 0 ||
          suggestionStart + visibleSuggestions.length < suggestions.length ? (
            <Text color={theme.chrome}>
              {" "}
              {suggestionStart > 0 ? "↑ more" : ""}
              {suggestionStart > 0 &&
              suggestionStart + visibleSuggestions.length < suggestions.length
                ? "  ·  "
                : ""}
              {suggestionStart + visibleSuggestions.length < suggestions.length
                ? "↓ more"
                : ""}
            </Text>
          ) : null}
        </Box>
      ) : null}
      {confirmation ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderLeft
          borderColor={approvalColor}
          paddingLeft={1}
          marginBottom={1}
        >
          <Text color={approvalColor} bold>
            ◆ Approval required · {confirmation.name}
          </Text>
          {confirmation.name !== "apply_changes" &&
          confirmation.name !== "approve_plan" ? (
            <Text>{confirmation.input}</Text>
          ) : null}
          <Text color={theme.muted}>
            {confirmation.name === "apply_changes"
              ? "Review the diff above"
              : confirmation.name === "approve_plan"
                ? "Review the plan above"
                : "Review this action"}{" "}
            · Y approve · N reject
          </Text>
          <Box flexDirection="row" gap={2}>
            <Box ref={approveElement}><Text color={theme.success}>[ Approve ]</Text></Box>
            <Box ref={rejectElement}><Text color={theme.error}>[ Reject ]</Text></Box>
          </Box>
        </Box>
      ) : null}
      {question ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderLeft
          borderColor={theme.brand}
          paddingLeft={1}
          marginBottom={1}
        >
          <Text color={questionColor} bold>
            ◆ Question from Luma
          </Text>
          <Text>{question.prompt}</Text>
          {question.choices.length > 0 ? (
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {question.choices.map((choice, index) => (
                <Box key={`${choice}-${index}`} ref={(element) => { questionChoiceElements.current[index] = element; }}>
                  <Text color={theme.brand}>[ {choice} ]</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          <Text color={theme.muted}>
            Type your answer and press Enter · Esc/Ctrl+C cancel request
          </Text>
        </Box>
      ) : null}
      {attachmentError ? (
        <Text color={theme.error}>{attachmentError}</Text>
      ) : null}

      <Box
        width="100%"
        marginTop={1}
        borderStyle="round"
        borderColor={confirmation ? theme.warning : theme.border}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        <Box ref={inputElement} flexDirection="row" alignItems="center">
          <Box ref={attachmentTriggerRef} marginRight={1}>
            <Text color={theme.chrome}>+</Text>
          </Box>
          {attachmentMode ? (
            <Text color={theme.warning}>Attach file: </Text>
          ) : (
            <Text color={theme.brand} bold>
              {glyphs.input}{" "}
            </Text>
          )}
          <Text>
            {beforeCursor}
            {cursorFrame % 2 === 0 ? (
              <Text color={theme.brand} bold>
                ▏
              </Text>
            ) : (
              <Text> </Text>
            )}
            {afterCursor}
          </Text>
        </Box>
        {showMarkdownPreview ? (
          <Box
            flexDirection="column"
            marginTop={1}
            paddingLeft={2}
            borderLeft
            borderColor={theme.border}
          >
            <Text color={theme.chrome}>Markdown preview</Text>
            <Markdown content={value} />
          </Box>
        ) : null}
        {attachments.length > 0 ? (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {attachments.map((attachment, index) => (
              <Box key={`${attachment.name}-${index}`} ref={(element) => { attachmentElements.current[index] = element; }}>
              <Text color={theme.muted}>
                ▧ {attachment.name} <Text color={theme.chrome}>⌫</Text>
              </Text>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
      <Box
        width="100%"
        marginTop={0}
        flexDirection="row"
        justifyContent="space-between"
        flexWrap="wrap"
      >
        <Text color={theme.chrome}>
          {question
            ? "Enter to answer · Esc to cancel"
            : attachmentMode
              ? "Enter to attach · Esc to cancel"
              : status === "cancelling"
                ? "Cancelling…"
                : status === "thinking" ||
                    status === "working" ||
                    status === "streaming" ||
                    status === "waiting"
                  ? "Esc to stop"
                  : "Enter to send · Shift+Enter newline · Ctrl+Z undo"}
        </Text>
        <Text color={theme.chrome}>
          {"Ctrl+Shift+F search  ·  Ctrl+↑↓ prompts  ·  /copy-code"}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Box ref={modelElement}><Text color={theme.brand}>[ Model ]</Text></Box>
          {!confirmation ? <Box ref={submitElement}>
            <Text color={status === "thinking" || status === "working" || status === "streaming" || status === "waiting" ? theme.warning : theme.success}>
              [ {status === "thinking" || status === "working" || status === "streaming" || status === "waiting" ? "Stop" : question ? "Answer" : attachmentMode ? "Attach" : "Send"} ]
            </Text>
          </Box> : null}
        </Box>
      </Box>
    </Box>
  );
}
