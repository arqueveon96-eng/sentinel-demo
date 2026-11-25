#!/usr/bin/env python3
"""
Walkthrough verification of the supporting views.

Requires: pip install playwright && playwright install chromium
Set CHROMIUM_PATH to use a specific Chromium binary instead.

Opens dist/index.html straight from file:// in Chromium (no server) and walks
the supporting views the way an operator would:

  - three commits of the sample CSV under three different week-ending dates
  - Trends: three points on each line, three stacked bars, tables beside them
  - Fleet: real deltas between run 2 and run 3
  - Config: weights summing to 99 rejected with the core's own message inline,
    then a valid change accepted
  - Reports: Copy produces text
  - Export: the backup downloads; a wiped store is restored from it
  - Phases: the sheet opens with P6 first and a note survives a reload
  - keyboard: ? opens the shortcuts sheet, 1-5 move between stages
  - contrast: every text node on every new view against the 4.5:1 floor
  - a second pass under prefers-reduced-motion

Screenshots land in shots/. Zero console errors, page errors or failed
requests is a pass condition, not a nice-to-have.
"""

import json
import os
import pathlib
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "index.html"
CSV = ROOT / "demo" / "sample-fleet.csv"
EXPECTED = sum(1 for line in CSV.read_text(encoding="utf-8").splitlines()[1:] if line.strip())
SHOTS = ROOT / "shots"
SHOTS.mkdir(exist_ok=True)
WEEKS = ["2026-08-21", "2026-08-28", "2026-09-04"]

if not DIST.exists():
    sys.exit(f"missing {DIST} — run `npm run build` first")

R: dict = {}
failures: list[str] = []


def check(name: str, ok: bool, detail=""):
    R[name] = ok if not detail else detail
    if not ok:
        failures.append(f"{name}: {detail or 'false'}")


# ---------------------------------------------------------------- contrast
CONTRAST_JS = r"""
() => {
  const lum = ([r,g,b]) => { const f = v => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if(!m) return null;
    const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number);
    return { c:[p[0],p[1],p[2]], a: p.length>3? p[3] : 1 }; };
  const over = (fg, bg) => fg.c.map((v,i)=> v*fg.a + bg[i]*(1-fg.a));
  const bgOf = (el) => { let cur = el, stack = [];
    while (cur && cur !== document.documentElement) {
      const s = getComputedStyle(cur); const p = parse(s.backgroundColor);
      if (p && p.a > 0) stack.push(p);
      if (p && p.a >= 1) break;
      cur = cur.parentElement; }
    let base = [10,14,20];
    for (let i = stack.length-1; i>=0; i--) base = over(stack[i], base);
    return base; };
  const bad = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.textContent||'').trim(); if (!t) continue;
    const el = n.parentElement; if (!el) continue;
    if (el.closest('.sr-only') || el.classList.contains('sr-only')) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    if (!el.getClientRects().length) continue;
    const fg = parse(s.color); if (!fg) continue;
    const bg = bgOf(el);
    const c = over(fg, bg);
    const L1 = lum(c), L2 = lum(bg);
    const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    const size = parseFloat(s.fontSize), weight = parseInt(s.fontWeight)||400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    if (ratio < floor - 0.005) {
      const key = s.color + '|' + size + '|' + el.className;
      if (seen.has(key)) continue; seen.add(key);
      bad.push({ text: t.slice(0,40), color: s.color, size, weight,
                 ratio: +ratio.toFixed(2), floor, cls: String(el.className).slice(0,50) });
    }
  }
  return bad;
}
"""


def run(pw, reduced=False):
    console, page_errors, failed = [], [], []
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or None, args=["--no-sandbox"])
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 900},
        reduced_motion="reduce" if reduced else "no-preference",
    )
    page = ctx.new_page()
    page.on("console", lambda m: console.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("requestfailed", lambda r: failed.append(f"{r.url} :: {r.failure}"))
    page.goto(f"{DIST.as_uri()}#/pull")
    page.wait_for_selector("h1:has-text('Pull')", timeout=15000)
    return browser, ctx, page, console, page_errors, failed


def goto(page, hashpath, heading=None):
    page.evaluate(f"location.hash = '{hashpath}'")
    if heading:
        page.wait_for_selector(f"h1:has-text('{heading}')", timeout=10000)
    page.wait_for_timeout(160)


def commit(page, week):
    goto(page, "#/pull", "Pull")
    page.fill("#week", week)
    page.set_input_files("[data-testid='csv-input']", str(CSV))
    page.wait_for_selector("[data-testid='ingest-report']", timeout=20000)
    page.click("button:has-text('Commit run & score')")
    page.wait_for_function("() => location.hash === '#/score'", timeout=20000)


def contrast(page, where, bucket):
    bad = page.evaluate(CONTRAST_JS)
    if bad:
        bucket.append({"view": where, "failures": bad})



# A shot of a whole lens page. The shell is height:100vh with an inner
# scroller, so Playwright's full_page would capture the viewport plus a
# blank tail; releasing the two height constraints for the shot gives the
# page as it actually reads end to end.
UNCLAMP = """() => {
  const sh = document.querySelector('.shell'); const pg = document.querySelector('.stage-page');
  if (sh) { sh.dataset._h = sh.style.height; sh.style.height='auto'; sh.style.minHeight='0'; sh.style.overflow='visible'; }
  if (pg) { pg.style.overflow='visible'; }
}"""
RECLAMP = """() => {
  const sh = document.querySelector('.shell'); const pg = document.querySelector('.stage-page');
  if (sh) { sh.style.height='100vh'; sh.style.minHeight='100vh'; sh.style.overflow='hidden'; }
  if (pg) { pg.style.overflow='auto'; }
}"""


def shot(page, name, full=False):
    if full:
        page.evaluate(UNCLAMP)
        page.wait_for_timeout(220)
        page.screenshot(path=str(SHOTS / name), full_page=True)
        page.evaluate(RECLAMP)
        page.wait_for_timeout(120)
    else:
        page.screenshot(path=str(SHOTS / name))


def main():
    contrast_fail: list = []
    with sync_playwright() as pw:
        browser, ctx, page, console, page_errors, failed = run(pw)

        # ---------------------------------------------------------- 1. three commits
        for w in WEEKS:
            commit(page, w)
        hist = page.evaluate("JSON.parse(localStorage.getItem('sentinel.v1')).runHistory.map(h=>h.weekEnding)")
        meta = page.evaluate("(JSON.parse(localStorage.getItem('sentinel.v1')).runMeta||[]).map(m=>m.weekEnding)")
        check("committed_weeks", sorted(hist) == WEEKS, sorted(hist))
        check("runmeta_weeks", sorted(meta) == WEEKS, sorted(meta))

        # ---------------------------------------------------------- 2. Trends
        goto(page, "#/trends", "Trends")
        page.wait_for_selector(".recharts-surface", timeout=10000)
        R["trends_header"] = page.inner_text(".page-head p").strip()
        # line charts: one path per series, dots per point
        dots = page.eval_on_selector_all(
            ".recharts-line-dots circle, .recharts-area-dots circle", "els => els.map(e => e.getAttribute('r'))"
        )
        R["trend_dot_radii"] = dots
        check("trend_three_points_per_line", dots.count("2.5") + dots.count("4") >= 9, dots)
        check("trend_last_point_emphasised", dots.count("4") >= 3, f"{dots.count('4')} emphasised dots")
        bars = page.eval_on_selector_all(".recharts-bar-rectangle", "els => els.length")
        check("tier_bars", bars == 15, f"{bars} bars (3 weeks x 5 tiers)")
        lines = page.eval_on_selector_all(".recharts-line-curve, .recharts-area-area", "els => els.length")
        check("lines_drawn", lines >= 3, lines)
        R["axis_titles"] = page.eval_on_selector_all(".axis-title", "els => [...new Set(els.map(e=>e.textContent))]")
        # every chart carries a table alternative with three weeks in it
        page.eval_on_selector_all("details.astable", "els => els.forEach(e => e.open = true)")
        page.wait_for_timeout(120)
        tables = page.eval_on_selector_all(
            "details.astable table tbody",
            "els => els.map(t => t.querySelectorAll('tr').length)",
        )
        check("chart_tables_three_rows", len(tables) == 4 and all(n == 3 for n in tables), tables)
        R["trend_weeks_in_table"] = page.eval_on_selector_all(
            "details.astable table tbody tr td:first-child", "els => els.slice(0,3).map(e=>e.textContent)"
        )
        R["tuning_state"] = page.inner_text("section[aria-label='Validation'] .eyebrow").strip()
        contrast(page, "trends", contrast_fail)
        page.eval_on_selector_all("details.astable", "els => els.forEach(e => e.open = false)")
        page.wait_for_timeout(120)
        shot(page, "9-trends-1440.png", full=True)

        # ---------------------------------------------------------- 3. Fleet
        goto(page, "#/fleet", "Fleet")
        card = page.locator("section[aria-label='What this run changed']")
        R["fleet_delta_range"] = card.locator(".card-sub").inner_text().strip()
        check("fleet_compares_2_to_3", R["fleet_delta_range"] == f"{WEEKS[1]} → {WEEKS[2]}", R["fleet_delta_range"])
        R["fleet_delta_tables"] = card.locator("table caption").all_inner_texts()
        check("fleet_has_band_deltas", "By HRI band" in R["fleet_delta_tables"], R["fleet_delta_tables"])
        check("fleet_no_unrecorded_delta", card.locator("text=not recorded").count() == 0)
        R["fleet_guardrail"] = page.inner_text(".guard-line").strip()
        check(
            "fleet_guardrail_verbatim",
            R["fleet_guardrail"]
            == "Composite CRS is absolute. Triage rank is relative — percentile rank is never absolute risk.",
            R["fleet_guardrail"],
        )
        R["fleet_tier_bar"] = page.inner_text("section[aria-label='Composite tier composition'] .complegend").replace("\n", " ")
        R["fleet_hri_bar"] = page.inner_text("section[aria-label='Hardware reliability composition'] .complegend").replace("\n", " ")
        R["fleet_excluded"] = page.inner_text("section[aria-label='Excluded owners'] .card-sub").strip()
        contrast(page, "fleet", contrast_fail)
        shot(page, "10-fleet-1440.png", full=True)

        # jump-to-dossier
        page.click("section[aria-label='Top of the queue'] button:has-text('Dossier')")
        page.wait_for_function("() => location.hash === '#/investigate'", timeout=5000)
        R["jump_to_dossier"] = page.inner_text("h1.dev-name").strip()
        check("fleet_jump_works", bool(R["jump_to_dossier"]))
        R["hristar_row"] = page.eval_on_selector_all(
            ".prediction .pred-row", "els => els.map(e=>e.textContent.trim())"
        )
        check("hristar_shown", any(t.startswith("HRI*") for t in R["hristar_row"]), R["hristar_row"])

        # ---------------------------------------------------------- 4. Config
        goto(page, "#/config", "Config")
        page.fill("#w-dex", "19")
        page.wait_for_timeout(120)
        R["config_error"] = page.inner_text("#w-dex ~ .err, section[aria-label='CRS weights'] .err").strip()
        check(
            "config_rejects_99",
            R["config_error"] == "CRS weights must sum to 100 (currently 99).",
            R["config_error"],
        )
        check("config_save_disabled", page.is_disabled("button:has-text('Save configuration')"))
        check("config_not_written", page.evaluate("JSON.parse(localStorage.getItem('sentinel.v1')).config") is None)
        contrast(page, "config-invalid", contrast_fail)
        shot(page, "11-config-1440.png", full=True)

        page.fill("#w-dex", "25")
        page.fill("#w-crash", "15")
        page.wait_for_timeout(120)
        check("config_valid_enables_save", page.is_enabled("button:has-text('Save configuration')"))
        page.click("button:has-text('Save configuration')")
        page.wait_for_timeout(200)
        saved = page.evaluate("JSON.parse(localStorage.getItem('sentinel.v1')).config.crsW")
        check("config_saved", saved["dex"] == 25 and saved["crash"] == 15, saved)
        R["config_saved_note"] = page.inner_text(".ok-line").strip()

        # ---------------------------------------------------------- 5. Reports
        goto(page, "#/reports", "Reports")
        R["report_first_line"] = page.inner_text("[data-testid='report-output']").split("\n")[0]
        check("report_generated", R["report_first_line"].startswith("## Four Questions — Week ending"), R["report_first_line"])
        page.fill("#metrics", "14 proactive tickets raised")
        page.wait_for_timeout(120)
        check(
            "report_uses_metrics_verbatim",
            "- 14 proactive tickets raised" in page.inner_text("[data-testid='report-output']"),
        )
        page.click("section[aria-label='Four Questions'] button:has-text('Copy')")
        page.wait_for_timeout(300)
        R["report_copy_label"] = page.inner_text("section[aria-label='Four Questions'] .btn-teal").strip()
        check("report_copy_ran", R["report_copy_label"] in ("Copied", "Copy blocked"), R["report_copy_label"])
        contrast(page, "reports", contrast_fail)
        shot(page, "12-reports-1440.png", full=True)

        # the Score stage's title is the way up to Fleet
        goto(page, "#/score")
        page.click(".page-title a")
        page.wait_for_selector("h1:has-text('Fleet')", timeout=5000)
        check("score_title_reaches_fleet", page.evaluate("location.hash") == "#/fleet", page.evaluate("location.hash"))

        # the Roundup sheet, from the Close stage's footer
        goto(page, "#/close")
        page.click("button:has-text('ROUNDUP')")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        R["roundup_first_line"] = page.inner_text("[data-testid='roundup-output']").split("\n")[0]
        check(
            "roundup_from_close",
            R["roundup_first_line"].startswith("## Weekly Change Roundup"),
            R["roundup_first_line"],
        )
        contrast(page, "roundup", contrast_fail)
        shot(page, "16-roundup-1440.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

        # ---------------------------------------------------------- 6. Phases
        goto(page, "#/investigate")
        page.click("button:has-text('P1–P7 PHASES')")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        cards = page.eval_on_selector_all(".phase-card .phase-head", "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
        R["phase_order"] = [c.split(" ")[0] for c in cards]
        check("phases_seven", len(cards) == 7, len(cards))
        check("p6_first", cards[0].startswith("P6"), cards[0])
        check("p6_read_first", "READ FIRST" in cards[0], cards[0])
        check("p6_query_shown", "score_count_ == 0" in page.inner_text("[aria-label='P6 query']"))
        contrast(page, "phases", contrast_fail)
        page.eval_on_selector(".sheet-body", "el => el.scrollTop = 0")
        page.wait_for_timeout(150)
        shot(page, "13-phases-1440.png")
        page.fill("#note-p6", "Eleven unattended desktops, four with hard resets.")
        page.click("button:has-text('Save note')")
        page.wait_for_timeout(200)
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        check("phase_sheet_closes_on_escape", page.query_selector("[role='dialog']") is None)

        # the other bulk sheet, while we are on Investigate
        page.click("button:has-text('Findings in')")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        known = page.evaluate("JSON.parse(localStorage.getItem('sentinel.v1')).committedRun.rows[0].name")
        page.fill(
            "#bulk-findings",
            f"# pasted back from the assistant\n{known}: state=triaged; component=SSD; cause=disk latency; action=replace drive\nDEMO-XX-9999: state=actioned; component=RAM",
        )
        page.wait_for_timeout(200)
        R["findings_preview_rows"] = page.eval_on_selector_all("[role='dialog'] tbody tr", "els => els.length")
        check("findings_preview", R["findings_preview_rows"] == 2, R["findings_preview_rows"])
        R["findings_foot"] = page.inner_text("[role='dialog'] .sheet-foot").replace("\n", " ")
        check("findings_skips_unknown", "1 unknown device(s) skipped" in R["findings_foot"], R["findings_foot"])
        contrast(page, "findings", contrast_fail)
        shot(page, "15-findings-1440.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

        page.reload()
        page.wait_for_selector("h1", timeout=15000)
        goto(page, "#/investigate")
        page.click("button:has-text('P1–P7 PHASES')")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        R["phase_note_after_reload"] = page.input_value("#note-p6")
        check(
            "phase_note_persists",
            R["phase_note_after_reload"] == "Eleven unattended desktops, four with hard resets.",
            R["phase_note_after_reload"],
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)

        # ---------------------------------------------------------- 7. Export / Import
        goto(page, "#/export")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        R["export_hash_after_bridge"] = page.evaluate("location.hash")
        check("export_route_resolves_to_sheet", R["export_hash_after_bridge"] != "#/export", R["export_hash_after_bridge"])
        contrast(page, "export", contrast_fail)
        shot(page, "14-export-1440.png")

        with page.expect_download(timeout=15000) as dl:
            page.click("button:has-text('Export backup')")
        download = dl.value
        R["download_name"] = download.suggested_filename
        saved_path = pathlib.Path(tempfile.gettempdir()) / download.suggested_filename
        download.save_as(str(saved_path))
        blob = json.loads(saved_path.read_text())
        check("backup_downloads", R["download_name"].startswith("sentinel-backup-"), R["download_name"])
        check("backup_holds_three_runs", len(blob["runHistory"]) == 3, len(blob["runHistory"]))
        check("backup_has_runmeta", len(blob.get("runMeta", [])) == 3, len(blob.get("runMeta", [])))
        R["last_export_shown"] = page.inner_text("[role='dialog'] .kv").replace("\n", " ")

        # wipe the browser, as a cleared profile would
        page.keyboard.press("Escape")
        page.evaluate("localStorage.clear(); location.hash = '#/pull'")
        page.reload()
        page.wait_for_selector("h1:has-text('Pull')", timeout=15000)
        check("store_wiped", page.evaluate("localStorage.getItem('sentinel.v1')") is None)
        goto(page, "#/export")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        page.set_input_files("[data-testid='import-input']", str(saved_path))
        page.wait_for_selector("[role='group'][aria-label='Confirm restore']", timeout=5000)
        R["import_confirm"] = page.inner_text("[role='group'][aria-label='Confirm restore'] table").replace("\n", " | ")
        R["incoming_runs"] = page.inner_text("[data-testid='incoming-runs']").strip()
        check("import_confirms_first", R["incoming_runs"] == "3", R["incoming_runs"])
        check(
            "import_not_applied_yet",
            page.evaluate("!localStorage.getItem('sentinel.v1') || !JSON.parse(localStorage.getItem('sentinel.v1')).committedRun"),
        )
        page.click("button:has-text('Replace and restore')")
        page.wait_for_timeout(400)
        after = page.evaluate("JSON.parse(localStorage.getItem('sentinel.v1'))")
        check("import_restores_run", after["committedRun"]["weekEnding"] == WEEKS[2], after["committedRun"]["weekEnding"])
        check("import_restores_rows", len(after["committedRun"]["rows"]) == EXPECTED, len(after["committedRun"]["rows"]))
        check("import_restores_history", len(after["runHistory"]) == 3, len(after["runHistory"]))
        check("import_restores_runmeta", len(after.get("runMeta", [])) == 3, len(after.get("runMeta", [])))
        check("import_restores_phase_note", after["committedRun"].get("investigation", {}).get("phaseNotes", {}).get("6", "") != "")
        goto(page, "#/trends", "Trends")
        page.wait_for_selector(".recharts-surface", timeout=10000)
        R["trends_after_restore"] = page.inner_text(".page-head p").strip()
        check("trends_survive_restore", "3 committed weeks" in R["trends_after_restore"], R["trends_after_restore"])

        # ---------------------------------------------------------- 8. keyboard
        goto(page, "#/score")
        page.keyboard.press("?")
        page.wait_for_selector("[role='dialog']", timeout=5000)
        R["shortcuts_title"] = page.inner_text("[role='dialog'] h2").strip()
        check("question_opens_shortcuts", R["shortcuts_title"] == "Keyboard", R["shortcuts_title"])
        page.keyboard.press("4")
        page.wait_for_timeout(120)
        check("sheet_suppresses_stage_keys", page.evaluate("location.hash") == "#/score")
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        for key, want in [("4", "#/work"), ("3", "#/investigate"), ("1", "#/pull"), ("2", "#/score")]:
            page.keyboard.press(key)
            page.wait_for_timeout(150)
            check(f"stage_key_{key}", page.evaluate("location.hash") == want, page.evaluate("location.hash"))
        goto(page, "#/investigate")
        page.keyboard.press("/")
        page.wait_for_timeout(150)
        R["slash_focus"] = page.evaluate("document.activeElement.getAttribute('aria-label')")
        check("slash_focuses_filter", R["slash_focus"] == "Filter the queue", R["slash_focus"])
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        before_j = page.inner_text("h1.dev-name").strip()
        page.keyboard.press("j")
        page.wait_for_timeout(700)  # the dossier crossfade is 180ms out then in
        after_j = page.inner_text("h1.dev-name").strip()
        page.keyboard.press("k")
        page.wait_for_timeout(700)
        after_k = page.inner_text("h1.dev-name").strip()
        R["j_from"] = before_j
        R["j_then_k"] = f"{after_j} -> {after_k}"
        check("jk_moves", after_j != before_j and after_k == before_j, R["j_then_k"])

        # every focusable control on the new views is reachable
        counts = {}
        for h, name in [("#/fleet", "Fleet"), ("#/trends", "Trends"), ("#/config", "Config"), ("#/reports", "Reports")]:
            goto(page, h, name)
            counts[name] = page.evaluate(
                "() => [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex=\"-1\"]),summary,details')].filter(e=>e.offsetParent!==null||e.tagName==='SUMMARY').length"
            )
        R["focusables"] = counts
        check("keyboard_reachable", all(v > 8 for v in counts.values()), counts)

        # no horizontal overflow on any new view, at three widths
        overflow = {}
        for w in (1440, 1280, 1024):
            page.set_viewport_size({"width": w, "height": 900})
            for h, name in [("#/fleet", "Fleet"), ("#/trends", "Trends"), ("#/config", "Config"), ("#/reports", "Reports")]:
                goto(page, h, name)
                page.wait_for_timeout(220)
                overflow[f"{name}@{w}"] = page.evaluate(
                    "document.documentElement.scrollWidth > document.documentElement.clientWidth"
                )
        R["horizontal_overflow"] = overflow
        check("no_horizontal_overflow", not any(overflow.values()), {k: v for k, v in overflow.items() if v})
        page.set_viewport_size({"width": 1440, "height": 900})

        R["console_errors"] = console
        R["page_errors"] = page_errors
        R["failed_requests"] = failed
        check("zero_console_errors", not console, console[:5])
        check("zero_page_errors", not page_errors, page_errors[:5])
        check("zero_failed_requests", not failed, failed[:5])
        browser.close()

        # ---------------------------------------------------------- 9. reduced motion
        browser, ctx, page, console, page_errors, failed = run(pw, reduced=True)
        for w in WEEKS:
            commit(page, w)
        rm = {}
        for h, name in [("#/fleet", "Fleet"), ("#/trends", "Trends"), ("#/config", "Config"), ("#/reports", "Reports")]:
            goto(page, h, name)
            page.wait_for_timeout(40)
            rm[name] = page.evaluate(
                """() => [...document.querySelectorAll('.card, .kpi, section')]
                     .map(e => getComputedStyle(e))
                     .every(s => parseFloat(s.opacity) === 1 && (s.transform === 'none' || s.transform === 'matrix(1, 0, 0, 1, 0, 0)'))"""
            )
        R["reduced_motion_settled_at_40ms"] = rm
        check("reduced_motion_no_entrance", all(rm.values()), rm)
        goto(page, "#/trends", "Trends")
        page.wait_for_selector(".recharts-surface", timeout=10000)
        page.wait_for_timeout(40)
        # a Recharts entrance animation leaves a stroke-dashoffset / clip animation mid-flight
        R["rm_chart_animations"] = page.evaluate(
            "() => document.getAnimations ? document.getAnimations().filter(a => a.playState === 'running').length : -1"
        )
        check("reduced_motion_charts_static", R["rm_chart_animations"] in (0, -1), R["rm_chart_animations"])
        shot(page, "9-trends-1440-rm.png", full=True)
        goto(page, "#/fleet", "Fleet")
        shot(page, "10-fleet-1440-rm.png", full=True)
        R["rm_console_errors"] = console
        R["rm_page_errors"] = page_errors
        check("rm_zero_errors", not console and not page_errors, (console[:3], page_errors[:3]))
        browser.close()

    R["contrast_failures"] = contrast_fail
    check("contrast_floor", not contrast_fail, contrast_fail)

    print(json.dumps(R, indent=2, default=str))
    if failures:
        print("\nFAILED:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("\nPhase 3 file:// VERIFICATION PASSED")


main()
