#!/usr/bin/env python3
"""
file:// verification.

Opens dist/index.html straight from file:// in Chromium (no server), drives the
real <input type="file"> on /#/pull with demo/sample-fleet.csv, and asserts the
ingest report shows every device in the sample and HRI mode "counts" with zero
page errors and zero console errors.

Requires: pip install playwright && playwright install chromium
Set CHROMIUM_PATH to use a specific Chromium binary instead.
"""

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "index.html"
CSV = ROOT / "demo" / "sample-fleet.csv"
EXPECTED = sum(1 for line in CSV.read_text(encoding="utf-8").splitlines()[1:] if line.strip())

if not DIST.exists():
    sys.exit(f"missing {DIST} — run `npm run build` first")

console_errors: list[str] = []
page_errors: list[str] = []
failed_requests: list[str] = []
results: dict = {}

with sync_playwright() as p:
    browser = p.chromium.launch(
        executable_path=os.environ.get("CHROMIUM_PATH") or None,
        args=["--no-sandbox"],
    )
    page = browser.new_page()
    page.on("console", lambda m: console_errors.append(f"{m.type}: {m.text}")
            if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("requestfailed", lambda r: failed_requests.append(f"{r.url} :: {r.failure}"))

    page.goto(f"{DIST.as_uri()}#/pull")
    page.wait_for_selector("h1:has-text('Pull')", timeout=15000)

    results["protocol"] = page.evaluate("location.protocol")
    results["hash_after_boot"] = page.evaluate("location.hash")

    # every stage + lens route must be reachable in the nav
    results["nav_links"] = page.eval_on_selector_all("nav a", "els => els.map(e => e.textContent.trim())")

    # route navigation through the hash router, no page load
    page.click("nav a:has-text('Trends')")
    page.wait_for_selector("h1:has-text('Trends')", timeout=5000)
    results["route_trends_hash"] = page.evaluate("location.hash")
    page.click("nav a:has-text('Pull')")
    page.wait_for_selector("h1:has-text('Pull')", timeout=5000)

    # the real file input
    page.set_input_files("[data-testid='csv-input']", str(CSV))
    page.wait_for_selector("[data-testid='ingest-report']", timeout=20000)

    results["devices"] = page.inner_text("[data-testid='stat-devices']").strip()
    results["rejected"] = page.inner_text("[data-testid='stat-rejected']").strip()
    results["hri_mode"] = page.inner_text("[data-testid='stat-hrimode']").strip()
    results["gate"] = page.inner_text("[data-testid='stat-gate']").strip()
    results["error_shown"] = page.query_selector("[data-testid='ingest-error']") is not None

    # PHASE 3 FIX: Phase 1's /pull committed on upload; Phase 2 split it into
    # two deliberate steps (choose files -> read the report -> freeze the
    # baseline), so this script has been reading an empty store ever since.
    # Committing is what every assertion below was always about, and the
    # ingest report is cleared by the commit, so it is read first.
    page.click("button:has-text('Commit run & score')")
    page.wait_for_function("() => location.hash === '#/score'", timeout=20000)
    page.click("nav a:has-text('Pull')")
    page.wait_for_selector("h1:has-text('Pull')", timeout=5000)

    # the run must have landed in localStorage in the legacy blob shape
    blob = page.evaluate("localStorage.getItem('sentinel.v1')")
    parsed = json.loads(blob) if blob else None
    results["blob_present"] = parsed is not None
    if parsed:
        results["blob_schema_version"] = parsed.get("schemaVersion")
        results["blob_top_level_keys"] = sorted(parsed.keys())
        results["blob_has_wrapper"] = "state" in parsed or "version" in parsed
        results["blob_rows"] = len(parsed["committedRun"]["rows"])
        results["blob_hri_mode"] = parsed["committedRun"]["report"]["hriMode"]

    # reload from file:// and confirm the committed run survives
    page.reload()
    page.wait_for_selector("h1:has-text('Pull')", timeout=15000)
    results["rows_after_reload"] = page.evaluate(
        "JSON.parse(localStorage.getItem('sentinel.v1')).committedRun.rows.length"
    )

    browser.close()

results["console_errors"] = console_errors
results["page_errors"] = page_errors
results["failed_requests"] = failed_requests

print(json.dumps(results, indent=2))

failures = []
if results["protocol"] != "file:":
    failures.append("not running from file://")
if results["devices"] != str(EXPECTED):
    failures.append(f"device count {results['devices']} != {EXPECTED}")
if results["hri_mode"] != "counts":
    failures.append(f"HRI mode {results['hri_mode']} != counts")
if results["rejected"] != "0":
    failures.append(f"rejected rows {results['rejected']} != 0")
if results["error_shown"]:
    failures.append("the page showed an ingest error")
if not results.get("blob_present"):
    failures.append("nothing written to localStorage")
if results.get("blob_schema_version") != 1:
    failures.append("blob schemaVersion is not 1")
if results.get("blob_has_wrapper"):
    failures.append("blob carries a {state,version} wrapper")
if results.get("blob_rows") != EXPECTED:
    failures.append(f"committed run does not hold {EXPECTED} rows")
if results.get("rows_after_reload") != EXPECTED:
    failures.append("the committed run did not survive a reload")
if page_errors:
    failures.append(f"{len(page_errors)} page error(s)")
if console_errors:
    failures.append(f"{len(console_errors)} console error/warning(s)")
if failed_requests:
    failures.append(f"{len(failed_requests)} failed request(s)")

if failures:
    print("\nFAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)

print("\nfile:// VERIFICATION PASSED")
