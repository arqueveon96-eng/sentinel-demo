/* ============================================================
   RoundupSheet.tsx — the weekly change roundup.

   Straight out of the core's `formatRoundup()`: every field this week's
   findings and state changes wrote, grouped by device, with the source
   of each change. It is the audit trail in prose, and it is the thing
   to paste into the team channel on a Friday.

   Nothing here is computed twice. If the changelog is empty it says so
   rather than producing a report about nothing.
   ============================================================ */

import { useMemo, useState } from 'react';
import { Download, Eraser } from 'lucide-react';
import { formatRoundup } from '@/core/handoff';
import { sentinel, useSentinelStore } from '@/store/sentinel.store';
import { downloadText } from '@/lib/clipboard';
import { useBlob, useRun } from '@/app/lib/derived';
import { CopyButton } from '@/app/components/bits';
import { Sheet } from '@/app/components/Sheet';

export function RoundupSheet({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const blob = useBlob();
  const run = useRun();
  const touch = useSentinelStore((s) => s.touch);
  const [confirmClear, setConfirmClear] = useState(false);
  const text = useMemo(() => formatRoundup(sentinel), [blob]);
  const devices = useMemo(
    () => new Set(blob.changelog.map((c) => c.device)).size,
    [blob.changelog],
  );

  return (
    <Sheet
      title="Weekly roundup"
      subtitle={
        <>
          {blob.changelog.length} change{blob.changelog.length === 1 ? '' : 's'} across {devices}{' '}
          device{devices === 1 ? '' : 's'}, from the changelog — every field, with who wrote it.
        </>
      }
      closeLabel="Close the roundup sheet"
      onClose={onClose}
      width={680}
      foot={
        <>
          <CopyButton
            className="btn btn-teal"
            text={() => text}
            onDone={(ok) => say(ok ? 'Roundup copied.' : 'Copy blocked by the browser.')}
          >
            Copy
          </CopyButton>
          <button
            type="button"
            className="btn"
            onClick={() => {
              downloadText(`sentinel-roundup-${run?.weekEnding ?? 'unscored'}.md`, text);
              say('Roundup downloaded.');
            }}
          >
            <Download size={13} aria-hidden />
            Download .md
          </button>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {confirmClear ? (
              <>
                <span style={{ fontSize: 11, color: 'var(--amber)' }}>
                  Clear all {blob.changelog.length} entries?
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    sentinel.clearChangelog();
                    touch();
                    setConfirmClear(false);
                    say('Changelog cleared.');
                  }}
                >
                  Yes, clear
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                disabled={!blob.changelog.length}
                onClick={() => setConfirmClear(true)}
                title="Start a fresh changelog for next week"
              >
                <Eraser size={12} aria-hidden />
                Clear changelog
              </button>
            )}
          </span>
        </>
      }
    >
      <pre className="report-out" data-testid="roundup-output">
        {text}
      </pre>
      <p className="card-note">
        The changelog accumulates until it is cleared, which is also why the reports&apos; &ldquo;what
        improved&rdquo; section reaches back past this week (B-06). Clearing it after the Friday
        roundup is what the original console assumed you would do — and it is the one action here
        that loses information, so it asks first.
      </p>
    </Sheet>
  );
}
