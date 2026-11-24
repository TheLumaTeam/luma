import { Box, Text, useStdout } from "ink";
import type { DOMElement } from "ink";
import { useRef } from "react";

import { theme } from "../theme";
import type { UiSessionInfo } from "../state";
import type { ChatSummary } from "../protocol";
import { useTerminalMouse } from "../hooks/useTerminalMouse";

type Props = {
  session: UiSessionInfo;
  changedFiles?: number;
  gitBranch?: string;
  sessionTabs?: ChatSummary[];
  activeChatId?: string | null;
  fullScreen?: boolean;
  onSelectSession?: (id: string) => void;
};

export function Header({
  session,
  changedFiles,
  gitBranch,
  sessionTabs = [],
  activeChatId,
  fullScreen = false,
  onSelectSession,
}: Props) {
  const { stdout } = useStdout();
  const workspace =
    session.workspace.replace(/\/$/, "").split("/").pop() || session.workspace;
  const width = stdout.columns || 80;
  const rootElement = useRef<DOMElement>(null);
  const tabElements = useRef<Array<DOMElement | null>>([]);
  useTerminalMouse(rootElement, (event, contains) => {
    if (event.action !== "press" || event.button !== 0) return;
    const index = tabElements.current.findIndex((element) => contains(element));
    if (index >= 0) {
      const tab = sessionTabs[index];
      if (tab) onSelectSession?.(tab.id);
    }
  });

  return (
    <Box ref={rootElement} flexDirection="column" marginBottom={1}>
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Text color={theme.text} bold>
            LUMA
          </Text>
          <Text color={theme.chrome}>/</Text>
          <Text color={theme.secondary}>{workspace}</Text>
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          {width >= 64 && (gitBranch || session.branch) ? (
            <Text color={theme.muted}>
              {gitBranch || session.branch}
              {changedFiles ? " *" : session.dirty ? " *" : ""}
            </Text>
          ) : null}
          {width >= 72 && changedFiles !== undefined ? (
            <Text color={changedFiles > 0 ? theme.warning : theme.chrome}>
              {changedFiles} changed
            </Text>
          ) : null}
          {width >= 52 ? (
            <>
              <Text color={theme.chrome}>·</Text>
              <Text color={theme.muted}>{session.model}</Text>
            </>
          ) : null}
          {fullScreen ? <Text color={theme.brand}> FULLSCREEN</Text> : null}
        </Box>
      </Box>
      {sessionTabs.length > 0 && width >= 76 ? (
        <Box flexDirection="row" columnGap={2}>
          {sessionTabs.slice(0, 5).map((tab, index) => (
            <Box key={tab.id} ref={(element) => { tabElements.current[index] = element; }}>
            <Text
              color={tab.id === activeChatId ? theme.brand : theme.chrome}
              bold={tab.id === activeChatId}
            >
              {tab.id === activeChatId ? "▰ " : "▱ "}
              {tab.title.slice(0, Math.max(8, Math.floor(width / 24)))}
            </Text>
            </Box>
          ))}
          <Text color={theme.chrome}>
            Ctrl+Tab switch · Ctrl+Shift+S sessions
          </Text>
        </Box>
      ) : null}
      <Text color={theme.border}>
        {"─".repeat(Math.max(0, width - (fullScreen ? 4 : 2)))}
      </Text>
    </Box>
  );
}
