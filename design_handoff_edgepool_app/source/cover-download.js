// Click any [data-download-target="#id"] button to save that artboard as PNG.
// Fonts are embedded explicitly, because html-to-image can't read the cross-origin Google Fonts stylesheet.
// Without this, the export falls back to thinner system fonts.
(function () {
  if (window.__epCoverDl) return; window.__epCoverDl = true;
  let lib, fontCSS;
  const load = () => lib || (lib = import('https://esm.sh/html-to-image@1.11.11'));
  const toDataURL = async (url) => {
    const b = await (await fetch(url)).blob();
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  };
  const inlineUrls = async (css, base) => {
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]).filter((u) => !u.startsWith('data:')))];
    for (const u of urls) {
      try { css = css.split(u).join(await toDataURL(new URL(u, base).href)); } catch (e) {}
    }
    return css;
  };
  const buildFontCSS = () => fontCSS || (fontCSS = (async () => {
    let out = '';
    for (const sheet of document.styleSheets) {
      const href = sheet.href || location.href;
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) {}
      if (rules) {
        for (const r of rules) if (r.type === CSSRule.FONT_FACE_RULE) out += await inlineUrls(r.cssText, href) + '\n';
      } else if (sheet.href) {
        try {
          let css = await (await fetch(sheet.href)).text();
          // Keep only latin subsets to stay small.
          const blocks = css.split('/*').filter((b) => /^\s*latin \*\//.test(b)).map((b) => '/*' + b);
          css = blocks.length ? blocks.join('') : css;
          out += await inlineUrls(css, sheet.href) + '\n';
        } catch (e) {}
      }
    }
    return out;
  })());
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-download-target]');
    if (!btn) return;
    e.preventDefault();
    const node = document.querySelector(btn.getAttribute('data-download-target'));
    if (!node) return;
    const label = btn.querySelector('[data-label]') || btn;
    const orig = label.textContent;
    label.textContent = 'Rendering…'; btn.disabled = true;
    try {
      const [{ toPng }, css] = await Promise.all([load(), buildFontCSS()]);
      await document.fonts.ready;
      const scale = Number(btn.getAttribute('data-scale') || 1);
      const opts = { pixelRatio: scale, width: node.offsetWidth, height: node.offsetHeight, cacheBust: true, fontEmbedCSS: css };
      await toPng(node, opts); // warm-up pass so fonts and images are decoded before the real capture
      const url = await toPng(node, opts);
      const a = document.createElement('a');
      a.href = url; a.download = btn.getAttribute('data-filename') || 'export.png';
      document.body.appendChild(a); a.click(); a.remove();
      label.textContent = 'Downloaded';
    } catch (err) {
      console.error(err); label.textContent = 'Failed — retry';
    } finally {
      btn.disabled = false; setTimeout(() => { label.textContent = orig; }, 1600);
    }
  });
})();
