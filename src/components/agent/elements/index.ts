/**
 * Agent element library — self-contained UI primitives for the RGE Agent chat.
 * Every element follows the assistant-ui-style prop APIs and the app's Red
 * Noir design language, and reads its shared surfaces from ./surfaces.
 */

export { ToolCall, type ToolCallProps } from './tool-call';
export {
  ToolTimeline,
  type TimelineStep,
  type TimelineStat,
  type ToolTimelineProps,
} from './tool-timeline';
export { CodeDiff, type DiffLine, type CodeDiffProps } from './code-diff';
export { FileTree, type FileTreeNode, type FileTreeProps } from './file-tree';
export { AgentPlan, type AgentPlanProps } from './agent-plan';
export {
  SubagentList,
  type SubagentItem,
  type SubagentListProps,
} from './subagent-list';
export { AgentStatus, type AgentState, type AgentStatusProps } from './agent-status';
export { ArtifactCard, type ArtifactCardProps } from './artifact-card';
export { TodoList, type TodoItem, type TodoListProps } from './todo-list';
export { AgentHandoff, type AgentHandoffProps } from './agent-handoff';
export {
  CheckpointHistory,
  type Checkpoint,
  type CheckpointHistoryProps,
} from './checkpoint-history';
export { GenerationLoader, type GenerationLoaderProps } from './loading-state';
export {
  StreamingText,
  StreamedWords,
  type Segment,
  type StreamingTextProps,
} from './streaming-text';
export { MessagePair, type MessagePairProps } from './message-pair';
export { StoppedRun, type StoppedRunProps } from './stopped-run';
export {
  ThinkingIndicator,
  type ThinkingIndicatorProps,
} from './thinking-indicator';
export { ThinkingReasoning, type ThinkingReasoningProps } from './thinking-reasoning';
export { Orb, ORB_TASKS, type OrbProps, type OrbVariant } from './orb';

/* Shared surfaces — retheming these tokens restyles every element at once. */
export {
  ShimmerLabel,
  Collapse,
  clampCount,
  mono,
  field,
  paper,
  ghostButton,
  codeScroll,
  codeSurface,
  collapsePanel,
  collapsePanelOpen,
  collapseInner,
  anim,
} from './surfaces';
