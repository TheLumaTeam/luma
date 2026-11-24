import { Box, Text, useStdout } from "ink";

import { theme } from "../theme";
import type { UiSessionInfo } from "../state";
import type { ChatSummary } from "../protocol";
import type { Status } from "../state";
import { PromptHeader } from "./PromptHeader";

type Props = {
  session: UiSessionInfo;
  changedFiles?: number;
  gitBranch?: string;
  sessionTabs?: ChatSummary[];
  activeChatId?: string | null;
  fullScreen?: boolean;
  status: Status;
  activeTool: string | null;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd_micros: number };
  lastPromptTokens: number | null;
  draftTokensEstimate: number;
};

export function Header({ session, changedFiles, gitBranch, sessionTabs = [], activeChatId, fullScreen = false, status, activeTool, usage, lastPromptTokens, draftTokensEstimate }: Props) {
  const { stdout } = useStdout();
  const workspace = session.workspace.replace(/\/$/, "").split("/").pop() || session.workspace;
  const width = stdout.columns || 80;

  return <Box flexDirection="column" marginBottom={1}>
    <Box flexDirection="row" alignItems="center" justifyContent="space-between">
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        <Text color={theme.text} bold>LUMA</Text>
        <Text color={theme.chrome}>/</Text>
        <Text color={theme.secondary}>{workspace}</Text>
      </Box>
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {(gitBranch || session.branch) ? <Text color={theme.muted}>{gitBranch || session.branch}{changedFiles ? " *" : session.dirty ? " *" : ""}</Text> : null}
        {changedFiles !== undefined ? <Text color={changedFiles > 0 ? theme.warning : theme.chrome}>{changedFiles} changed</Text> : null}
        <Text color={theme.chrome}>·</Text>
        <Text color={theme.muted}>{session.model}</Text>
        {fullScreen ? <Text color={theme.brand}>  FULLSCREEN</Text> : null}
      </Box>
    </Box>
    {sessionTabs.length > 0 ? <Box flexDirection="row" columnGap={2}>
      {sessionTabs.slice(0, 5).map((tab) => <Text key={tab.id} color={tab.id === activeChatId ? theme.brand : theme.chrome} bold={tab.id === activeChatId}>
        {tab.id === activeChatId ? "▰ " : "▱ "}{tab.title.slice(0, Math.max(8, Math.floor(width / 24)))}
      </Text>)}
      <Text color={theme.chrome}>Ctrl+Tab switch · Ctrl+Shift+S sessions</Text>
    </Box> : null}
    <PromptHeader status={status} activeTool={activeTool} usage={usage} lastPromptTokens={lastPromptTokens} draftTokensEstimate={draftTokensEstimate} />
    <Text color={theme.border}>{"─".repeat(Math.max(0, width - (fullScreen ? 4 : 2)))}</Text>
  </Box>;
}
