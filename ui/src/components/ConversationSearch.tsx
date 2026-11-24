import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useMemo, useRef, useState } from "react";

import type { Message } from "../state";
import { theme } from "../theme";
import { useTerminalMouse } from "../hooks/useTerminalMouse";

export function ConversationSearch({
  messages,
  onSelect,
  onClose,
}: {
  messages: Message[];
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const rootElement = useRef<DOMElement>(null);
  const resultElements = useRef<Array<DOMElement | null>>([]);
  const closeElement = useRef<DOMElement>(null);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return messages.flatMap((message, index) =>
      message.role === "system"
        ? []
        : message.content.toLocaleLowerCase().includes(needle)
          ? [{ message, index }]
          : [],
    );
  }, [messages, query]);

  const start = Math.max(0, Math.min(selected - 3, results.length - 7));
  useTerminalMouse(rootElement, (event, contains) => {
    if (event.action === "wheel" && contains(rootElement.current)) {
      setSelected((value) => Math.max(0, Math.min(results.length - 1, value + (event.wheelDirection === "down" ? 1 : -1) * 3)));
      return;
    }
    if (event.action !== "press" || event.button !== 0) return;
    if (contains(closeElement.current)) { onClose(); return; }
    const row = resultElements.current.findIndex((element) => contains(element));
    if (row >= 0) {
      const result = results[start + row];
      setSelected(start + row);
      if (result) onSelect(result.index);
    }
  });

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelected((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((value) => Math.min(results.length - 1, value + 1));
      return;
    }
    if (key.return) {
      const result = results[selected];
      if (result) onSelect(result.index);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      setSelected(0);
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setQuery((value) => value + input);
      setSelected(0);
    }
  });

  return (
    <Box
      ref={rootElement}
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.brand}
      paddingX={1}
      paddingY={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={theme.text}>
          Search conversation
        </Text>
        <Box ref={closeElement}><Text color={theme.chrome}>[ × close ]</Text></Box>
      </Box>
      <Text color={theme.brand}>
        ⌕ {query || "Search messages and tool output…"}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {results
          .slice(start, start + 7)
          .map((result, index) => {
            const absolute =
              Math.max(0, Math.min(selected - 3, results.length - 7)) + index;
            const preview = result.message.content.replace(/\s+/g, " ").trim();
            return (
              <Box key={result.message.id} ref={(element) => { resultElements.current[index] = element; }}>
              <Text
                color={absolute === selected ? theme.brand : theme.text}
                bold={absolute === selected}
              >
                {absolute === selected ? "› " : "  "}
                {result.message.role.padEnd(9)}
                {preview.slice(0, 100)}
                {preview.length > 100 ? "…" : ""}
              </Text>
              </Box>
            );
          })}
        {query.trim() && results.length === 0 ? (
          <Text color={theme.muted}>No matching messages.</Text>
        ) : null}
        {results.length > 0 ? (
          <Text color={theme.chrome}>
            {results.length} result{results.length === 1 ? "" : "s"} ·{" "}
            {selected + 1} selected
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
