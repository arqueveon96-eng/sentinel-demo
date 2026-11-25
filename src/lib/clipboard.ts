/* ============================================================
   clipboard.ts — the two side effects Phase 1 deliberately did not
   port out of handoff.js, because src/core/ is dependency-free by
   contract: they touch the clipboard and the DOM, not the logic.

   `file://` matters here. navigator.clipboard is only available in a
   secure context, and a page opened by double-clicking index.html is
   not one, so the execCommand fallback is the path that actually runs
   in production. Both are kept.
   ============================================================ */

/** Copy text to the clipboard. Resolves to false if the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the file:// path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Save text as a file. Legacy handoff.js:downloadText, unchanged in effect. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
