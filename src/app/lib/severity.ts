/* ============================================================
   severity.ts — the one place a severity, tier or dispatch reason
   turns into a colour and a mark.

   DELIBERATE DIVERGENCE FROM tokens.css: the mockups paint DEGRADING
   and HIGH with --amber (#f0a020); the Phase 1 semantic aliases point
   both at --orange (#db6d28). The mockups are the visual spec for this
   phase, so the mockups win — but only here, in one map, so the choice
   is visible and reversible. No new hex is introduced: every value
   below is a token that already exists.

   Nothing is carried by colour alone. Each entry pairs its colour with
   a distinct mark AND the label is always rendered next to it.
   ============================================================ */

import type { Sev, Tier } from '@/core/types';

/** The four marks, as the mockups draw them. */
export type Mark = 'triangle' | 'diamond' | 'circle' | 'dash';

export interface Look {
  /** a CSS colour value — always `var(--token)`, never a literal hex */
  color: string;
  mark: Mark;
}

const RED: Look = { color: 'var(--red)', mark: 'triangle' };
const AMBER_D: Look = { color: 'var(--amber)', mark: 'diamond' };
const PURPLE: Look = { color: 'var(--purple)', mark: 'circle' };
const GREEN: Look = { color: 'var(--green)', mark: 'circle' };
const DIM: Look = { color: 'var(--dim)', mark: 'dash' };

export function sevLook(sev: Sev | undefined): Look {
  switch (sev) {
    case 'FAILING':
      return RED;
    case 'DEGRADING':
      return AMBER_D;
    case 'WATCH':
      return { color: 'var(--amber)', mark: 'circle' };
    case 'STABLE':
      return GREEN;
    default:
      return DIM;
  }
}

export function tierLook(tier: Tier | undefined): Look {
  switch (tier) {
    case 'CRITICAL':
      return RED;
    case 'HIGH':
      return AMBER_D;
    case 'ELEVATED':
      return { color: 'var(--amber)', mark: 'circle' };
    case 'MONITOR':
      // --teal-d is a surface colour; as text on a tinted pill it fails 4.5:1
      return { color: 'var(--teal-l)', mark: 'circle' };
    default:
      return DIM;
  }
}

/** The dispatch reason label (queueReason.label) → its look in the picker. */
export function reasonLook(label: string): Look {
  switch (label) {
    case 'FAILING':
    case 'CRITICAL':
      return RED;
    case 'HIDDEN RISK':
      return PURPLE;
    case 'DEGRADING':
    case 'HIGH':
      return AMBER_D;
    case 'WATCH':
      return { color: 'var(--amber)', mark: 'circle' };
    default:
      return DIM;
  }
}

/** The verdict card's accent → a colour token. */
export function accentColor(accent: 'red' | 'amber' | 'purple' | 'green'): string {
  return accent === 'red'
    ? 'var(--red)'
    : accent === 'amber'
      ? 'var(--amber)'
      : accent === 'purple'
        ? 'var(--purple)'
        : 'var(--green)';
}

/** Signal-tile band → the colour of the tile's top rule. */
export function bandColor(band: 'red' | 'amber' | 'green' | 'dim'): string {
  return band === 'red'
    ? 'var(--red)'
    : band === 'amber'
      ? 'var(--amber)'
      : band === 'green'
        ? 'var(--green)'
        : 'var(--line)';
}

/** The device work state → its pill colour. */
export function stateColor(state: string): string {
  switch (state) {
    case 'RESOLVED':
      return 'var(--green)';
    case 'ACTIONED':
      return 'var(--amber)';
    case 'TRIAGED':
      return 'var(--teal-l)';
    case 'DEFERRED':
      return 'var(--purple)';
    case 'FALSE_POSITIVE':
      return 'var(--dim)';
    default:
      return 'var(--dim)';
  }
}
