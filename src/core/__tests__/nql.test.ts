/* ============================================================
   nql.test.ts — the queries the copy buttons hand over must be
   scoped, must carry the raw counts HRI needs, and must never carry
   an unescaped device name.
   ============================================================ */

import { describe, expect, it } from 'vitest';
import {
  DEMO_ENTITY,
  investigationQueries,
  nqlLiteral,
  p2Query,
  p6Query,
  p7Query,
} from '@/core/nql';
import { SCHEMA_MAP } from '@/core/ingest';

const KNOWN_COLUMNS = new Set(Object.values(SCHEMA_MAP).flat());

describe('p7Query', () => {
  it('substitutes the device name into the where clause', () => {
    expect(p7Query('DEMO-LT-0147')).toContain('| where device.name == "DEMO-LT-0147"');
  });

  it('strips quotes and backslashes so the literal cannot be broken out of', () => {
    expect(nqlLiteral('L-1"; drop')).toBe('L-1; drop');
    expect(p7Query('L-1"\\x')).toContain('| where device.name == "L-1x"');
  });

  it('pulls the raw HRI inputs, under the column names the ingester reads', () => {
    const q = p7Query('DEMO-LT-0001');
    for (const field of ['total_hard_resets_', 'total_system_crashes_', 'last_bugcheck_code_']) {
      expect(q).toContain(field);
      expect(KNOWN_COLUMNS.has(field)).toBe(true);
    }
  });

  it('handles an empty name without emitting a broken clause', () => {
    expect(p7Query(null)).toContain('| where device.name == ""');
  });
});

describe('p6Query / p2Query', () => {
  it('P6 keeps the score_count_ == 0 filter that defines DEX-ineligible', () => {
    expect(p6Query()).toContain('| where score_count_ == 0');
  });

  it('both stay scope-locked to the placeholder entity and physical endpoints', () => {
    for (const q of [p6Query(), p2Query()]) {
      expect(q).toContain(`| where device.entity == "${DEMO_ENTITY}"`);
      expect(q).toContain('| where device.hardware.type != virtual');
    }
  });

  it('P2 pulls the raw counts HRI is built on, not the saturated subscores', () => {
    const q = p2Query();
    expect(q).toContain('total_hard_resets_');
    expect(q).toContain('total_system_crashes_');
    expect(q).not.toContain('score.endpoint');
  });
});

describe('investigationQueries', () => {
  it('offers P6 first, then P2, then the device-specific P7', () => {
    const qs = investigationQueries('DEMO-LT-0147');
    expect(qs.map((q) => q.id)).toEqual(['P6', 'P2', 'P7']);
    expect(qs[0].when).toBe('read first');
    expect(qs[2].text).toContain('DEMO-LT-0147');
  });
});
