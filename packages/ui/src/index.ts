/**
 * @growth-os/ui — Growth OS design system. Import the styles once in the app:
 *   import '@growth-os/ui/tokens.css';
 *   import '@growth-os/ui/components.css';
 */
export * from './format/format';
export type * from './components/contracts';
export * from './components/Icon';
export * from './components/status';
export * from './components/primitives';
export * from './components/gates';
export * from './components/ledger';
export * from './components/shared';
export { STAGE_TONE, GATE_STATUS_FG, TONE_FG, type Tone } from './components/status-maps';

/** Lucide icon names used by status grammars (research §7.5). Mapped to ported paths by `toIconName`. */
export const STATUS_ICONS = {
  evidence: 'file-text',
  assumption: 'pencil-ruler',
  scenario: 'git-branch',
  actual: 'flag',
  ai: 'sparkles',
  unknown: 'circle-dashed',
  restricted: 'lock',
  met: 'target', // + check overlay
  notMet: 'target', // + dash overlay
  inconclusive: 'target', // + question overlay
} as const;
