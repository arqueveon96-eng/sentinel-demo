/* ============================================================
   ExportSheet.tsx — the button that was always missing.

   The original console documented "export a backup monthly" as
   the durable record and shipped `exportBlob()` / `importBlob()` with
   no UI for either. A week of findings could be lost to a cleared
   browser profile and there was nothing on screen to prevent it.

   So: download the whole `sentinel.v1` blob as a dated file, and
   restore one — with a confirm step that says, in numbers, what is
   about to be replaced and what is arriving. Import is destructive by
   nature (the core's `importBlob` replaces the state object outright),
   and this screen never lets that happen in one click.
   ============================================================ */

import { useRef, useState } from 'react';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import type { SentinelState } from '@/core/types';
import { sentinel, useSentinelStore } from '@/store/sentinel.store';
import { downloadText } from '@/lib/clipboard';
import { useBlob } from '@/app/lib/derived';
import { Sheet } from '@/app/components/Sheet';

function backupName(): string {
  return `sentinel-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

interface Incoming {
  name: string;
  text: string;
  weekEnding: string | null;
  rows: number;
  runs: number;
  outcomes: number;
  changelog: number;
  updated: string | null;
}

function inspect(name: string, text: string): Incoming {
  const o = JSON.parse(text) as SentinelState;
  if (!o || typeof o !== 'object' || !o.schemaVersion) throw new Error('not a Sentinel export');
  return {
    name,
    text,
    weekEnding: o.committedRun?.weekEnding ?? null,
    rows: o.committedRun?.rows?.length ?? 0,
    runs: Array.isArray(o.runHistory) ? o.runHistory.length : 0,
    outcomes: Array.isArray(o.outcomes) ? o.outcomes.length : 0,
    changelog: Array.isArray(o.changelog) ? o.changelog.length : 0,
    updated: o.updated ?? null,
  };
}

export function ExportSheet({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const blob = useBlob();
  const importBlob = useSentinelStore((s) => s.importBlob);
  const markExported = useSentinelStore((s) => s.markExported);
  const fileRef = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lastExport = (blob as SentinelState & { lastExport?: string }).lastExport ?? null;

  async function chose(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    setErr(null);
    try {
      setIncoming(inspect(f.name, await f.text()));
    } catch (e) {
      setIncoming(null);
      setErr(
        e instanceof SyntaxError
          ? 'That file is not JSON. A Sentinel backup is the .json this sheet downloads.'
          : e instanceof Error
            ? e.message
            : 'That is not a Sentinel export.',
      );
    }
  }

  function restore() {
    if (!incoming) return;
    try {
      importBlob(incoming.text);
      setIncoming(null);
      say(`Backup restored from ${incoming.name}.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That is not a Sentinel export.');
    }
  }

  return (
    <Sheet
      title="Backup"
      subtitle="State lives in this browser and nowhere else. The exported file is the durable record."
      closeLabel="Close the backup sheet"
      onClose={onClose}
      width={620}
    >
      {/* ---------- export ---------- */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <h3 className="card-title">Export backup</h3>
        <p className="card-note">
          Downloads the whole store as{' '}
          <span className="mono" style={{ color: 'var(--dim-hi)' }}>
            {backupName()}
          </span>{' '}
          — the committed run, every finding, the changelog, the outcome ledger and your config, in
          the same <span className="mono">sentinel.v1</span> shape the original console reads. Take
          one monthly and put it somewhere that is not this laptop.
        </p>
        <dl className="kv">
          <dt>committed run</dt>
          <dd className="mono">
            {blob.committedRun
              ? `${blob.committedRun.weekEnding} · ${blob.committedRun.rows.length} rows`
              : 'none'}
          </dd>
          <dt>committed weeks</dt>
          <dd className="mono">{blob.runHistory.length}</dd>
          <dt>changelog</dt>
          <dd className="mono">{blob.changelog.length} entries</dd>
          <dt>outcomes</dt>
          <dd className="mono">{blob.outcomes.length}</dd>
          <dt>store updated</dt>
          <dd className="mono">{blob.updated ?? '—'}</dd>
          <dt>last export</dt>
          <dd className="mono" style={{ color: lastExport ? undefined : 'var(--amber)' }}>
            {lastExport ? lastExport.slice(0, 10) : 'never from this browser'}
          </dd>
        </dl>
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: 'fit-content' }}
          onClick={() => {
            downloadText(backupName(), sentinel.exportBlob());
            markExported();
            say('Backup downloaded.');
          }}
        >
          <Download size={14} aria-hidden />
          Export backup
        </button>
      </section>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-2)', margin: '2px 0' }} />

      {/* ---------- import ---------- */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <h3 className="card-title">Import backup</h3>
        <p className="card-note">
          Restoring <b style={{ color: 'var(--amber)' }}>replaces everything in this browser</b> with
          the contents of the file. It is not a merge. You will see what is being replaced before it
          happens.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="import-input"
          onChange={(e) => void chose(e.target.files)}
        />
        <button
          type="button"
          className="btn"
          style={{ width: 'fit-content' }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={14} aria-hidden />
          Choose a backup file
        </button>

        {err ? (
          <p className="err" role="alert">
            <TriangleAlert size={12} aria-hidden style={{ flex: 'none', marginTop: 1 }} />
            {err}
          </p>
        ) : null}

        {incoming ? (
          <div
            className="note"
            style={{
              flexDirection: 'column',
              gap: 10,
              background: 'rgb(240 160 32 / 0.07)',
              borderColor: 'rgb(240 160 32 / 0.35)',
            }}
            role="group"
            aria-label="Confirm restore"
          >
            <b style={{ fontSize: 12.5 }}>
              Replace this browser&apos;s state with{' '}
              <span className="mono">{incoming.name}</span>?
            </b>
            <table className="dtable" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th />
                  <th className="num">In this browser now</th>
                  <th className="num">In the file</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Committed run</td>
                  <td className="num mono">{blob.committedRun?.weekEnding ?? 'none'}</td>
                  <td className="num mono">{incoming.weekEnding ?? 'none'}</td>
                </tr>
                <tr>
                  <td>Devices in that run</td>
                  <td className="num mono">{blob.committedRun?.rows.length ?? 0}</td>
                  <td className="num mono">{incoming.rows}</td>
                </tr>
                <tr>
                  <td>Committed runs held</td>
                  <td className="num mono">{blob.runHistory.length}</td>
                  <td className="num mono" data-testid="incoming-runs">
                    {incoming.runs}
                  </td>
                </tr>
                <tr>
                  <td>Recorded outcomes</td>
                  <td className="num mono">{blob.outcomes.length}</td>
                  <td className="num mono">{incoming.outcomes}</td>
                </tr>
                <tr>
                  <td>Changelog entries</td>
                  <td className="num mono">{blob.changelog.length}</td>
                  <td className="num mono">{incoming.changelog}</td>
                </tr>
                <tr>
                  <td>Last written</td>
                  <td className="num mono">{blob.updated?.slice(0, 10) ?? '—'}</td>
                  <td className="num mono">{incoming.updated?.slice(0, 10) ?? '—'}</td>
                </tr>
              </tbody>
            </table>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dim)' }}>
              The left column is gone after this. If it holds work you have not exported, cancel and
              export it first.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={restore}>
                Replace and restore
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setIncoming(null);
                  if (fileRef.current) fileRef.current.value = '';
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <hr style={{ border: 0, borderTop: '1px solid var(--line-2)', margin: '2px 0' }} />

      <p className="card-note">
        Where this actually lives: one JSON object under the{' '}
        <span className="mono">sentinel.v1</span> key in this browser&apos;s local storage, for this
        profile, on this machine. Clearing site data, a new browser or a rebuilt laptop all lose it.
        A backup taken here opens in the original console and the other way round — the shape is
        identical.
      </p>
    </Sheet>
  );
}
