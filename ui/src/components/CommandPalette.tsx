import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useMemo, useRef, useState } from "react";

import type { CommandDescriptor } from "../protocol";
import { theme } from "../theme";
import { useTerminalMouse } from "../hooks/useTerminalMouse";

function fuzzyScore(value: string, query: string): number | null {
  const candidate = value.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  if (candidate === needle) return 1_000;
  if (candidate.startsWith(needle))
    return 800 - (candidate.length - needle.length);
  const substring = candidate.indexOf(needle);
  if (substring >= 0) return 500 - substring;
  let cursor = 0;
  let previous = -2;
  let score = 0;
  for (const character of needle) {
    const index = candidate.indexOf(character, cursor);
    if (index < 0) return null;
    score += index === previous + 1 ? 12 : Math.max(1, 8 - (index - cursor));
    if (index === 0 || /[^a-z0-9]/.test(candidate[index - 1] ?? "")) score += 8;
    previous = index;
    cursor = index + 1;
  }
  return score;
}

export function CommandPalette({
  commands,
  onSelect,
  onClose,
}: {
  commands: CommandDescriptor[];
  onSelect: (command: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const rootElement = useRef<DOMElement>(null);
  const entryElements = useRef<Array<DOMElement | null>>([]);
  const closeElement = useRef<DOMElement>(null);
  const filtered = useMemo(
    () =>
      commands
        .map((item) => ({
          item,
          score: Math.max(
            fuzzyScore(item.command, query) ?? -1,
            fuzzyScore(item.description, query) ?? -1,
            fuzzyScore(item.category, query) ?? -1,
            fuzzyScore(item.id.replace(/[-_]/g, " "), query) ?? -1,
          ),
        }))
        .filter((entry) => entry.score >= 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.item.category.localeCompare(right.item.category),
        )
        .map((entry) => entry.item),
    [commands, query],
  );
  const visible = filtered.slice(
    Math.max(0, Math.min(selected - 4, filtered.length - 9)),
    Math.max(0, Math.min(selected - 4, filtered.length - 9)) + 9,
  );
  const start = Math.max(0, Math.min(selected - 4, filtered.length - 9));

  useTerminalMouse(rootElement, (event, contains) => {
    if (event.action === "wheel" && contains(rootElement.current)) {
      setSelected((value) => Math.max(0, Math.min(filtered.length - 1, value + (event.wheelDirection === "down" ? 1 : -1) * 3)));
      return;
    }
    if (event.action !== "press" || event.button !== 0) return;
    if (contains(closeElement.current)) { onClose(); return; }
    const row = entryElements.current.findIndex((element) => contains(element));
    if (row >= 0) {
      const index = start + row;
      setSelected(index);
      const command = filtered[index];
      if (command) onSelect(command.command);
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
      setSelected((value) =>
        filtered.length === 0 ? 0 : Math.min(filtered.length - 1, value + 1),
      );
      return;
    }
    if (key.return) {
      const command = filtered[selected];
      if (command) onSelect(command.command);
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
      borderLeft
      borderColor={theme.brand}
      paddingLeft={1}
      marginY={1}
    >
      <Box justifyContent="space-between">
        <Text bold color={theme.text}>
          Command palette
        </Text>
        <Box ref={closeElement}><Text color={theme.chrome}>[ × close ]</Text></Box>
      </Box>
      <Text color={theme.brand}>
        ⌕ <Text color={theme.text}>{query || "Search commands…"}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((item, index) => {
          const absolute = start + index;
          return (
            <Box key={item.id} ref={(element) => { entryElements.current[index] = element; }} justifyContent="space-between">
              <Text
                color={absolute === selected ? theme.brand : theme.text}
                bold={absolute === selected}
              >
                {absolute === selected ? "› " : "  "}
                {item.command.padEnd(20)}
                <Text color={theme.muted}>{item.description}</Text>
              </Text>
              <Text color={theme.chrome}>{item.shortcut ?? item.category}</Text>
            </Box>
          );
        })}
        {filtered.length === 0 ? (
          <Text color={theme.muted}>No matching commands.</Text>
        ) : null}
        {filtered.length > visible.length ? (
          <Text color={theme.chrome}>
            Showing {start + 1}–{start + visible.length} of {filtered.length}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
