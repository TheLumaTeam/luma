import { marked, type Token, type Tokens } from "marked";
import { Box, Text } from "ink";
import { memo, useRef, type ReactNode } from "react";

import { theme } from "../theme";

type InlineToken = Token;

function children(tokens: Token[] | undefined, key: string): ReactNode[] {
  return inline(tokens ?? [], key);
}

function inline(tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "strong":
        return (
          <Text key={key} bold>
            {children(token.tokens, key)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} italic>
            {children(token.tokens, key)}
          </Text>
        );
      case "del":
        return (
          <Text key={key} strikethrough>
            {children(token.tokens, key)}
          </Text>
        );
      case "codespan":
        return (
          <Text key={key} color={theme.accent}>
            {token.text}
          </Text>
        );
      case "br":
        return <Text key={key}>{"\n"}</Text>;
      case "link":
        return (
          <Text key={key} color={theme.user} underline>
            {children(token.tokens, key)}{" "}
            <Text color={theme.muted}>({token.href})</Text>
          </Text>
        );
      case "image":
        return (
          <Text key={key} color={theme.muted}>
            [image: {token.text}]
          </Text>
        );
      case "escape":
      case "text":
        return (
          <Text key={key}>
            {"tokens" in token && token.tokens
              ? inline(token.tokens, key)
              : token.text}
          </Text>
        );
      case "html":
        return <Text key={key}>{token.text}</Text>;
      default:
        return (
          <Text key={key}>{"text" in token ? String(token.text) : ""}</Text>
        );
    }
  });
}

function blocks(tokens: Token[], keyPrefix = "md"): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "space":
        return null;
      case "heading":
        return (
          <Box key={key} marginTop={index === 0 ? 0 : 1}>
            <Text bold color={theme.brand} underline={token.depth <= 2}>
              {children(token.tokens, key)}
            </Text>
          </Box>
        );
      case "paragraph":
        return (
          <Box key={key}>
            <Text>{children(token.tokens, key)}</Text>
          </Box>
        );
      case "text":
        return (
          <Box key={key}>
            <Text>
              {"tokens" in token && token.tokens
                ? inline(token.tokens, key)
                : token.text}
            </Text>
          </Box>
        );
      case "code":
        return (
          <Box
            key={key}
            flexDirection="column"
            marginY={1}
            paddingX={1}
            borderStyle="single"
            borderColor={theme.border}
          >
            {token.lang ? <Text color={theme.brand}>{token.lang}</Text> : null}
            <Text color={theme.secondary}>{token.text}</Text>
          </Box>
        );
      case "blockquote":
        return (
          <Box
            key={key}
            flexDirection="column"
            marginLeft={1}
            paddingLeft={1}
            borderStyle="single"
            borderLeft
            borderColor={theme.chrome}
          >
            {blocks(token.tokens ?? [], key)}
          </Box>
        );
      case "list":
        const list = token as Tokens.List;
        return (
          <Box key={key} flexDirection="column" marginY={1}>
            {list.items.map((item, itemIndex) => (
              <Box key={`${key}-${itemIndex}`} flexDirection="row">
                <Text color={theme.brand}>
                  {item.task
                    ? item.checked
                      ? "✓ "
                      : "○ "
                    : list.ordered
                      ? `${Number(list.start || 1) + itemIndex}. `
                      : "• "}
                </Text>
                <Box flexGrow={1} flexDirection="column">
                  {blocks(item.tokens, `${key}-${itemIndex}`)}
                </Box>
              </Box>
            ))}
          </Box>
        );
      case "hr":
        return (
          <Box key={key} marginY={1}>
            <Text color={theme.chrome}>────────</Text>
          </Box>
        );
      case "table":
        const table = token as Tokens.Table;
        return (
          <Box key={key} flexDirection="column" marginY={1}>
            {[table.header, ...table.rows].map((row, rowIndex) => (
              <Text key={`${key}-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <Text key={`${key}-${rowIndex}-${cellIndex}`}>
                    {cellIndex ? "  │  " : ""}
                    <Text bold={rowIndex === 0}>
                      {inline(cell.tokens, `${key}-${rowIndex}-${cellIndex}`)}
                    </Text>
                  </Text>
                ))}
              </Text>
            ))}
            <Text color={theme.border}>
              {"─".repeat(Math.max(8, table.header.length * 8))}
            </Text>
          </Box>
        );
      case "html":
        return (
          <Box key={key}>
            <Text>{token.text}</Text>
          </Box>
        );
      default:
        return null;
    }
  });
}

export const Markdown = memo(function Markdown({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  const incremental = useRef<{ source: string; tokens: Token[] }>({
    source: "",
    tokens: [],
  });
  // Model output and pasted prompts are untrusted terminal text. Keep normal
  // Markdown intact while removing terminal control bytes before rendering.
  const safeContent = content
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
  if (streaming) {
    // Commit only complete top-level blocks. The unfinished tail is parsed on
    // each delta, while already completed blocks are retained as tokens.
    // This keeps streaming Markdown formatted without re-lexing the transcript.
    let boundary = -1;
    let fence: string | null = null;
    const lines = safeContent.match(/.*(?:\n|$)/g) ?? [];
    let offset = 0;
    for (const line of lines) {
      const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1]![0]!;
        if (fence === null) fence = marker;
        else if (fence === marker) fence = null;
      }
      if (fence === null && /^\s*\n$/.test(line)) boundary = offset + line.length;
      offset += line.length;
    }

    let cached = incremental.current;
    if (!safeContent.startsWith(cached.source)) cached = { source: "", tokens: [] };
    const completedEnd = Math.max(cached.source.length, boundary);
    if (completedEnd > cached.source.length) {
      const newlyCompleted = safeContent.slice(cached.source.length, completedEnd);
      cached = {
        source: safeContent.slice(0, completedEnd),
        tokens: [...cached.tokens, ...marked.lexer(newlyCompleted, { gfm: true, breaks: true })],
      };
      incremental.current = cached;
    }
    const tail = safeContent.slice(cached.source.length);
    const tailTokens = tail ? marked.lexer(tail, { gfm: true, breaks: true }) : [];
    return <Box flexDirection="column">{blocks([...cached.tokens, ...tailTokens])}</Box>;
  }
  incremental.current = { source: safeContent, tokens: [] };
  const tokens = marked.lexer(safeContent, { gfm: true, breaks: true });
  return <Box flexDirection="column">{blocks(tokens)}</Box>;
});
