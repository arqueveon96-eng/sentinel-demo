/* ============================================================
   phases.test.ts — the seven fleet-level phases.

   The point of this suite is drift between the query the operator is
   told to run and the file the console then ingests. P4 is the weekly
   export: every column it lists must be one ingest.ts actually reads,
   and every CRS / HRI input the ingester looks for must be in it.
   Otherwise a "clean" export silently scores every device STABLE.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  P4_QUERY,
  P5_DATE_PLACEHOLDER,
  fleetPhases,
  mondayOf,
  p5Query,
} from '@/core/phases';
import { DEMO_ENTITY } from '@/core/nql';
import { COLUMN_ROLES, SCHEMA_MAP, resolveHeaders } from '@/core/ingest';

/** The field names a query lists, i.e. the CSV header it would export. */
function listedColumns(q: string): string[] {
  return q
    .slice(q.indexOf('| list') + '| list'.length)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('the export query and the ingester cannot drift apart', () => {
  it('every column P4 lists is one the ingester reads', () => {
    const known = new Set(Object.values(SCHEMA_MAP).flat());
    const cols = listedColumns(P4_QUERY);
    expect(cols.length).toBeGreaterThan(10);
    for (const col of cols) expect(known.has(col), col).toBe(true);
  });

  it('P4 carries every CRS and HRI input the ingester looks for', () => {
    const map = resolveHeaders(listedColumns(P4_QUERY));
    for (const role of COLUMN_ROLES) expect(map[role.field], role.role).toBeDefined();
  });

  it('every fleet phase stays scope-locked to the placeholder entity and physical endpoints', () => {
    // P7 is single-device by name, so the fleet scope lines do not apply to it
    fleetPhases('2026-09-04')
      .filter((p) => p.id !== 'P7')
      .forEach((p) => {
        expect(p.query, p.id).toContain(`| where device.entity == "${DEMO_ENTITY}"`);
        expect(p.query, p.id).toContain('| where device.hardware.type != virtual');
      });
  });
});

describe('fleetPhases', () => {
  it('puts P6 first and marks it READ FIRST', () => {
    const ps = fleetPhases('2026-09-04');
    expect(ps[0].id).toBe('P6');
    expect(ps[0].readFirst).toBe(true);
    expect(ps.filter((p) => p.readFirst)).toHaveLength(1);
  });

  it('offers all seven, numbered as Store.savePhaseNote has always keyed them', () => {
    const ps = fleetPhases(null);
    expect(ps).toHaveLength(7);
    expect(ps.map((p) => p.n).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(ps.map((p) => p.id)).size).toBe(7);
  });

  it('every card carries a question, a runnable query, a reading and a write-back', () => {
    fleetPhases('2026-09-04').forEach((p) => {
      expect(p.question.length, p.id).toBeGreaterThan(10);
      expect(p.query.split('\n').length, p.id).toBeGreaterThan(4);
      expect(p.howToRead.length, p.id).toBeGreaterThan(60);
      expect(p.writeBack.length, p.id).toBeGreaterThan(40);
    });
  });

  it('P6 keeps the score_count_ == 0 filter that defines DEX-ineligible', () => {
    expect(fleetPhases(null)[0].query).toContain('| where score_count_ == 0');
  });

  it('P7 carries a placeholder, not an empty device name', () => {
    const p7 = fleetPhases(null).find((p) => p.id === 'P7')!;
    expect(p7.query).toContain('| where device.name == "<DEVICE_NAME>"');
  });
});

describe('P5 date substitution', () => {
  it('mondayOf walks a Friday week-ending back to its Monday', () => {
    expect(mondayOf('2026-09-04')).toBe('2026-08-31'); // Friday -> Monday
    expect(mondayOf('2026-08-31')).toBe('2026-08-31'); // already a Monday
    expect(mondayOf('nonsense')).toBeNull();
    expect(mondayOf(null)).toBeNull();
  });

  it('substitutes that Monday into the query and leaves it alone otherwise', () => {
    expect(p5Query('2026-08-31')).toContain('on 2026-08-31');
    expect(p5Query('2026-08-31')).not.toContain(P5_DATE_PLACEHOLDER);
    expect(p5Query(null)).toContain(P5_DATE_PLACEHOLDER);
    expect(p5Query('not-a-date')).toContain(P5_DATE_PLACEHOLDER);
  });

  it('the fleet card for P5 uses the committed week’s Monday', () => {
    const p5 = fleetPhases('2026-09-04').find((p) => p.id === 'P5')!;
    expect(p5.query).toContain('on 2026-08-31');
  });
});
