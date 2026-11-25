/* ============================================================
   lenses.test.tsx — Phase 3's screens, driven through the real store.

   Four things the brief asks to be proven by a test rather than by a
   screenshot: config validation is wired to the CORE's `validateConfig`
   and shows its strings; the bulk findings paste previews exactly what
   it will write; export/import round-trips through the UI; and Trends
   is honest about how many committed weeks it actually has.

   Everything below drives the same singleton store the app uses, so a
   number that appears on screen is a number the ported core produced.
   ============================================================ */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app/App';
import { cfg, sentinel, useSentinelStore } from '@/store/sentinel.store';
import { useUi } from '@/app/lib/ui.store';
import { CFG_DEFAULTS, currentConfig, resetConfigDefaults } from '@/core/config';
import { readRunMeta, trendPoints } from '@/core/trends';
import type { SentinelState } from '@/core/types';

const SAMPLE = readFileSync(resolve(process.cwd(), 'demo/sample-fleet.csv'), 'utf8');
const WEEKS = ['2026-08-21', '2026-08-28', '2026-09-04'];
const files = () => [{ name: 'sample-fleet.csv', text: SAMPLE }];

/** Commit the sample export under N different week-ending dates. */
function commitWeeks(n: number) {
  sentinel.reset();
  resetConfigDefaults(cfg, sentinel);
  WEEKS.slice(0, n).forEach((w) => useSentinelStore.getState().ingest(w, files()));
  useUi.setState({ selected: null, filter: '', batch: [], staged: [], sheet: null });
}

beforeEach(() => {
  cleanup();
});

/* ============================================================
   Config
   ============================================================ */

describe('Config validates through the core', () => {
  beforeAll(() => commitWeeks(1));

  it('rejects weights that sum to 99 with the core’s own message, inline', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/config';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Config' });

    const dex = screen.getByLabelText('DEX');
    await user.clear(dex);
    await user.type(dex, '19'); // 19+20+15+10+15+10+10 = 99

    // the string is the core's, verbatim — this screen never rewords a rejection
    expect(await screen.findByText('CRS weights must sum to 100 (currently 99).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(screen.getByText('sum 99 / 100')).toBeInTheDocument();
    // and nothing was written
    expect(sentinel.getConfig()).toBeNull();
  });

  it('accepts a valid change and saves it through saveConfig', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/config';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Config' });

    const dex = screen.getByLabelText('DEX');
    const crash = screen.getByLabelText('Crashes');
    await user.clear(dex);
    await user.type(dex, '25');
    await user.clear(crash);
    await user.type(crash, '15'); // back to 100

    expect(screen.queryByText(/CRS weights must sum to 100/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save configuration' });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(sentinel.getConfig()?.crsW).toMatchObject({ dex: 25, crash: 15 });
    expect(cfg.crsW.dex).toBe(25);
    expect(
      await screen.findByText('Saved. It applies on the next scoring pass.'),
    ).toBeInTheDocument();
  });

  it('rejects tiers that are not strictly descending, next to the tier fields', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/config';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Config' });

    const critical = screen.getByLabelText('CRITICAL');
    await user.clear(critical);
    await user.type(critical, '30'); // below HIGH (38)

    const card = screen.getByRole('region', { name: 'CRS tier edges' });
    expect(
      within(card).getByText(
        'CRS tiers must be strictly descending: CRITICAL > HIGH > ELEVATED > MONITOR ≥ 0.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
  });

  it('flags an owner-exclude pattern that is not a valid expression', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/config';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Config' });

    const first = screen.getByLabelText('Exclusion pattern 1');
    await user.clear(first);
    await user.click(first);
    await user.paste('^svc-[');

    const card = screen.getByRole('region', { name: 'Owner-exclusion patterns' });
    expect(
      within(card).getByText('An owner-exclude pattern is not a valid expression.'),
    ).toBeInTheDocument();
  });

  it('asks before resetting to defaults, then resets through the core', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/config';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Config' });

    await user.click(screen.getByRole('button', { name: /Reset to defaults/i }));
    expect(screen.getByText(/Reset every value above to the shipped defaults\?/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, reset' }));

    expect(sentinel.getConfig()).toBeNull();
    expect(currentConfig(cfg, sentinel).crsW).toEqual(CFG_DEFAULTS.crsW);
    expect(screen.getByLabelText('DEX')).toHaveValue('20');
  });
});

/* ============================================================
   Findings in, bulk
   ============================================================ */

describe('bulk findings paste', () => {
  beforeAll(() => commitWeeks(1));

  it('previews the parse before writing anything, and skips a device not in the run', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/investigate';
    render(<App />);
    await screen.findByRole('button', { name: /Findings in/i });
    await user.click(screen.getByRole('button', { name: /Findings in/i }));

    const sheet = await screen.findByRole('dialog');
    const known = sentinel.currentRun()!.rows[0].name as string;
    const box = within(sheet).getByLabelText(/Assistant findings block/i);

    await user.click(box);
    await user.paste(
      [
        '# a comment line, ignored',
        `${known}: state=triaged; component=SSD; cause=disk latency; action=replace drive`,
        'L-999999: state=actioned; component=RAM',
        'this line has no colon and cannot parse',
      ].join('\n'),
    );

    // the preview is the parse, not a guess at it
    expect(within(sheet).getByText(known)).toBeInTheDocument();
    expect(within(sheet).getByText('disk latency')).toBeInTheDocument();
    expect(within(sheet).getAllByText('L-999999').length).toBeGreaterThan(0);
    expect(within(sheet).getByText(/not in this run/)).toBeInTheDocument();
    const foot = sheet.querySelector('.sheet-foot') as HTMLElement;
    expect(foot.textContent).toContain('1 of 2 parsed lines will be applied');
    expect(foot.textContent).toContain('1 unknown device(s) skipped');
    expect(foot.textContent).toContain('1 line(s) unparseable');

    // nothing is written until the button is pressed
    expect(sentinel.getOverlay(known)).toEqual({});

    await user.click(within(sheet).getByRole('button', { name: /Apply 1 finding as an overlay/i }));

    expect(sentinel.getOverlay(known)).toMatchObject({
      component: 'SSD',
      cause: 'disk latency',
      action: 'replace drive',
    });
    expect(sentinel.getQueue(known).state).toBe('TRIAGED');
    // the frozen baseline row is untouched
    expect(sentinel.currentRun()!.rows.find((r) => r.name === known)).not.toHaveProperty('component');
    expect(within(sheet).getByText(/Applied 1 finding to the overlay/)).toBeInTheDocument();
  });
});

/* ============================================================
   Export / import
   ============================================================ */

describe('backup round trip through the UI', () => {
  beforeAll(() => commitWeeks(2));

  it('shows what will be replaced and how many committed runs the file holds, then restores it', async () => {
    const user = userEvent.setup();
    // take a backup of the two-week state, exactly as the Export button would
    const backup = sentinel.exportBlob();
    expect((JSON.parse(backup) as SentinelState).runHistory).toHaveLength(2);

    // now throw the state away, as a cleared browser profile would
    sentinel.reset();
    useSentinelStore.getState().touch();
    expect(sentinel.currentRun()).toBeNull();

    window.location.hash = '#/export';
    render(<App />);
    const sheet = await screen.findByRole('dialog', { name: /Backup/i });
    expect(within(sheet).getByText('never from this browser')).toBeInTheDocument();

    await user.upload(
      within(sheet).getByTestId('import-input'),
      new File([backup], 'sentinel-backup-2026-09-04.json', { type: 'application/json' }),
    );

    // the confirm step names the file and counts both sides
    const confirm = await within(sheet).findByRole('group', { name: 'Confirm restore' });
    expect(within(confirm).getByText('sentinel-backup-2026-09-04.json')).toBeInTheDocument();
    expect(within(confirm).getByTestId('incoming-runs')).toHaveTextContent('2');
    // still nothing restored — it asked first
    expect(sentinel.currentRun()).toBeNull();

    await user.click(within(confirm).getByRole('button', { name: 'Replace and restore' }));

    await waitFor(() => expect(sentinel.currentRun()).not.toBeNull());
    expect(sentinel.currentRun()!.weekEnding).toBe(WEEKS[1]);
    expect(sentinel.currentRun()!.rows).toHaveLength(300);
    expect(sentinel.load().runHistory).toHaveLength(2);
    // and the additive per-week record survived the trip, so Trends still has its series
    expect(readRunMeta(sentinel.load())).toHaveLength(2);
  });

  it('refuses a file that is not a Sentinel export, and says why', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/export';
    render(<App />);
    const sheet = await screen.findByRole('dialog', { name: /Backup/i });
    await user.upload(
      within(sheet).getByTestId('import-input'),
      new File(['{"hello":"world"}'], 'not-sentinel.json', { type: 'application/json' }),
    );
    expect(await within(sheet).findByText('not a Sentinel export')).toBeInTheDocument();
    expect(within(sheet).queryByRole('group', { name: 'Confirm restore' })).not.toBeInTheDocument();
  });
});

/* ============================================================
   Trends
   ============================================================ */

describe('Trends is honest about how many weeks it has', () => {
  it('with one committed run, shows the point and says a trend needs two weeks', async () => {
    commitWeeks(1);
    window.location.hash = '#/trends';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Trends' });

    expect(screen.getByText(/One committed run is a reading, not a trend/)).toBeInTheDocument();
    expect(screen.getAllByText(/A trend needs two committed weeks/).length).toBeGreaterThan(0);

    // the single point it does have is the real figure, not a placeholder
    const run = sentinel.currentRun()!;
    const dex = screen.getByRole('region', { name: 'Average DEX' });
    // once as the single emphasised value, once in the table beside it
    expect(within(dex).getAllByText(String(run.summary.avgDEX))).toHaveLength(2);
    // one row in the table alternative, because there is one committed week
    expect(within(dex).getAllByRole('row')).toHaveLength(2); // header + one week
  });

  it('with three committed weeks, every chart carries a three-row table alternative', async () => {
    commitWeeks(3);
    window.location.hash = '#/trends';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Trends' });

    expect(screen.queryByText(/One committed run is a reading/)).not.toBeInTheDocument();
    expect(screen.getByText(/3 committed weeks/)).toBeInTheDocument();

    for (const name of ['Average DEX', 'Average composite CRS', 'Tier movement', 'Hidden risk over time']) {
      const card = screen.getByRole('region', { name });
      expect(within(card).getByText(`${name} as a table`), name).toBeInTheDocument();
      expect(within(card).getAllByRole('row'), name).toHaveLength(4); // header + three weeks
    }

    // oldest first, and the weeks are the ones actually committed
    const rows = within(screen.getByRole('region', { name: 'Average DEX' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(WEEKS[0]);
    expect(rows[3]).toHaveTextContent(WEEKS[2]);
  });

  it('the tier stack is the full five tiers, because every week recorded one', () => {
    commitWeeks(3);
    const points = trendPoints(sentinel.load().runHistory, readRunMeta(sentinel.load()));
    expect(points).toHaveLength(3);
    expect(points.every((p) => p.full)).toBe(true);
    const run = sentinel.currentRun()!;
    expect(points[2].healthy).toBe(run.summary.tierCounts.HEALTHY);
  });

  it('says the ledger is insufficient rather than proposing a band change', async () => {
    commitWeeks(1);
    window.location.hash = '#/trends';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Trends' });
    const v = screen.getByRole('region', { name: 'Validation' });
    expect(within(v).getByText(/TUNING PROPOSAL · INSUFFICIENT/)).toBeInTheDocument();
    expect(within(v).getByText(/0\/20 graded outcomes/)).toBeInTheDocument();
  });
});

/* ============================================================
   Fleet
   ============================================================ */

describe('Fleet', () => {
  it('refuses to invent a delta on the first committed run', async () => {
    commitWeeks(1);
    window.location.hash = '#/fleet';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    const card = screen.getByRole('region', { name: 'What this run changed' });
    expect(within(card).getByText(/no prior committed run/)).toBeInTheDocument();
    expect(within(card).getByText(/will not invent a delta/)).toBeInTheDocument();
  });

  it('shows the guardrail under the tier bar, verbatim', async () => {
    commitWeeks(1);
    window.location.hash = '#/fleet';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });
    expect(
      screen.getByText(
        'Composite CRS is absolute. Triage rank is relative — percentile rank is never absolute risk.',
      ),
    ).toBeInTheDocument();
  });

  it('shows real tier and band deltas once there are two committed runs', async () => {
    commitWeeks(2);
    window.location.hash = '#/fleet';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Fleet' });

    const card = screen.getByRole('region', { name: 'What this run changed' });
    expect(within(card).getByText(`${WEEKS[0]} → ${WEEKS[1]}`)).toBeInTheDocument();
    // the same CSV twice means no movement, and the view says so rather than fudging
    const critical = within(card).getAllByRole('row').find((r) => r.textContent?.startsWith('CRITICAL'))!;
    expect(critical).toHaveTextContent('no change');
    // the HRI band table exists and is populated, which only the additive record makes possible
    expect(within(card).getByText('By HRI band')).toBeInTheDocument();
    expect(within(card).queryByText('not recorded')).not.toBeInTheDocument();
  });
});

/* ============================================================
   Phases
   ============================================================ */

describe('the fleet phases sheet', () => {
  beforeAll(() => commitWeeks(1));

  it('opens from Investigate with P6 first, marked READ FIRST, and persists a note', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/investigate';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /P1–P7 PHASES/i }));

    const sheet = await screen.findByRole('dialog', { name: /Fleet investigation phases/i });
    const heads = within(sheet).getAllByRole('button', { expanded: false });
    expect(within(sheet).getByText('READ FIRST')).toBeInTheDocument();
    // P6 is the first card and is the one already open
    const cards = sheet.querySelectorAll('.phase-card');
    expect(cards).toHaveLength(7);
    expect(cards[0].textContent).toContain('P6');
    expect(cards[0].textContent).toContain('READ FIRST');
    expect(heads.length).toBe(6); // the other six are collapsed

    // the query is the documented one, copyable
    expect(within(sheet).getByLabelText('P6 query').textContent).toContain(
      '| where score_count_ == 0',
    );

    const note = within(sheet).getByLabelText(/What you found/i);
    await user.click(note);
    await user.paste('Eleven unattended desktops, four with hard resets.');
    await user.click(within(sheet).getByRole('button', { name: 'Save note' }));

    expect(sentinel.getPhaseNote(6)).toBe('Eleven unattended desktops, four with hard resets.');
    expect(sentinel.currentRun()!.investigation?.phaseNotes['6']).toBe(
      'Eleven unattended desktops, four with hard resets.',
    );
  });
});

/* ============================================================
   Reports and the keyboard
   ============================================================ */

describe('Reports', () => {
  beforeAll(() => commitWeeks(1));

  it('generates each report from the core and uses the metrics box verbatim', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/reports';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Reports' });

    const out = () => screen.getByTestId('report-output').textContent ?? '';
    expect(out()).toContain('## Four Questions — Week ending 2026-08-21');

    const metrics = screen.getByLabelText(/One per line/i);
    await user.click(metrics);
    await user.paste('14 proactive tickets raised');
    expect(out()).toContain('- 14 proactive tickets raised');

    await user.click(screen.getByRole('button', { name: 'Weekly Status' }));
    expect(out()).toContain('## Weekly Status — Week ending 2026-08-21');
    expect(out()).toContain('- 14 proactive tickets raised');

    await user.click(screen.getByRole('button', { name: 'Executive Brief' }));
    expect(out()).toContain('## Executive Brief — Week ending 2026-08-21');
    // the Exec Brief takes no metrics box, and the screen disables it rather than lying
    expect(screen.getByLabelText(/One per line/i)).toBeDisabled();
  });

  it('the roundup sheet opens from Close and reads the changelog', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/close';
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'ROUNDUP' }));
    const sheet = await screen.findByRole('dialog', { name: /Weekly roundup/i });
    expect(within(sheet).getByTestId('roundup-output').textContent).toContain(
      '## Weekly Change Roundup — 2026-08-21',
    );
  });

  it('is reachable from the Close stage footer chips', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/close';
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'WEEKLY STATUS' }));
    expect(window.location.hash).toBe('#/reports?r=status');
    expect(await screen.findByRole('heading', { level: 2, name: 'Weekly Status' })).toBeInTheDocument();
  });
});

describe('the Score stage title', () => {
  beforeAll(() => commitWeeks(1));

  it('is the way up to Fleet', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/score';
    render(<App />);
    const title = await screen.findByRole('link', { name: /need a look this week/i });
    await user.click(title);
    expect(window.location.hash).toBe('#/fleet');
    expect(await screen.findByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  beforeAll(() => commitWeeks(1));

  it('? opens the shortcuts sheet and 1-5 move between stages', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/score';
    render(<App />);
    await screen.findByRole('heading', { level: 1 });

    await user.keyboard('?');
    const sheet = await screen.findByRole('dialog', { name: 'Keyboard' });
    expect(within(sheet).getByText('Next machine')).toBeInTheDocument();
    expect(within(sheet).getByText(/Focus the queue filter/)).toBeInTheDocument();

    // a sheet stands the stage keys down; Escape closes it
    await user.keyboard('4');
    expect(window.location.hash).toBe('#/score');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.keyboard('4');
    await waitFor(() => expect(window.location.hash).toBe('#/work'));
    await user.keyboard('1');
    await waitFor(() => expect(window.location.hash).toBe('#/pull'));
  });

  it('does not fire while a field has focus', async () => {
    const user = userEvent.setup();
    window.location.hash = '#/reports';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Reports' });
    const metrics = screen.getByLabelText(/One per line/i);
    await user.click(metrics);
    await user.keyboard('3 devices refreshed');
    expect(window.location.hash).toBe('#/reports');
    expect(metrics).toHaveValue('3 devices refreshed');
  });
});
