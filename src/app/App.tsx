/* ============================================================
   App.tsx — the shell.

   HashRouter, not BrowserRouter: the production build must open by
   double-clicking dist/index.html from file://, where a path-based
   router has no server to resolve routes against. Paired with
   `base: './'` in vite.config.ts. This is a hard product requirement.

   One frame for the whole week: identity and lenses on top, the stage
   rail as the only primary navigation, the stage's own screen under
   it, and the guardrails on screen at all times.

   PHASE 3 adds two things to this file and nothing else:

   1. The app-level sheets. Export, the keyboard sheet, the fleet
      phases, bulk findings and the weekly roundup are opened from four
      different screens and rendered once, here, so a sheet is never
      trapped inside the component that happened to open it.
   2. The global keys: `?` for the keyboard sheet and 1-5 for the five
      stages, both suppressed while a field or a sheet has focus.
   ============================================================ */

import { useEffect } from 'react';
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useRun, useStages } from '@/app/lib/derived';
import { nowStage, STAGE_IDS, type StageId } from '@/app/lib/stages';
import { useUi } from '@/app/lib/ui.store';
import { Guardrails, TopStrip } from '@/app/shell/TopStrip';
import { StageRail } from '@/app/shell/StageRail';
import { LiveRegion, useAnnouncer } from '@/app/components/bits';
import { PullRoute } from './routes/PullRoute';
import { ScoreRoute } from './routes/ScoreRoute';
import { WorkspaceRoute } from './routes/WorkspaceRoute';
import { FleetRoute } from './routes/FleetRoute';
import { TrendsRoute } from './routes/TrendsRoute';
import { ConfigRoute } from './routes/ConfigRoute';
import { ReportsRoute } from './routes/ReportsRoute';
import { ExportSheet } from './sheets/ExportSheet';
import { FindingsSheet } from './sheets/FindingsSheet';
import { PhasesSheet } from './sheets/PhasesSheet';
import { RoundupSheet } from './sheets/RoundupSheet';
import { ShortcutsSheet } from './sheets/ShortcutsSheet';

/** `/investigate` → `investigate`; anything else → null (a lens, not a stage). */
function stageOf(pathname: string): StageId | null {
  const seg = pathname.replace(/^\//, '').split('/')[0];
  return (STAGE_IDS as string[]).includes(seg) ? (seg as StageId) : null;
}

const STAGE_KEYS: Record<string, StageId> = {
  '1': 'pull',
  '2': 'score',
  '3': 'investigate',
  '4': 'work',
  '5': 'close',
};

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const run = useRun();
  const stages = useStages();
  const current = stageOf(location.pathname);
  const sheet = useUi((s) => s.sheet);
  const openSheet = useUi((s) => s.openSheet);
  const closeSheet = useUi((s) => s.closeSheet);
  const [msg, say] = useAnnouncer();

  /* Landing: the stage with work left, or Pull when there is no run.
     Only on the bare root — never a redirect out from under the operator. */
  useEffect(() => {
    if (location.pathname === '/' || location.pathname === '') {
      navigate(run ? `/${nowStage(stages)}` : '/pull', { replace: true });
    }
  }, [location.pathname, run, stages, navigate]);

  /* Export is a sheet, not a page — it is a thing you do to the store,
     not a place in the week. `/export` in the utility corner therefore
     opens the sheet over wherever you were and puts the URL back, so
     the link still resolves (including typed cold into the address bar)
     without inventing a screen for it. */
  useEffect(() => {
    if (location.pathname !== '/export') return;
    openSheet('export');
    navigate(run ? `/${nowStage(stages)}` : '/pull', { replace: true });
  }, [location.pathname, run, stages, navigate, openSheet]);

  /* `?` opens the keyboard sheet; 1-5 jump between the five stages.
     Never while a field has focus, and never while a sheet is open —
     a sheet handles its own Escape and nothing else. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '?') {
        e.preventDefault();
        openSheet('shortcuts');
        return;
      }
      const stage = STAGE_KEYS[e.key];
      if (stage) {
        e.preventDefault();
        navigate(`/${stage}`);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, openSheet]);

  return (
    <div className="shell">
      <TopStrip weekEnding={run?.weekEnding ?? null} onShortcuts={() => openSheet('shortcuts')} />
      <StageRail stages={stages} current={current ?? 'pull'} />
      <Routes>
        <Route path="/pull" element={<PullRoute />} />
        <Route path="/score" element={<ScoreRoute />} />
        <Route path="/investigate" element={<WorkspaceRoute stage="investigate" />} />
        <Route path="/work" element={<WorkspaceRoute stage="work" />} />
        <Route path="/close" element={<WorkspaceRoute stage="close" />} />
        <Route path="/fleet" element={<FleetRoute />} />
        <Route path="/trends" element={<TrendsRoute />} />
        <Route path="/config" element={<ConfigRoute />} />
        <Route path="/reports" element={<ReportsRoute />} />
        <Route path="/export" element={<PullRoute />} />
        <Route path="/" element={<PullRoute />} />
        <Route path="*" element={<Navigate to="/pull" replace />} />
      </Routes>
      <Guardrails />

      {sheet === 'export' ? <ExportSheet onClose={closeSheet} say={say} /> : null}
      {sheet === 'shortcuts' ? <ShortcutsSheet onClose={closeSheet} /> : null}
      {sheet === 'findings' ? <FindingsSheet onClose={closeSheet} say={say} /> : null}
      {sheet === 'roundup' ? <RoundupSheet onClose={closeSheet} say={say} /> : null}
      {sheet === 'phases' && run ? (
        <PhasesSheet run={run} onClose={closeSheet} say={say} />
      ) : null}
      <LiveRegion message={msg} />
    </div>
  );
}

export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
