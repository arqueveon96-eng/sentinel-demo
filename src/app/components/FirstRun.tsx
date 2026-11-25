/* ============================================================
   FirstRun.tsx — what a view says before there is anything to say.

   Every screen that reads a committed run needs one of these, and it
   should read like a sentence rather than an error: what this view is
   for, why it is empty, and the one button that fixes it.
   ============================================================ */

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

export function FirstRun({
  title,
  what,
  extra,
}: {
  /** the view's own name, so the heading still reads as the page you asked for */
  title: string;
  /** "…this view shows X" — a lower-case fragment, no full stop */
  what: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="stage-page">
      <div className="lens" style={{ maxWidth: 640 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1 className="page-title">{title}</h1>
          <p>Nothing is committed yet.</p>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--body)', lineHeight: 1.65 }}>
          This is {what}. It reads the frozen baseline, and there is not one yet — so rather than
          show you an empty frame with zeroes in it, it is saying so. Drop this week&apos;s Nexthink
          export (or the synthetic <span className="mono">demo/sample-fleet.csv</span>) on the Pull
          stage and commit it.
        </p>
        {extra}
        <Link className="btn btn-primary" to="/pull" style={{ width: 'fit-content' }}>
          Go to Pull
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
