/* ============================================================
   PanelShell.tsx — the green-bordered stage panel's frame.
   Same chrome in all three stages, so the only thing that visibly
   changes between them is the ask.
   ============================================================ */

export function PanelShell({
  stage,
  ask,
  hint,
  children,
  foot,
  cols = '1fr 1fr',
}: {
  /** e.g. "STAGE 3 · INVESTIGATE" */
  stage: string;
  ask: string;
  hint: string;
  children: React.ReactNode;
  foot: React.ReactNode;
  cols?: string;
}) {
  return (
    <section className="panel" aria-label={stage}>
      <div className="panel-head">
        <span className="mono panel-stage">{stage}</span>
        <h2 className="panel-ask">{ask}</h2>
        <span className="panel-hint">{hint}</span>
      </div>
      <div
        className="panel-cols"
        style={{ gridTemplateColumns: `minmax(0, ${cols.split(' ')[0]}) minmax(0, ${cols.split(' ')[1]})` }}
      >
        {children}
      </div>
      <div className="panel-foot">{foot}</div>
    </section>
  );
}
