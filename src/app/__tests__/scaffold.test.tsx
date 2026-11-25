/* ============================================================
   scaffold.test.tsx — the shell renders, the stage rail and the
   lenses are reachable, and the /pull proof runs the real ported
   chain through the real store.

   PHASE 2 NOTE: this file kept its five Phase 1 assertions but had to
   be rewritten against the new information architecture. Phase 1's
   scaffold was a sidebar of eleven destinations; Phase 2 replaces it
   with the stage rail, which is the whole point of the redesign — so
   "the nav has a link named Investigate" could not survive verbatim.
   Every assertion below tests the same *property* the Phase 1 one did:
   the shell boots, the routes exist and navigate client-side, motion
   is importable, the real CSV ingests, and the commit writes the
   legacy blob. The six ported-core suites are untouched.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { motion } from 'motion/react';
import { App } from '@/app/App';
import { STORE_KEY } from '@/core/store-core';

const SAMPLE = readFileSync(resolve(process.cwd(), 'demo/sample-fleet.csv'), 'utf8');

beforeEach(() => {
  cleanup();
  window.location.hash = '#/pull';
});

describe('shell', () => {
  it('boots on /pull with every stage in the rail and every lens in the corner', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Pull the week in' })).toBeInTheDocument();

    const rail = screen.getByRole('navigation', { name: 'Weekly stages' });
    for (const label of ['Pull', 'Score', 'Investigate', 'Work', 'Close']) {
      expect(within(rail).getByText(label)).toBeInTheDocument();
    }
    const lenses = screen.getByRole('navigation', { name: 'Lenses' });
    for (const label of ['Fleet', 'Trends', 'Config', 'Export']) {
      expect(within(lenses).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('navigates from the rail without a full page load', async () => {
    const user = userEvent.setup();
    render(<App />);
    const rail = screen.getByRole('navigation', { name: 'Weekly stages' });
    await user.click(within(rail).getByText('Close').closest('a') as HTMLElement);
    expect(window.location.hash).toBe('#/close');

    const lenses = screen.getByRole('navigation', { name: 'Lenses' });
    await user.click(within(lenses).getByRole('link', { name: 'Trends' }));
    expect(window.location.hash).toBe('#/trends');
    expect(screen.getByRole('heading', { name: 'Trends' })).toBeInTheDocument();
  });

  it('keeps the guardrail strip on screen', () => {
    render(<App />);
    expect(screen.getByText('Deterministic — no AI in the scoring path.')).toBeInTheDocument();
    expect(screen.getByText('Baseline never silently overwritten.')).toBeInTheDocument();
    expect(screen.getByText('Percentile rank is never absolute risk.')).toBeInTheDocument();
    expect(screen.getByText('Never a fabricated number.')).toBeInTheDocument();
  });

  it('motion/react is installed and importable', () => {
    expect(typeof motion.div).not.toBe('undefined');
  });
});

describe('the /pull proof', () => {
  it('ingests the sample CSV, reports 300 rows in counts mode, then commits', async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = screen.getByTestId('csv-input') as HTMLInputElement;
    await user.upload(input, new File([SAMPLE], 'sample-fleet.csv', { type: 'text/csv' }));

    await waitFor(() => expect(screen.getByTestId('ingest-report')).toBeInTheDocument());
    expect(screen.getByTestId('stat-devices')).toHaveTextContent('300');
    expect(screen.getByTestId('stat-hrimode')).toHaveTextContent('counts');
    expect(screen.getByTestId('stat-rejected')).toHaveTextContent('0');
    expect(screen.queryByTestId('ingest-error')).not.toBeInTheDocument();

    // reading the file commits nothing — the baseline is frozen deliberately
    await user.click(screen.getByRole('button', { name: /Commit run & score/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/score'));
  });

  it('committed the run to localStorage in the legacy blob shape', () => {
    const raw = localStorage.getItem(STORE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed).not.toHaveProperty('state');
    expect(parsed).not.toHaveProperty('version');
    const run = parsed.committedRun as { rows: unknown[]; report: { hriMode: string } };
    expect(run.rows).toHaveLength(300);
    expect(run.report.hriMode).toBe('counts');
    expect((parsed.runHistory as unknown[]).length).toBeGreaterThan(0);
  });
});
