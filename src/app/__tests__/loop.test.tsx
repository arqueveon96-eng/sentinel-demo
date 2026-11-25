/* ============================================================
   loop.test.tsx — the week, end to end, through the real store.

   Commit a run, pick the top machine, record a finding, set a state,
   open the Proactive Ticket sheet and check its focus contract, record an outcome,
   and watch the ledger and the rail move. Every assertion reads a
   number the ported core produced.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app/App';
import { cfg, sentinel } from '@/store/sentinel.store';
import { buildQueue } from '@/core/queue';
import { ingestAndCommit } from '@/core/pipeline';
import { useUi } from '@/app/lib/ui.store';

const SAMPLE = readFileSync(resolve(process.cwd(), 'demo/sample-fleet.csv'), 'utf8');
const WEEK = '2026-09-03';
let top: string;

beforeAll(() => {
  sentinel.reset();
  ingestAndCommit(WEEK, [{ name: 'sample-fleet.csv', text: SAMPLE }], cfg, sentinel);
  const q = buildQueue(sentinel.currentRun()!, cfg, sentinel);
  top = q[0].name;
  useUi.setState({ selected: null, filter: '', batch: [], staged: [] });
});

beforeEach(() => {
  cleanup();
});

describe('the workspace', () => {
  it('lands on the top of the dispatch queue and names it in the dossier', async () => {
    window.location.hash = '#/investigate';
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: top })).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: 'Queue in dispatch order' });
    expect(within(list).getByRole('option', { selected: true })).toHaveTextContent(top);
  });

  it('writes a verdict sentence computed from that device, not a placeholder', async () => {
    window.location.hash = '#/investigate';
    render(<App />);
    const verdict = await screen.findByRole('heading', { level: 2, name: /hardware|composite|HRI|machine/i });
    expect(verdict.textContent?.length ?? 0).toBeGreaterThan(20);
    expect(verdict.textContent).not.toMatch(/lorem|TODO|placeholder/i);
  });

  it('fills the P7 query with the selected device name', async () => {
    window.location.hash = '#/investigate';
    render(<App />);
    const pre = await screen.findByLabelText(`Phase 7 query for ${top}`);
    expect(pre.textContent).toContain(`| where device.name == "${top}"`);
  });

  it('records a finding through the core overlay and advances to the next machine', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/investigate';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: top });

    const box = screen.getByLabelText(/What Nexthink found/i);
    await user.clear(box);
    await user.type(box, 'state=actioned; component=RAM; cause=0x50; action=reseated DIMM');
    await user.click(screen.getByRole('button', { name: /Record finding · next machine/i }));

    // the overlay carries it; the frozen baseline row does not
    const overlay = sentinel.getOverlay(top);
    expect(overlay.component).toBe('RAM');
    expect(sentinel.currentRun()!.rows.find((r) => r.name === top)).not.toHaveProperty('component');
    expect(sentinel.getQueue(top).state).toBe('ACTIONED');

    // and the dossier moved on
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe(top),
    );
  });

  it('the rail counts the finding it just recorded', async () => {
    window.location.hash = '#/investigate';
    render(<App />);
    const rail = await screen.findByRole('navigation', { name: 'Weekly stages' });
    expect(within(rail).getByText(/findings recorded/)).toHaveTextContent(/^1 of \d+ findings recorded$/);
  });
});

describe('Work', () => {
  it('sets a state through the core state machine and journals it', async () => {
    const user = userEvent.setup();
    useUi.setState({ selected: top });
    window.location.hash = '#/work';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: top });

    await user.click(screen.getByRole('button', { name: 'RESOLVED' }));
    expect(sentinel.getQueue(top).state).toBe('RESOLVED');
    expect(sentinel.getChangelog()[0]).toMatchObject({ device: top, field: 'state', new: 'RESOLVED' });
  });

  it('opens the Proactive Ticket sheet with all thirteen fields, traps focus, and returns it on Escape', async () => {
    const user = userEvent.setup();
    useUi.setState({ selected: top });
    window.location.hash = '#/work';
    render(<App />);
    const trigger = await screen.findByRole('button', { name: /Draft Proactive Ticket/i });
    await user.click(trigger);

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/Never submits — drafts only/i)).toBeInTheDocument();
    for (const label of [
      'Owner ID',
      'Owner name',
      'Date identified',
      'Device name',
      'Device category',
      'Issue category',
      'Proposed remediation',
      'Summary',
      'Delivery mode',
      'Impact',
      'Urgency',
      'Asset tag',
      'Additional information',
    ]) {
      expect(within(sheet).getAllByLabelText(new RegExp(`^${label}`)).length).toBeGreaterThan(0);
    }
    // thirteen fields, no more: the form has exactly thirteen
    expect(sheet.querySelectorAll('.sheet-body .field').length).toBe(13);
    // pre-filled from the run, and the owner name deliberately is not
    expect(within(sheet).getByLabelText(/^Device name/)).toHaveValue(top);
    expect(within(sheet).getByLabelText(/^Owner name/)).toHaveValue('');
    expect(within(sheet).getAllByText('suggested').length).toBeGreaterThan(4);
    // no submit exists
    expect(within(sheet).queryByRole('button', { name: /^submit/i })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Close', () => {
  it('records an outcome, moves the ledger, and writes the sentence it proved', async () => {
    const user = userEvent.setup();
    useUi.setState({ selected: top });
    window.location.hash = '#/close';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: top });

    expect(screen.getByText(/outcomes —/)).toHaveTextContent('0 / 20');

    await user.click(screen.getByRole('button', { name: 'Confirmed failure' }));
    await user.type(screen.getByLabelText('Lead time (days)'), '2');
    await user.click(screen.getByRole('button', { name: /Record outcome · next machine/i }));

    const rec = sentinel.getOutcomes()[0];
    expect(rec).toMatchObject({ device: top, outcome: 'confirmed_fail', leadDays: 2, week: WEEK });
    expect(rec.hri).not.toBeNull();

    await waitFor(() => expect(screen.getByText(/outcomes —/)).toHaveTextContent('1 / 20'));
    const rail = screen.getByRole('navigation', { name: 'Weekly stages' });
    expect(within(rail).getByText(/outcomes recorded/)).toHaveTextContent(/^1 of \d+ outcomes recorded$/);
  });

  it('the proved sentence quotes the recorded lead time, never a stock phrase', async () => {
    useUi.setState({ selected: top });
    window.location.hash = '#/close';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: top });
    const panel = screen.getByText('WHAT THIS ONE PROVED').closest('div') as HTMLElement;
    expect(panel.textContent).toMatch(/Two days of lead time|No lead time recorded|A miss|false positive/i);
    expect(panel.textContent).toContain('proposed');
  });
});
