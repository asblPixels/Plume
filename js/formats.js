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
    rtf: 'Texte enrichi (.rtf)', pdf: 'PDF (.pdf)', epub: 'Livre numérique (.epub)',
    html: 'Page web (.html)', htm: 'Page web (.htm)', xhtml: 'Page web (.xhtml)',
    md: 'Markdown (.md)', markdown: 'Markdown (.markdown)', txt: 'Texte (.txt)', text: 'Texte', csv: 'Données CSV (.csv)', tsv: 'Données séparées par tabulations (.tsv)'
  };
  /** Formats confiés au module de conversion (LibreOffice, application de bureau) */
  const CONVERT = {
    wpd: 'WordPerfect (.wpd)', wps: 'Microsoft Works (.wps)', pages: 'Apple Pages (.pages)', sxw: 'OpenOffice 1.x (.sxw)', stw: 'Modèle OpenOffice 1.x (.stw)',
    abw: 'AbiWord (.abw)', zabw: 'AbiWord (.zabw)', lwp: 'Lotus Word Pro (.lwp)', hwp: 'Hangul (.hwp)', wri: 'Write (.wri)', xml: 'Word 2003 XML (.xml)', dbk: 'DocBook (.dbk)', docbook: 'DocBook (.docbook)',
    mw: 'MacWrite (.mw)', mcw: 'MacWrite (.mcw)', cwk: 'ClarisWorks (.cwk)', sdw: 'StarWriter (.sdw)', uot: 'Unified Office Format (.uot)', uof: 'Unified Office Format (.uof)', '602': 'T602 (.602)', pdb: 'Palm (.pdb)'
  };
  const ALL_EXT = [...Object.keys(OPEN), ...Object.keys(CONVERT)];
  const ACCEPT = ALL_EXT.map(e => '.' + e).join(',') + ',.gdoc';

  /* ---------- Formats d'export ---------- */
  const EXPORT = {
    docx: { label: 'Document Word (.docx)', desc: 'Microsoft 365, Word 2007 et suivants, Google Docs, LibreOffice.', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    odt: { label: 'OpenDocument (.odt)', desc: 'LibreOffice, OpenOffice, Google Docs, Word.', mime: 'application/vnd.oasis.opendocument.text' },
    ott: { label: 'Modèle OpenDocument (.ott)', desc: 'Créez de nouveaux documents à partir de ce modèle dans LibreOffice.', mime: 'application/vnd.oasis.opendocument.text-template' },
    fodt: { label: 'OpenDocument XML (.fodt)', desc: 'Document LibreOffice dans un seul fichier XML, via LibreOffice sur ordinateur.', mime: 'application/vnd.oasis.opendocument.text-flat-xml', desktop: true },
    epub: { label: 'Livre numérique (.epub)', desc: 'Pour les liseuses. Le texte s’adapte à l’écran et les titres forment le sommaire.', mime: 'application/epub+zip' },
    xml: { label: 'Word 2003 XML (.xml)', desc: 'Document XML pour Word 2003. Export via LibreOffice sur ordinateur.', mime: 'application/xml', desktop: true },
    pdf: { label: 'PDF (.pdf)', desc: 'Fichier PDF direct, prêt à envoyer ou imprimer. Polices, images et mise en page incluses.', mime: 'application/pdf' },
    pdfa: { label: 'PDF d’archivage (PDF/A-2b)', desc: 'Pour l’archivage à long terme. Export via LibreOffice sur ordinateur.', mime: 'application/pdf', desktop: true, extension: 'pdf' },
    rtf: { label: 'Texte enrichi (.rtf)', desc: 'Lisible partout, même par WordPad et TextEdit.', mime: 'application/rtf' },
    docm: { label: 'Word avec macros (.docm)', desc: 'Conserve les macros du document d’origine (jamais exécutées par Plume).', mime: 'application/vnd.ms-word.document.macroEnabled.12', macros: true },
    dotx: { label: 'Modèle Word (.dotx)', desc: 'Modèle réutilisable : Word crée un nouveau document à chaque ouverture.', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template' },
    dotm: { label: 'Modèle Word avec macros (.dotm)', desc: 'Modèle qui conserve les macros d’origine (jamais exécutées par Plume).', mime: 'application/vnd.ms-word.template.macroEnabled.12', macros: true },
    doc: { label: 'Word 97-2003 (.doc)', desc: 'Pour les très anciennes versions de Word (application de bureau + LibreOffice).', mime: 'application/msword', desktop: true },
    dot: { label: 'Modèle Word 97–2003 (.dot)', desc: 'Modèle réutilisable pour les anciennes versions de Word.', mime: 'application/msword', desktop: true },
    uot: { label: 'Unified Office Format (.uot)', desc: 'Document modifiable dans les suites bureautiques compatibles UOF.', mime: 'application/vnd.uof.text', desktop: true },
    dbk: { label: 'DocBook (.dbk)', desc: 'Document XML structuré pour les manuels et la documentation technique.', mime: 'application/docbook+xml', desktop: true },
    xhtml: { label: 'Page web XHTML (.xhtml)', desc: 'Page web conforme à la syntaxe XML, pour les outils de publication.', mime: 'application/xhtml+xml', desktop: true },
    html: { label: 'Page web (.html)', desc: 'Un fichier unique, images incluses.', mime: 'text/html' },
    md: { label: 'Markdown (.md)', desc: 'Texte structuré pour le web et les wikis.', mime: 'text/markdown' },
    csv: { label: 'Tableau CSV (.csv)', desc: 'Exporte le premier tableau pour un tableur, sans mise en forme.', mime: 'text/csv' },
    tsv: { label: 'Tableau avec tabulations (.tsv)', desc: 'Exporte le premier tableau sous forme de texte séparé par des tabulations.', mime: 'text/tab-separated-values' },
    txt: { label: 'Texte brut (.txt)', desc: 'Uniquement le texte, sans mise en forme.', mime: 'text/plain' }
  };
  /** Formats que Ctrl+S peut réécrire tels quels */
  const SAVABLE = new Set(['docx', 'docm', 'dotx', 'dotm', 'odt', 'ott', 'rtf', 'md', 'txt', 'html']);
  const canSave = format => SAVABLE.has(format) || (!!window.plumeDesktop && ['doc', 'dot'].includes(format));
  /** Paquets Word (Office Open XML) */
  const WORD_XML = new Set(['docx', 'docm', 'dotx', 'dotm']);

  const extOf = name => (String(name).split('.').pop() || '').toLowerCase();

  /** Détecte le vrai format à partir des premiers octets (le nom peut mentir) */
  async function sniff(buf, ext) {
    const b = new Uint8Array(buf.slice(0, 8));
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return ['doc', 'dot', 'xls'].includes(ext) || Object.hasOwn(CONVERT, ext) ? ext : 'doc';
    if (b[0] === 0x7B && b[1] === 0x5C && b[2] === 0x72 && b[3] === 0x74) return 'rtf';
    if (b[0] === 0x50 && b[1] === 0x4B) {
      try {
        const z = await JSZip.loadAsync(buf);
        const mt = z.file('mimetype') ? (await z.file('mimetype').async('string')).trim() : '';
        if (/opendocument\.text/.test(mt)) return /template/.test(mt) ? 'ott' : 'odt';
        const types = z.file('[Content_Types].xml');
        if (types) {
          const xml = new DOMParser().parseFromString(await types.async('string'), 'application/xml');
          const parts = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/package/2006/content-types', 'Override');
          const wordTypes = {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml': 'docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml': 'dotx',
            'application/vnd.ms-word.document.macroenabled.main+xml': 'docm',
            'application/vnd.ms-word.template.macroenabledtemplate.main+xml': 'dotm'
          };
          for (const part of parts) {
            const type = wordTypes[part.getAttribute('ContentType')?.toLowerCase()];
            if (type && z.file(part.getAttribute('PartName')?.replace(/^\//, ''))) return type;
          }
        }
        if (mt === 'application/epub+zip') return 'epub';
        if (/sun\.xml\.writer/.test(mt)) return /template/.test(mt) ? 'stw' : 'sxw';
        if (z.file('word/document.xml')) return WORD_XML.has(ext) ? ext : 'docx';
        if (types || WORD_XML.has(ext)) throw new Error('UNSUPPORTED_PACKAGE');
      } catch (error) {
        if (error.message === 'UNSUPPORTED_PACKAGE') throw Object.assign(error, {
          userMessage: 'Ce fichier est un paquet Office, mais il ne contient pas de document Word. Pour un tableur ou une présentation, utilisez son application d’origine.'
        });
      }
      return ext;
    }
    if (ext === 'fodt' || ext === 'xml') {
      const head = decodeText(buf.slice(0, 2000));
      if (/office:document/.test(head)) return 'fodt';
      if (/w:wordDocument/.test(head)) return 'xml';
      if (/<!DOCTYPE\s+(?:article|book)\b[^>]*DocBook|https?:\/\/docbook\.org\/ns\/docbook/i.test(head)) return 'dbk';
    }
    return ext;
  }

  /* ---------- Module de conversion (bureau + LibreOffice) ---------- */
  async function converterAvailable() {
    try { return !!(await window.plumeDesktop?.converter?.available()); }
    catch { return false; }
  }

  async function openWithWriter(bytes, ext, registerImage) {
    const converted = await window.plumeDesktop.converter.convert(bytes, ext, 'docx');
    if (!converted) return null;
    const result = await DocxImport.importDocx(converted, { registerImage });
    return { ...result, bytes: new Uint8Array(converted) };
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
  async function importPdf(buf) {
    const lib = await loadPdfJs();
    const task = lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false });
    try {
      return await readPdf(await task.promise);
    } finally {
      await task.destroy();
    }
  }

  async function readPdf(doc) {
    const html = [];
    let first = null;
    const sizes = new Map();
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      if (!first) first = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str !== undefined).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], h: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10, w: it.width, eol: it.hasEOL, font: (tc.styles[it.fontName] || {}).fontFamily || '' }));
      for (const item of items) if (item.s.trim()) {
        const size = Math.round(item.h);
        sizes.set(size, (sizes.get(size) || 0) + 1);
      }
      page.cleanup();
      pages.push(items);
    }
    // taille du corps de texte = la plus fréquente
    const body = [...sizes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 11;
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
        para.text += (para.text && !para.text.endsWith('-') ? ' ' : '') + text;
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
      case 'odt': case 'ott': case 'fodt': return { ...(await Odt.importOdt(buf, { registerImage: reg })), format: ext === 'ott' ? 'ott' : 'odt' };
      case 'rtf': return { ...Rtf.importRtf(buf, { registerImage: reg }), format: 'rtf' };
      case 'epub': return { ...(await Epub.importEpub(buf, reg)), format: 'epub',
        notice: 'EPUB importé : les chapitres, le texte et les images intégrées sont récupérés. La mise en page de la liseuse est simplifiée.' };
      case 'pdf': return { ...(await importPdf(buf)), format: 'pdf', notice: 'PDF importé : le texte et la structure sont récupérés, la mise en page d’origine est simplifiée.' };
      case 'html': case 'htm': case 'xhtml': return { html: Sanitize.html(decodeText(buf)), format: 'html' };
      case 'md': case 'markdown': return { html: Markdown.toHtml(decodeText(buf)), format: 'md' };
      case 'csv': case 'tsv': {
        const rows = readDelimited(decodeText(buf), ext === 'tsv' ? '\t' : undefined);
        if (!rows.length) return { html: '<p><br></p>', format: ext };
        const n = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const body = rows.map((row, i) => {
          const cells = Array.from({ length: n }, (_, col) => {
            const cell = htmlEsc(row[col] || '').replace(/\n/g, '<br>');
            return `<td><p style="white-space:pre-wrap">${cell || '<br>'}</p></td>`;
          }).join('');
          return `<tr${i === 0 ? ' data-header="1"' : ''}>${cells}</tr>`;
        }).join('');
        return { html: `<table data-borders="all"><tbody>${body}</tbody></table><p><br></p>`, format: ext };
      }
      case 'doc': case 'dot': {
        const result = await converterAvailable() ? await openWithWriter(buf, ext, reg) : null;
        if (result) return { ...result, format: ext };
        const r = LegacyDoc.importDoc(buf);
        const miss = r.missing.length ? ` <b>Non repris :</b> ${r.missing.join(', ')}.` : '';
        return { ...r, format: ext, partial: true, notice: `<b>Word 97-2003</b> — Ouverture dans le navigateur : texte, titres, listes, tableaux et mise en forme simple récupérés.${miss} Pour une conversion complète, utilisez l’application de bureau Plume avec LibreOffice installé (conversion automatique).` };
      }
      case 'txt': case 'text': case '': default: {
        if (Object.hasOwn(CONVERT, ext)) {
          const label = CONVERT[ext];
          if (!await converterAvailable()) throw Object.assign(new Error('CONVERTER'), {
            userMessage: `Pour ouvrir ${label}, utilisez Plume sur ordinateur avec <a href="https://fr.libreoffice.org/download/telecharger-libreoffice/" target="_blank" rel="noopener">LibreOffice</a> installé.`
          });
          const result = await openWithWriter(buf, ext, reg);
          if (!result) throw Object.assign(new Error('CONVERSION_FAILED'), {
            userMessage: `LibreOffice n’a pas pu ouvrir ce fichier ${label}. La prise en charge dépend du format exact et des filtres installés.`
          });
          return { ...result, format: 'docx', notice: `${label} ouvert avec LibreOffice. Plume enregistrera une copie au format .docx.` };
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
  function parseDelimited(text, separator) {
    const rows = [];
    let row = [], value = '', quoted = false, started = false;
    const endRow = () => {
      if (row.length || value.trim() || (started && !value)) rows.push([...row, value]);
      row = [];
      value = '';
      started = false;
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char !== '"') value += char;
        else if (text[i + 1] === '"') { value += '"'; i++; }
        else quoted = false;
      } else if (char === '"' && !started) {
        quoted = started = true;
      } else if (char === separator) {
        row.push(value);
        value = '';
        started = false;
      } else if (char === '\n') {
        endRow();
      } else {
        value += char;
        started = true;
      }
    }
    endRow();
    return rows;
  }

  function detectSeparator(text) {
    const counts = new Map([[',', 0], [';', 0], ['\t', 0]]);
    let quoted = false, started = false, nonblank = false;
    for (const char of text) {
      if (char === '"' && (quoted || !started)) {
        quoted = !quoted;
        nonblank = true;
      } else if (!quoted && counts.has(char)) {
        counts.set(char, counts.get(char) + 1);
        started = false;
        nonblank = true;
      } else if (!quoted && char === '\n') {
        if (nonblank) break;
        started = false;
      } else if (!quoted) {
        started = true;
        if (char.trim()) nonblank = true;
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
  }

  // Une seule séparation pour tout le fichier, même dans les champs multilignes.
  function readDelimited(text, separator) {
    const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    return parseDelimited(clean, separator || detectSeparator(clean));
  }

  function exportDelimited(format, editor) {
    const table = editor.querySelector('table');
    if (!table?.rows.length) throw Object.assign(new Error('NO_TABLE'), {
      userMessage: 'Ajoutez un tableau au document avant de l’exporter en CSV ou TSV.'
    });
    const separator = format === 'tsv' ? '\t' : ',';
    const rows = Array.from(table.rows, () => []);
    for (const [index, row] of Array.from(table.rows).entries()) {
      let column = 0;
      for (const cell of row.cells) {
        while (rows[index][column] !== undefined) column++;
        rows[index][column] = cell.innerText.replace(/\u200B/g, '');
        const end = cell.rowSpan === 0
          ? index + row.parentElement.rows.length - row.sectionRowIndex
          : Math.min(rows.length, index + cell.rowSpan);
        for (let r = index; r < end; r++)
          for (let c = column; c < column + cell.colSpan; c++)
            rows[r][c] ??= '';
        column += cell.colSpan;
      }
    }
    const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
    const quote = value => /[,;\t"\r\n]/.test(value) || (width === 1 && !value.trim())
      ? '"' + value.replace(/"/g, '""') + '"' : value;
    const text = rows.map(row => Array.from({ length: width }, (_, i) => quote(row[i] || '')).join(separator)).join('\r\n');
    return new Blob(['\uFEFF', text, '\r\n'], { type: EXPORT[format].mime + ';charset=utf-8' });
  }

  /* ---------- Export ---------- */
  async function build(format, ctx) {
    // pendant l'export, les couleurs d'affichage des révisions ne doivent pas être lues comme mise en forme
    const neutral = WORD_XML.has(format) || EXPORT[format]?.desktop || ['odt', 'ott', 'rtf', 'md'].includes(format);
    if (neutral) document.body.classList.add('exporting-doc');
    try {
      // exports : document « propre » (sans artefacts de pagination ni décalages d'affichage)
      if (format !== 'pdf' && typeof Ed !== 'undefined' && ctx.editor === Ed.editor) return await Ed.withCleanDom(() => buildRaw(format, ctx));
      return await buildRaw(format, ctx);
    } finally { if (neutral) document.body.classList.remove('exporting-doc'); }
  }
  async function buildRaw(format, ctx) {
    switch (format) {
      case 'docx': case 'docm': case 'dotx': case 'dotm': return DocxExport.exportDocx(ctx, { kind: format });
      case 'odt': case 'ott': return Odt.exportOdt(ctx, { template: format === 'ott' });
      case 'rtf': return Rtf.exportRtf(ctx);
      case 'md': return new Blob([Markdown.fromEditor(ctx.editor)], { type: 'text/markdown;charset=utf-8' });
      case 'txt': return new Blob([ctx.editor.innerText.replace(/​/g, '')], { type: 'text/plain;charset=utf-8' });
      case 'csv': case 'tsv': return exportDelimited(format, ctx.editor);
      case 'html': return new Blob([await App.htmlDocument()], { type: 'text/html;charset=utf-8' });
      case 'epub': return Epub.exportEpub(ctx);
      case 'pdf': {
        // application de bureau : PDF vectoriel (texte sélectionnable) ; ailleurs : PDF direct page par page
        if (window.plumeDesktop && window.plumeDesktop.printToPdf) return new Blob([await window.plumeDesktop.printToPdf()], { type: 'application/pdf' });
        return rasterPdf(ctx);
      }
    }
    if (Object.hasOwn(EXPORT, format) && EXPORT[format].desktop) {
      const { label, mime } = EXPORT[format];
      if (!await converterAvailable()) throw Object.assign(new Error('CONVERTER'), {
        userMessage: `L’export ${label} nécessite l’application de bureau Plume et LibreOffice.`
      });
      const docx = await DocxExport.exportDocx(ctx);
      const conv = await window.plumeDesktop.converter.convert(await docx.arrayBuffer(), 'docx', format);
      if (!conv) throw Object.assign(new Error('CONVERSION_FAILED'), {
        userMessage: `LibreOffice n’a pas pu créer le fichier ${label}.`
      });
      return new Blob([conv], { type: mime });
    }
    throw new Error('Format d’export inconnu : ' + format);
  }

  /* ---------- PDF direct (navigateur, tablette, téléphone) ---------- */
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) scripts.set(src, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        scripts.delete(src);
        reject(new Error('Module PDF introuvable : ' + src));
      };
      document.head.append(script);
    }));
    return scripts.get(src);
  }
  /**
   * Fabrique un fichier PDF à partir des pages affichées : chaque page est rendue
   * en haute définition (≈ 200 ppp) avec ses en-têtes, pieds, images et polices.
   */
  async function rasterPdf(ctx, onProgress) {
    await loadScript('vendor/html2canvas.min.js');
    await loadScript('vendor/jspdf.umd.min.js');
    const { jsPDF } = window.jspdf;
    const pgs = Ed.pages || Ed.defaultPages(), n = pgs.length, page = pgs[0];
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
        const pg = pgs[i];
        // chaque page à sa taille (sections portrait / paysage)
        stage.style.width = pg.w + 'px'; stage.style.height = pg.h + 'px';
        copy.style.top = (-pg.y) + 'px'; copy.style.left = (-pg.x) + 'px';
        const canvas = await html2canvas(stage, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: -window.scrollX, scrollY: -window.scrollY });
        if (i > 0) pdf.addPage([pt(pg.w), pt(pg.h)], pg.w > pg.h ? 'landscape' : 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pt(pg.w), pt(pg.h), undefined, 'FAST');
        // liens cliquables conservés
        const sr = stage.getBoundingClientRect();
        for (const a of copy.querySelectorAll('#editor a[href^="http"], #editor a[href^="mailto:"]')) {
          for (const rr of a.getClientRects()) {
            const top = rr.top - sr.top;
            if (top < 0 || top > pg.h || !rr.width) continue;
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

  return { rasterPdf, OPEN, CONVERT, EXPORT, canSave, WORD_XML, ACCEPT, ALL_EXT, extOf, open, build, converterAvailable, importPdf, readDelimited };
})();
