/**
 * Token reference for the /design-system page (DesignSystem.dc.html "Palette"). Values mirror
 * tokens.css (light | dark). This file and tokens.css are the only places raw colours may live.
 */
export interface Swatch {
  name: string;
  cssVar: string;
  light: string;
  dark: string;
  note?: string;
}

export const SWATCH_GROUPS: { title: string; swatches: Swatch[] }[] = [
  {
    title: 'Base · light | dark',
    swatches: [
      { name: 'bg.canvas', cssVar: '--bg-canvas', light: '#F7F7F5', dark: '#0F1012' },
      { name: 'bg.surface', cssVar: '--bg-surface', light: '#FFFFFF', dark: '#17191C' },
      { name: 'bg.sunken', cssVar: '--bg-sunken', light: '#F0F0EC', dark: '#1E2125' },
      { name: 'border.subtle', cssVar: '--border-subtle', light: '#E4E4DF', dark: '#2A2E34' },
      { name: 'border.control', cssVar: '--border-control', light: '#84888F', dark: '#6A707A' },
      { name: 'text.primary', cssVar: '--text-primary', light: '#17181B', dark: '#ECEDEF' },
      { name: 'text.secondary', cssVar: '--text-secondary', light: '#4B4F57', dark: '#B3B7BF' },
      { name: 'text.tertiary', cssVar: '--text-tertiary', light: '#6A6E76', dark: '#8B9099' },
      { name: 'accent', cssVar: '--accent', light: '#3049C9', dark: '#8DA2F7' },
      { name: 'success.fg', cssVar: '--success-fg', light: '#1B7046', dark: '#5FCB93' },
      { name: 'success.bg', cssVar: '--success-bg', light: '#E6F3EB', dark: '#12291D' },
      { name: 'warning.fg', cssVar: '--warning-fg', light: '#8A5300', dark: '#E9B651' },
      { name: 'warning.bg', cssVar: '--warning-bg', light: '#FBF0DA', dark: '#2D2410' },
      { name: 'danger.fg', cssVar: '--danger-fg', light: '#B3261E', dark: '#F48A84' },
      { name: 'danger.bg', cssVar: '--danger-bg', light: '#FCEBEA', dark: '#331817' },
      { name: 'info.fg', cssVar: '--info-fg', light: '#2853B8', dark: '#86A9F6' },
      { name: 'info.bg', cssVar: '--info-bg', light: '#E9EEFA', dark: '#152039' },
      { name: 'neutral.fg', cssVar: '--neutral-fg', light: '#4B4F57', dark: '#B3B7BF' },
      { name: 'neutral.bg', cssVar: '--neutral-bg', light: '#EEEEEB', dark: '#24272C' },
      { name: 'ai.fg', cssVar: '--ai-fg', light: '#6A3DB0', dark: '#BBA0F4' },
      { name: 'ai.bg', cssVar: '--ai-bg', light: '#F1ECFA', dark: '#251D3B' },
      { name: 'restricted.fg', cssVar: '--restricted-fg', light: '#3B4250', dark: '#C3C8D1' },
      { name: 'restricted.bg', cssVar: '--restricted-bg', light: '#E8EAEE', dark: '#262A31' },
    ],
  },
  {
    title: 'Epistemic kinds',
    swatches: [
      {
        name: 'kind.evidence fg',
        cssVar: '--kind-evidence-fg',
        light: '#0E6464',
        dark: '#6CCFCB',
        note: '5.98:1 on bg',
      },
      { name: 'kind.evidence bg', cssVar: '--kind-evidence-bg', light: '#E3F1F0', dark: '#10292A' },
      {
        name: 'kind.assumption fg',
        cssVar: '--kind-assumption-fg',
        light: '#8C2D6B',
        dark: '#E79BC9',
        note: '6.63:1 on bg',
      },
      { name: 'kind.assumption bg', cssVar: '--kind-assumption-bg', light: '#F8E9F1', dark: '#2E1726' },
      {
        name: 'kind.scenario fg',
        cssVar: '--kind-scenario-fg',
        light: '#2F5F78',
        dark: '#8FC0DA',
        note: '5.91:1 on bg',
      },
      { name: 'kind.scenario bg', cssVar: '--kind-scenario-bg', light: '#E6EEF3', dark: '#14232C' },
      {
        name: 'kind.actual fg',
        cssVar: '--kind-actual-fg',
        light: '#17181B',
        dark: '#ECEDEF',
        note: '14.99:1 on bg',
      },
      { name: 'kind.actual bg', cssVar: '--kind-actual-bg', light: '#ECECE8', dark: '#24272C' },
    ],
  },
  {
    title: 'Scenario ramp (ordinal, no good/bad hue)',
    swatches: [
      { name: 'scenario.downside ▼', cssVar: '--scenario-downside', light: '#5E8FA8', dark: '#6E9DB5' },
      { name: 'scenario.base ●', cssVar: '--scenario-base', light: '#2F5F78', dark: '#9CC4D9' },
      { name: 'scenario.upside ▲', cssVar: '--scenario-upside', light: '#163A4D', dark: '#D3E8F3' },
    ],
  },
  {
    title: 'Categorical · up to 4 candidates or cohorts · never status',
    swatches: [
      { name: 'cat.1', cssVar: '--cat-1', light: '#0072B2', dark: '#56B4E9' },
      { name: 'cat.2', cssVar: '--cat-2', light: '#B35A00', dark: '#E69F00' },
      { name: 'cat.3', cssVar: '--cat-3', light: '#00866B', dark: '#3CC49E' },
      { name: 'cat.4', cssVar: '--cat-4', light: '#A8508A', dark: '#D98BB8' },
    ],
  },
  {
    title: 'Chart reference lines',
    swatches: [
      {
        name: 'chart.actual',
        cssVar: '--chart-actual',
        light: '#17191B',
        dark: '#ECEDEF',
        note: 'solid · ■',
      },
      {
        name: 'chart.threshold',
        cssVar: '--chart-threshold',
        light: '#4B4F57',
        dark: '#B3B7BF',
        note: 'dashed 4-2',
      },
      {
        name: 'chart.baseline',
        cssVar: '--chart-baseline',
        light: '#6A6E76',
        dark: '#8B9099',
        note: 'dotted',
      },
      {
        name: 'chart.cap',
        cssVar: '--chart-cap',
        light: '#8A5300',
        dark: '#E9B651',
        note: '2 px + lock-bar',
      },
      {
        name: 'chart.topdown',
        cssVar: '--chart-topdown',
        light: '#6A6E76',
        dark: '#8B9099',
        note: 'hatched range',
      },
      {
        name: 'chart.bottomup',
        cssVar: '--chart-bottomup',
        light: '#2F5F78',
        dark: '#9CC4D9',
        note: 'marker',
      },
    ],
  },
];
