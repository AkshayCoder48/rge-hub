/**
 * Structured UI-block renderer library (public API).
 *
 * The RGE Agent streams `UiBlockState` blocks through the `emit_ui` tool; the
 * agent chat renders each one through `UIBlockHost`, which resolves the 60
 * registered `uiType` renderers and falls back to a raw-JSON card for unknown
 * types. Renderers needing host actions (e.g. downloads) read them through
 * `UiBlockActionsContext` / `useUiBlockActions`.
 *
 * `RENDERER_DOCS` + `UI_BLOCK_TYPES` feed the agent's system prompt, so the
 * data-shape hints there must stay in sync with the renderers.
 */

export {
  getBlockRenderer,
  RENDERER_DOCS,
  UI_BLOCK_TYPES,
  UIBlockHost,
  UiBlockActionsContext,
  useUiBlockActions,
} from './registry';
export type { BlockProps, UiBlockActions } from './primitives';
