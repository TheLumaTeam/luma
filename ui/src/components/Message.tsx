import { Box, Text } from "ink";
import { memo } from "react";

import type { Message as MessageType } from "../state";
import { glyphs, theme } from "../theme";
import { Markdown } from "./Markdown";
import { useMotionFrame } from "../hooks/useMotionFrame";
import { pulseColorAtFrame } from "../hooks/usePulseColor";
import { spinnerAtFrame } from "../hooks/useSpinner";

type Props = {
  message: MessageType;
  running?: boolean;
  streaming?: boolean;
};

export const Message = memo(function Message({ message, running = false, streaming = false }: Props) {
  const animated = streaming || (message.role === "tool" && running);
  const motionFrame = useMotionFrame(animated);
  const spinner = animated && message.role === "tool" && running ? spinnerAtFrame(motionFrame) : "";
  const toolColor = running ? pulseColorAtFrame(motionFrame, theme.brand, "#c0cee2") : theme.chrome;
  if (message.role === "user") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row" alignItems="center" marginBottom={0}>
          <Text color={theme.secondary} bold>You</Text>
        </Box>
        <Box paddingLeft={1} borderLeft borderColor={theme.border}>
          <Markdown content={message.content} />
        </Box>
      </Box>
    );
  }

  if (message.role === "assistant") {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Markdown content={message.content} />
        {streaming && Math.floor(motionFrame / 15) % 2 === 0 ? <Text color={theme.brand}>▍</Text> : null}
      </Box>
    );
  }

  if (message.role === "tool") {
    const [heading, ...details] = message.content.split("\n");
    return (
      <Box marginLeft={1} marginTop={1} flexDirection="column">
        <Box flexDirection="row" alignItems="center">
          <Text color={running ? toolColor : theme.chrome}>{glyphs.tool} </Text>
          <Box flexGrow={1} marginLeft={1}>
            <Text color={running ? theme.text : theme.muted} bold={running}>
              {running ? spinner : ""} {heading}
            </Text>
          </Box>
        </Box>
        {details.length > 0 && (
          <Box marginLeft={3} marginTop={0}>
            {details.map((line, index) => (
              <Text
                key={`${index}-${line}`}
                color={line.startsWith("+") ? theme.success : line.startsWith("-") ? theme.error : theme.chrome}
              >
                {line}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  if (message.role === "preview") {
    const [path, ...diff] = message.content.split("\n");
    return (
      <Box flexDirection="column" marginTop={1} marginLeft={1} paddingLeft={1} borderLeft borderColor={theme.warning}>
        <Text color={theme.warning} bold>Proposed change · {path}</Text>
        <Box marginTop={1} flexDirection="column" marginLeft={1}>
          {diff.map((line, index) => (
            <Text
              key={`${index}-${line}`}
              color={line.startsWith("+") ? theme.success : line.startsWith("-") ? theme.error : theme.muted}
            >
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (message.role === "error") {
    const toolFailure = message.content.startsWith("Failed to run tool\n");
    const detailText = toolFailure ? message.content.slice("Failed to run tool\n".length) : message.content;
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.error}>{glyphs.error} {toolFailure ? "Tool execution failed" : "Request failed"} · Cmd/Ctrl+O for details</Text>
        {detailText ? <Box marginLeft={2}>
          <Text color={theme.muted}>{detailText}</Text>
        </Box> : null}
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <Text color={theme.muted}>· </Text>
      <Text>{message.content}</Text>
    </Box>
  );
});
