/* ============================================================
   ShortcutsSheet.tsx — press ? to see what the keyboard does.

   Only keys that actually exist are listed. A shortcuts sheet that
   documents a binding the app does not have is worse than no sheet.
   ============================================================ */

import { Sheet } from '@/app/components/Sheet';

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: 'The week',
    keys: [
      [['1'], 'Pull — get the export in and freeze it'],
      [['2'], 'Score — what the run says about the fleet'],
      [['3'], 'Investigate — record a finding per machine'],
      [['4'], 'Work — set state, draft the proactive ticket'],
      [['5'], 'Close — record what actually happened'],
    ],
  },
  {
    title: 'Moving through the queue',
    keys: [
      [['J'], 'Next machine'],
      [['K'], 'Previous machine'],
      [['↑', '↓'], 'Move the selection, with the queue list focused'],
      [['Home', 'End'], 'First / last machine in the queue'],
      [['Enter', 'Space'], 'Open the focused queue row'],
    ],
  },
  {
    title: 'Everywhere',
    keys: [
      [['/'], 'Focus the queue filter'],
      [['Esc'], 'Clear the filter · close a sheet'],
      [['?'], 'This sheet'],
      [['Tab'], 'Every control is reachable, in reading order'],
    ],
  },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet
      title="Keyboard"
      subtitle="Suppressed while you are typing in a field, and while a sheet is open — except Escape, which closes it."
      closeLabel="Close the keyboard sheet"
      onClose={onClose}
      width={520}
    >
      {GROUPS.map((g) => (
        <section key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3 className="card-title">{g.title}</h3>
          <dl className="keys">
            {g.keys.map(([keys, what]) => (
              <div key={what} style={{ display: 'contents' }}>
                <dt style={{ whiteSpace: 'nowrap' }}>
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i ? <span style={{ color: 'var(--dim)' }}> / </span> : null}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd style={{ margin: 0, color: 'var(--body)' }}>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="card-note">
        The five stage keys work from any screen, including the lenses. Nothing here is a
        modifier chord — the console is meant to be worked one-handed while the other hand is on a
        Nexthink window.
      </p>
    </Sheet>
  );
}
