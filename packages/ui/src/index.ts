/**
 * @growth-os/ui — Growth OS design system. Import tokens once in the app:
 *   import '@growth-os/ui/tokens.css';
 */
export * from './format/format';
export type * from './components/contracts';

/** Lucide icon names used by status grammars (research §7.5). WS7 maps these to lucide-react. */
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
