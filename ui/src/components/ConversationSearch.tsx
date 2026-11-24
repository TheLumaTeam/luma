import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";

import type { Message } from "../state";
import { theme } from "../theme";

export function ConversationSearch({ messages, onSelect, onClose }: {
  messages: Message[];
  onSelect: (index: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return messages.flatMap((message, index) => message.role === "system" ? [] :
      message.content.toLocaleLowerCase().includes(needle) ? [{ message, index }] : []);
  }, [messages, query]);

  useInput((input, key) => {
    if (key.escape) { onClose(); return; }
    if (key.upArrow) { setSelected((value) => Math.max(0, value - 1)); return; }
    if (key.downArrow) { setSelected((value) => Math.min(results.length - 1, value + 1)); return; }
    if (key.return) {
      const result = results[selected];
      if (result) onSelect(result.index);
      return;
    }
    if (key.backspace || key.delete) { setQuery((value) => value.slice(0, -1)); setSelected(0); return; }
    if (!key.ctrl && !key.meta && input) { setQuery((value) => value + input); setSelected(0); }
  });

  return <Box flexDirection="column" borderStyle="round" borderColor={theme.brand} paddingX={1} paddingY={1} marginY={1}>
    <Box justifyContent="space-between">
      <Text bold color={theme.text}>Search conversation</Text>
      <Text color={theme.chrome}>Esc close · ↑↓ select · Enter jump</Text>
    </Box>
    <Text color={theme.brand}>⌕ {query || "Search messages and tool output…"}</Text>
    <Box flexDirection="column" marginTop={1}>
      {results.slice(Math.max(0, Math.min(selected - 3, results.length - 7)), Math.max(0, Math.min(selected - 3, results.length - 7)) + 7).map((result, index) => {
        const absolute = Math.max(0, Math.min(selected - 3, results.length - 7)) + index;
        const preview = result.message.content.replace(/\s+/g, " ").trim();
        return <Text key={result.message.id} color={absolute === selected ? theme.brand : theme.text} bold={absolute === selected}>
          {absolute === selected ? "› " : "  "}{result.message.role.padEnd(9)}{preview.slice(0, 100)}{preview.length > 100 ? "…" : ""}
        </Text>;
      })}
      {query.trim() && results.length === 0 ? <Text color={theme.muted}>No matching messages.</Text> : null}
      {results.length > 0 ? <Text color={theme.chrome}>{results.length} result{results.length === 1 ? "" : "s"} · {selected + 1} selected</Text> : null}
    </Box>
  </Box>;
}
