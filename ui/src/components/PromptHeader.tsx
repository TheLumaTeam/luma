import { Box, Text } from "ink";
import { useEffect, useState } from "react";

import { theme } from "../theme";
import type { Status } from "../state";
import { useMotionFrame } from "../hooks/useMotionFrame";
import { pulseColorAtFrame } from "../hooks/usePulseColor";
import { spinnerAtFrame } from "../hooks/useSpinner";

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
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(0)}k`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

const statusWords: Record<Status, string> = {
  idle: "Ready",
  thinking: "Thinking",
  working: "Working",
  streaming: "Responding",
  waiting: "Approval needed",
  cancelling: "Cancelling",
  done: "Completed",
  error: "Needs attention",
};

export function PromptHeader({
  status,
  activeTool,
  usage,
  lastPromptTokens,
  draftTokensEstimate,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  useEffect(() => {
    const active =
      status === "thinking" ||
      status === "working" ||
      status === "streaming" ||
      status === "waiting" ||
      status === "cancelling";
    if (active && startedAt === null) setStartedAt(Date.now());
    if (status === "idle" || status === "done" || status === "error") {
      setStartedAt(null);
      setElapsed(0);
      return;
    }
    if (!active || startedAt === null) return;

    const update = () =>
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [status, startedAt]);

  const active =
    status === "thinking" ||
    status === "working" ||
    status === "streaming" ||
    status === "cancelling";
  const motionFrame = useMotionFrame(active);
  const spinner = active && !activeTool ? spinnerAtFrame(motionFrame) : "";
  const activeColor = active
    ? pulseColorAtFrame(motionFrame, theme.accent, "#c0cee2")
    : theme.accent;
  const statusColor =
    status === "waiting" || status === "cancelling"
      ? theme.warning
      : status === "error"
        ? theme.error
        : status === "done"
          ? theme.success
          : theme.accent;
  // Sweep from end to end, then reverse the whole snake. The tail follows
  // behind the head in the current direction instead of wrapping around.
  const sweepPhase = motionFrame % 60;
  const movingRight = sweepPhase < 30;
  const sweepPosition =
    (movingRight ? sweepPhase : 60 - sweepPhase) / 30 * 15;
  const progress = Array.from({ length: 16 }, (_, index) => {
    const distance = movingRight
      ? sweepPosition - index
      : index - sweepPosition;
    return distance < 4 ? 2 : distance < 7 ? 1 : 0;
  });
  return (
    <Box
      width="100%"
      marginBottom={0}
      flexDirection="row"
      justifyContent="space-between"
      flexWrap="wrap"
    >
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text color={active ? activeColor : statusColor}>
          {active && !activeTool
            ? spinner
            : status === "waiting"
              ? "◷"
              : status === "done"
                ? "✓"
                : status === "error"
                  ? "!"
                  : "·"}
        </Text>
        <Text
          color={active || status === "waiting" ? activeColor : theme.muted}
        >
          {activeTool
            ? `${statusWords[status]} · ${activeTool}`
            : statusWords[status]}
        </Text>
        {active || status === "waiting" ? (
          <Text color={theme.chrome}>{elapsed}s</Text>
        ) : null}
        {active && !activeTool ? (
          <Text>
            {progress.map((level, index) => (
              <Text
                key={index}
                color={
                  level === 2
                    ? activeColor
                    : level === 1
                      ? theme.muted
                      : theme.border
                }
              >
                ━
              </Text>
            ))}
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {draftTokensEstimate > 0 ? (
          <Text color={theme.chrome}>
            draft {formatTokens(draftTokensEstimate)} tok
          </Text>
        ) : null}
        {lastPromptTokens !== null ? (
          <Text color={theme.secondary}>
            context {formatTokens(lastPromptTokens)}
          </Text>
        ) : null}
        {usage.total_tokens > 0 ? (
          <Text color={theme.chrome}>
            session {formatTokens(usage.total_tokens)} tok
          </Text>
        ) : null}
        {usage.cost_usd_micros > 0 ? (
          <Text color={theme.chrome}>
            ${(usage.cost_usd_micros / 1_000_000).toFixed(4)}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
