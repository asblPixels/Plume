/* =====================================================================
   Plume — registre des formats de fichiers
   Détection (extension + signature), ouverture et export de tous les
   formats pris en charge, module de conversion LibreOffice (bureau).
   ===================================================================== */
'use strict';

const Formats = (() => {

  /* ---------- Formats ouverts directement par Plume ---------- */
  const OPEN = {
    docx: 'Word (.docx)', docm: 'Word avec macros (.docm)', dotx: 'Modèle Word (.dotx)', dotm: 'Modèle Word (.dotm)',
    doc: 'Word 97-2003 (.doc)', dot: 'Modèle Word 97-2003 (.dot)',
    odt: 'OpenDocument (.odt)', ott: 'Modèle OpenDocument (.ott)', fodt: 'OpenDocument XML plat (.fodt)',
    rtf: 'Texte enrichi (.rtf)', pdf: 'PDF (.pdf)',
    html: 'Page web (.html)', htm: 'Page web (.htm)', xhtml: 'Page web (.xhtml)',
    md: 'Markdown (.md)', markdown: 'Markdown (.markdown)', txt: 'Texte (.txt)', text: 'Texte', csv: 'Données CSV (.csv)'
  };
  /** Formats confiés au module de conversion (LibreOffice, application de bureau) */
  const CONVERT = {
    wpd: 'WordPerfect (.wpd)', wps: 'Microsoft Works (.wps)', pages: 'Apple Pages (.pages)', sxw: 'OpenOffice 1.x (.sxw)', stw: 'Modèle OpenOffice 1.x (.stw)',
    abw: 'AbiWord (.abw)', zabw: 'AbiWord (.zabw)', lwp: 'Lotus Word Pro (.lwp)', hwp: 'Hangul (.hwp)', wri: 'Write (.wri)', xml: 'Word 2003 XML (.xml)',
    epub: 'Livre numérique (.epub)', mw: 'MacWrite', cwk: 'ClarisWorks (.cwk)', sdw: 'StarWriter (.sdw)', uot: 'Uniform Office (.uot)', '602': 'T602 (.602)', pdb: 'Palm (.pdb)'
  };
  const ALL_EXT = [...Object.keys(OPEN), ...Object.keys(CONVERT)];
  const ACCEPT = ALL_EXT.map(e => '.' + e).join(',') + ',.gdoc';

  /* ---------- Formats d'export ---------- */
  const EXPORT = {
    docx: { label: 'Document Word (.docx)', desc: 'Microsoft 365, Word 2007 et suivants, Google Docs, LibreOffice.', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    odt: { label: 'OpenDocument (.odt)', desc: 'LibreOffice, OpenOffice, Google Docs, Word.', mime: 'application/vnd.oasis.opendocument.text' },
    pdf: { label: 'PDF (.pdf)', desc: 'Fichier PDF direct, prêt à envoyer ou imprimer. Polices, images et mise en page incluses.', mime: 'application/pdf' },
    rtf: { label: 'Texte enrichi (.rtf)', desc: 'Lisible partout, même par WordPad et TextEdit.', mime: 'application/rtf' },
    docm: { label: 'Word avec macros (.docm)', desc: 'Conserve les macros du document d’origine (jamais exécutées par Plume).', mime: 'application/vnd.ms-word.document.macroEnabled.12', macros: true },
    dotx: { label: 'Modèle Word (.dotx)', desc: 'Modèle réutilisable : Word crée un nouveau document à chaque ouverture.', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template' },
    dotm: { label: 'Modèle Word avec macros (.dotm)', desc: 'Modèle qui conserve les macros d’origine (jamais exécutées par Plume).', mime: 'application/vnd.ms-word.template.macroEnabled.12', macros: true },
    doc: { label: 'Word 97-2003 (.doc)', desc: 'Pour les très anciennes versions de Word (application de bureau + LibreOffice).', mime: 'application/msword', desktop: true },
    html: { label: 'Page web (.html)', desc: 'Un fichier unique, images incluses.', mime: 'text/html' },
    md: { label: 'Markdown (.md)', desc: 'Texte structuré pour le web et les wikis.', mime: 'text/markdown' },
    txt: { label: 'Texte brut (.txt)', desc: 'Uniquement le texte, sans mise en forme.', mime: 'text/plain' }
  };
  /** Formats que Ctrl+S peut réécrire tels quels */
  const SAVABLE = new Set(['docx', 'docm', 'dotx', 'dotm', 'odt', 'rtf', 'md', 'txt', 'html']);
  /** Paquets Word (Office Open XML) */
  const WORD_XML = new Set(['docx', 'docm', 'dotx', 'dotm']);

  const extOf = name => (String(name).split('.').pop() || '').toLowerCase();

  /** Détecte le vrai format à partir des premiers octets (le nom peut mentir) */
  async function sniff(buf, ext) {
    const b = new Uint8Array(buf.slice(0, 8));
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return ['doc', 'dot', 'wps', 'xls'].includes(ext) ? ext : 'doc';
    if (b[0] === 0x7B && b[1] === 0x5C && b[2] === 0x72 && b[3] === 0x74) return 'rtf';
    if (b[0] === 0x50 && b[1] === 0x4B) {
      try {
        const z = await JSZip.loadAsync(buf);
        const mt = z.file('mimetype') ? (await z.file('mimetype').async('string')).trim() : '';
        if (/opendocument\.text/.test(mt)) return /template/.test(mt) ? 'ott' : 'odt';
        if (z.file('word/document.xml') || z.file('[Content_Types].xml')) {
          if (['docx', 'docm', 'dotx', 'dotm'].includes(ext)) return ext;
          // extension inconnue : le type du document principal fait foi
          const ct = z.file('[Content_Types].xml') ? await z.file('[Content_Types].xml').async('string') : '';
          return /macroEnabledTemplate\.main/.test(ct) ? 'dotm' : /macroEnabled\.main/.test(ct) ? 'docm' : /wordprocessingml\.template\.main/.test(ct) ? 'dotx' : 'docx';
        }
        if (z.file('index.xml') && ext === 'pages') return 'pages';
        if (/sun\.xml\.writer/.test(mt)) return 'sxw';
        if (mt === 'application/epub+zip') return 'epub';
      } catch { /* pas un ZIP valide */ }
      return ext;
    }
    if (ext === 'fodt' || ext === 'xml') {
      const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 2000)));
      if (/office:document/.test(head)) return 'fodt';
      if (/w:wordDocument/.test(head)) return 'xml';
    }
    return ext;
  }

  /* ---------- Module de conversion (bureau + LibreOffice) ---------- */
  const converterAvailable = async () => !!(window.plumeDesktop && window.plumeDesktop.converter && await window.plumeDesktop.converter.available());
  async function convertWithOffice(buf, fromExt, toExt) {
    if (!(await converterAvailable())) return null;
    const out = await window.plumeDesktop.converter.convert(buf, fromExt, toExt);
    return out ? out : null;
  }

  /* ---------- PDF (pdf.js) ---------- */
  let pdfjs = null;
  async function loadPdfJs() {
    if (pdfjs) return pdfjs;
    const base = new URL('vendor/pdfjs/', document.baseURI).href;
    pdfjs = await import(base + 'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return pdfjs;
  }
  async function importPdf(buf, opts) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    const html = [];
    let first = null;
    const sizes = [];
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      if (!first) first = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str !== undefined).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10, w: it.width, eol: it.hasEOL, font: (tc.styles[it.fontName] || {}).fontFamily || '' }));
      items.forEach(it => { if (it.s.trim()) sizes.push(Math.round(it.h)); });
      pages.push(items);
    }
    // taille du corps de texte = la plus fréquente
    const freq = {}; sizes.forEach(s => freq[s] = (freq[s] || 0) + 1);
    const body = +Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
    pages.forEach((items, pi) => {
      // regroupement en lignes (même y à ±40 % de la hauteur)
      const lines = [];
      for (const it of items) {
        if (!it.s && !it.eol) continue;
        const ln = lines.find(l => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.4));
        if (ln) ln.items.push(it); else lines.push({ y: it.y, h: it.h, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      let para = null, lastY = null;
      const flush = () => {
        if (!para) return;
        const t = para.text.replace(/\s+/g, ' ').trim();
        if (t) {
          const ratio = para.h / body;
          const tag = ratio > 1.6 ? 'h1' : ratio > 1.3 ? 'h2' : ratio > 1.12 && t.length < 120 ? 'h3' : 'p';
          html.push(`<${tag}${para.center ? ' style="text-align:center"' : ''}>${htmlEsc(t)}</${tag}>`);
        }
        para = null;
      };
      for (const l of lines) {
        l.items.sort((a, b) => a.x - b.x);
        let text = '', prevEnd = null;
        for (const it of l.items) {
          if (prevEnd !== null && it.x - prevEnd > it.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.s)) text += ' ';
          text += it.s; prevEnd = it.x + (it.w || 0);
        }
        const h = Math.max(...l.items.map(i => i.h));
        const gap = lastY === null ? 0 : lastY - l.y;
        const minX = Math.min(...l.items.map(i => i.x)), maxX = Math.max(...l.items.map(i => i.x + (i.w || 0)));
        const center = first && Math.abs((minX + maxX) / 2 - first.width / 2) < 12 && (maxX - minX) < first.width * 0.6;
        const newPara = !para || gap > h * 1.75 || Math.abs(h - para.h) > 1.5 || /[.:!?»"]$/.test(para.text.trim()) && gap > h * 1.25;
        if (newPara) { flush(); para = { text: '', h, center }; }
        para.text += (para.text && !/-$/.test(para.text) ? ' ' : '') + (para.text.endsWith('-') ? text : text);
        if (para.text.endsWith('-') && false) para.text = para.text.slice(0, -1);
        lastY = l.y;
      }
      flush();
      if (pi < pages.length - 1) html.push('<hr class="pl-pagebreak" contenteditable="false">');
    });
    const page = first ? { w: first.width / 0.75, h: first.height / 0.75 } : undefined;
    let title = '';
    try { const md = await doc.getMetadata(); title = (md.info && md.info.Title) || ''; } catch { }
    return { html: html.join('') || '<p><br></p>', page, props: { title }, simplified: true };
  }

  /* ---------- Ouverture ---------- */
  /**
   * Ouvre n'importe quel fichier et renvoie l'objet attendu par Ed.load
   * { html, header, footer, page, settings, props, source?, format, notice? }
   */
  async function open(file, opts = {}) {
    let ext = extOf(file.name);
    if (ext === 'gdoc' || ext === 'gsheet' || ext === 'gslides') {
      let url = '';
      try { url = JSON.parse(await file.text()).url || ''; } catch { }
      const e = new Error('GDOC');
      e.userMessage = `Ce fichier est un simple raccourci Google Drive : le document lui-même est en ligne.<br><br>Ouvrez-le dans Google Docs puis <b>Fichier → Télécharger → Microsoft Word (.docx)</b> ou <b>OpenDocument (.odt)</b>, et ouvrez le fichier téléchargé dans Plume.${url ? `<br><br><a href="${htmlEsc(url)}" target="_blank" rel="noopener">Ouvrir le document dans Google Docs</a>` : ''}`;
      throw e;
    }
    const buf = await file.arrayBuffer();
    ext = await sniff(buf, ext);
    const reg = opts.registerImage;

    switch (ext) {
      case 'docx': case 'docm': case 'dotx': case 'dotm': {
        const r = await DocxImport.importDocx(buf, { registerImage: reg });
        // macros : jamais exécutées ; conservées à l'enregistrement en .docm / .dotm
        const macros = DocxExport.hasMacros(r.source);
        return { ...r, format: ext, macros, bytes: new Uint8Array(buf) };
      }
      case 'odt': case 'ott': case 'fodt': return { ...(await Odt.importOdt(buf, { registerImage: reg })), format: ext === 'odt' ? 'odt' : 'odt' };
      case 'rtf': return { ...Rtf.importRtf(buf, { registerImage: reg }), format: 'rtf' };
      case 'pdf': return { ...(await importPdf(buf)), format: 'pdf', notice: 'PDF importé : le texte et la structure sont récupérés, la mise en page d’origine est simplifiée.' };
      case 'html': case 'htm': case 'xhtml': return { html: Sanitize.html(decodeText(buf)), format: 'html' };
      case 'md': case 'markdown': return { html: Markdown.toHtml(decodeText(buf)), format: 'md' };
      case 'csv': {
        const rows = decodeText(buf).split(/\r?\n/).filter(l => l.trim()).map(l => parseCsvLine(l, l.split(';').length > l.split(',').length ? ';' : ','));
        const n = Math.max(1, ...rows.map(r => r.length));
        return { html: `<table data-borders="all"><tbody>${rows.map((r, i) => `<tr${i === 0 ? ' data-header="1"' : ''}>${Array.from({ length: n }, (x, k) => `<td><p>${htmlEsc(r[k] || '') || '<br>'}</p></td>`).join('')}</tr>`).join('')}</tbody></table><p><br></p>`, format: 'txt' };
      }
      case 'doc': case 'dot': {
        const conv = await convertWithOffice(buf, ext, 'docx');
        if (conv) { const r = await DocxImport.importDocx(conv, { registerImage: reg }); return { ...r, format: 'doc', bytes: new Uint8Array(conv) }; }
        const r = LegacyDoc.importDoc(buf);
        const miss = r.missing.length ? ` <b>Non repris :</b> ${r.missing.join(', ')}.` : '';
        return { ...r, format: 'doc', partial: true, notice: `<b>Word 97-2003</b> — Ouverture dans le navigateur : texte, titres, listes, tableaux et mise en forme simple récupérés.${miss} Pour une conversion complète, utilisez l’application de bureau Plume avec LibreOffice installé (conversion automatique).` };
      }
      case 'txt': case 'text': case '': default: {
        if (CONVERT[ext]) {
          const conv = await convertWithOffice(buf, ext, 'docx');
          if (conv) { const r = await DocxImport.importDocx(conv, { registerImage: reg }); return { ...r, format: 'docx', bytes: new Uint8Array(conv), notice: `${CONVERT[ext]} converti par le module LibreOffice. Il sera enregistré au format .docx.` }; }
          const e = new Error('CONVERTER');
          e.userMessage = `Le format <b>${htmlEsc(CONVERT[ext])}</b> nécessite le module de conversion.<br><br>Utilisez l’<b>application de bureau Plume</b> (Windows ou Linux) avec <a href="https://fr.libreoffice.org/download/telecharger-libreoffice/" target="_blank" rel="noopener">LibreOffice</a> installé (gratuit) : Plume l’utilise automatiquement pour convertir ces fichiers.`;
          throw e;
        }
        const t = decodeText(buf);
        if (/[\u0000-\u0008\u000E-\u001F]/.test(t.slice(0, 2000))) throw Object.assign(new Error('BIN'), { userMessage: 'Ce fichier n’est pas un document texte reconnu par Plume.' });
        return { html: t.split(/\r?\n/).map(l => `<p>${htmlEsc(l).replace(/\t/g, '<span class="pl-tab">\t</span>') || '<br>'}</p>`).join(''), format: 'txt' };
      }
    }
  }
  function decodeText(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(b);
    return utf8.includes('�') ? new TextDecoder('windows-1252').decode(b) : utf8.replace(/^﻿/, '');
  }
  function parseCsvLine(line, sep) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur); return out;
  }

  /* ---------- Export ---------- */
  async function build(format, ctx) {
    switch (format) {
      case 'docx': case 'docm': case 'dotx': case 'dotm': return DocxExport.exportDocx(ctx, { kind: format });
      case 'odt': return Odt.exportOdt(ctx);
      case 'rtf': return Rtf.exportRtf(ctx);
      case 'md': return new Blob([Markdown.fromEditor(ctx.editor)], { type: 'text/markdown;charset=utf-8' });
      case 'txt': return new Blob([ctx.editor.innerText.replace(/​/g, '')], { type: 'text/plain;charset=utf-8' });
      case 'html': return new Blob([await App.htmlDocument()], { type: 'text/html;charset=utf-8' });
      case 'doc': {
        const docx = await DocxExport.exportDocx(ctx);
        const conv = await convertWithOffice(await docx.arrayBuffer(), 'docx', 'doc');
        if (!conv) throw Object.assign(new Error('CONVERTER'), { userMessage: 'L’export Word 97-2003 (.doc) nécessite l’application de bureau Plume et LibreOffice. Le format .docx est lu par toutes les versions de Word depuis 2007.' });
        return new Blob([conv], { type: EXPORT.doc.mime });
      }
      case 'pdf': {
        // application de bureau : PDF vectoriel (texte sélectionnable) ; ailleurs : PDF direct page par page
        if (window.plumeDesktop && window.plumeDesktop.printToPdf) return new Blob([await window.plumeDesktop.printToPdf()], { type: 'application/pdf' });
        return rasterPdf(ctx);
      }
    }
    throw new Error('Format d’export inconnu : ' + format);
  }

  /* ---------- PDF direct (navigateur, tablette, téléphone) ---------- */
  const loadScript = src => new Promise((res, rej) => { if (document.querySelector(`script[data-lib="${src}"]`)) return res(); const sc = document.createElement('script'); sc.src = src; sc.dataset.lib = src; sc.onload = res; sc.onerror = () => rej(new Error('Module PDF introuvable : ' + src)); document.head.append(sc); });
  /**
   * Fabrique un fichier PDF à partir des pages affichées : chaque page est rendue
   * en haute définition (≈ 200 ppp) avec ses en-têtes, pieds, images et polices.
   */
  async function rasterPdf(ctx, onProgress) {
    await loadScript('vendor/html2canvas.min.js');
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const page = Ed.page, n = Ed.pageCount, P = page.h + GAP;
    const canvasEl = $('#canvas'), zoomBox = $('#zoomBox');
    const saved = { scroll: canvasEl.scrollTop, zoom: zoomBox.style.zoom, cls: document.body.className };
    // affichage « propre » : 100 %, sans marques d'édition ni surlignages
    zoomBox.style.zoom = 1; canvasEl.scrollTop = 0;
    document.body.classList.add('pdf-export');
    document.body.classList.remove('show-marks');
    Ed.selectImage && Ed.selectImage(null);
    if (window.CSS && CSS.highlights) CSS.highlights.clear();
    getSelection().removeAllRanges();
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 60));
    const pt = px => px * 0.75;
    const pdf = new jsPDF({ unit: 'pt', format: [pt(page.w), pt(page.h)], orientation: page.w > page.h ? 'landscape' : 'portrait', compress: true });
    pdf.setProperties({ title: (ctx.props && ctx.props.title) || App.name(), author: (ctx.props && ctx.props.author) || '', creator: 'Plume — Pixel\'s ASBL' });
    // scène hors écran : une copie de la feuille, décalée pour montrer une page à la fois
    const stage = document.createElement('div');
    stage.style.cssText = `position:absolute;left:0;top:0;width:${page.w}px;height:${page.h}px;overflow:hidden;background:#fff;z-index:-1;pointer-events:none`;
    const copy = Ed.sheet.cloneNode(true);
    copy.style.position = 'absolute'; copy.style.left = '0'; copy.style.margin = '0';
    copy.querySelectorAll('#imgHandle, .page-num-badge, .toc-upd').forEach(e => e.remove());
    stage.append(copy);
    document.body.append(stage);
    await Promise.all(Array.from(copy.querySelectorAll('img')).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    try {
      for (let i = 0; i < n; i++) {
        onProgress && onProgress(i + 1, n);
        copy.style.top = (-i * P) + 'px';
        const canvas = await html2canvas(stage, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: -window.scrollX, scrollY: -window.scrollY });
        if (i > 0) pdf.addPage([pt(page.w), pt(page.h)], page.w > page.h ? 'landscape' : 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pt(page.w), pt(page.h), undefined, 'FAST');
        // liens cliquables conservés
        const sr = stage.getBoundingClientRect();
        for (const a of copy.querySelectorAll('#editor a[href^="http"], #editor a[href^="mailto:"]')) {
          for (const rr of a.getClientRects()) {
            const top = rr.top - sr.top;
            if (top < 0 || top > page.h || !rr.width) continue;
            pdf.link(pt(rr.left - sr.left), pt(top), pt(rr.width), pt(rr.height), { url: a.href });
          }
        }
      }
    } finally {
      stage.remove();
      zoomBox.style.zoom = saved.zoom; canvasEl.scrollTop = saved.scroll;
      document.body.classList.remove('pdf-export');
      if (/show-marks/.test(saved.cls)) document.body.classList.add('show-marks');
    }
    return pdf.output('blob');
  }

  return { rasterPdf, OPEN, CONVERT, EXPORT, SAVABLE, WORD_XML, ACCEPT, ALL_EXT, extOf, open, build, converterAvailable, importPdf };
})();
