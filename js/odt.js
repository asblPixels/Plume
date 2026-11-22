/* =====================================================================
   Plume — OpenDocument Texte (.odt, .ott, .fodt)
   Format natif de LibreOffice et OpenOffice, exporté par Google Docs.
   Lecture : ODF → HTML Plume.  Écriture : HTML Plume → ODF 1.3.
   ===================================================================== */
'use strict';

const Odt = (() => {
  const NS = {
    office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
    style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
    text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
    table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
    draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
    fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
    xlink: 'http://www.w3.org/1999/xlink',
    dc: 'http://purl.org/dc/elements/1.1/',
    meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
    number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
    svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
    loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0'
  };
  const MIME_ODT = 'application/vnd.oasis.opendocument.text';
  const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' };

  /* ---------- Accès XML par espace de noms (indépendant des préfixes) ---------- */
  const A = (n, ns, name) => n && n.getAttributeNS ? n.getAttributeNS(NS[ns], name) : null;
  const is = (n, ns, name) => n && n.nodeType === 1 && n.namespaceURI === NS[ns] && n.localName === name;
  const kids = n => n ? Array.from(n.children) : [];
  const first = (n, ns, name) => kids(n).find(c => is(c, ns, name)) || null;
  const deep = (n, ns, name) => n ? Array.from(n.getElementsByTagNameNS(NS[ns], name)) : [];
  const len = v => v ? U.cssToPx(String(v).trim().replace(/(\d)\s+(\w)/, '$1$2')) : 0;
  const ptOf = v => Math.round(U.pxToPt(len(v)) * 10) / 10;

  /* =====================================================================
     LECTURE
     ===================================================================== */
  async function importOdt(buffer, opts = {}) {
    let content, stylesDoc, metaDoc = null, zip = null;
    const head = new Uint8Array(buffer.slice ? buffer.slice(0, 4) : buffer);
    if (head[0] === 0x50 && head[1] === 0x4B) {          // archive ZIP (.odt/.ott)
      zip = await JSZip.loadAsync(buffer);
      const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };
      const c = await read('content.xml');
      if (!c) throw new Error('Ce fichier ne contient pas de texte OpenDocument (content.xml manquant).');
      content = parse(c);
      const s = await read('styles.xml'); stylesDoc = s ? parse(s) : null;
      const m = await read('meta.xml'); metaDoc = m ? parse(m) : null;
    } else {                                              // XML plat (.fodt)
      const txt = new TextDecoder('utf-8').decode(buffer);
      content = parse(txt); stylesDoc = content; metaDoc = content;
    }

    /* ---------- Styles ---------- */
    const styles = {};       // "famille:nom" -> {parent, p:{}, t:{}, cell:{}, col:{}, display, outline, breakBefore, breakAfter, listStyle}
    const listStyles = {};   // nom -> [{type:'ol'|'ul', fmt, bullet}]
    const fonts = {};        // nom de police -> famille
    const defaults = { paragraph: { p: {}, t: {} } };

    const readProps = (st, out) => {
      for (const c of kids(st)) {
        if (is(c, 'style', 'paragraph-properties')) {
          const p = out.p;
          const g = (ns, a) => A(c, ns, a);
          if (g('fo', 'text-align')) p.align = { start: 'left', end: 'right', left: 'left', right: 'right', center: 'center', justify: 'justify' }[g('fo', 'text-align')] || null;
          for (const [a, k] of [['margin-left', 'ml'], ['margin-right', 'mr'], ['margin-top', 'mt'], ['margin-bottom', 'mb'], ['text-indent', 'ti']]) if (g('fo', a) != null) p[k] = g('fo', a);
          if (g('fo', 'margin')) { p.mt = p.mt ?? g('fo', 'margin'); p.mb = p.mb ?? g('fo', 'margin'); }
          const lh = g('fo', 'line-height');
          if (lh) p.lh = /%$/.test(lh) ? parseFloat(lh) / 100 : lh;
          if (g('style', 'line-height-at-least')) p.lh = g('style', 'line-height-at-least');
          if (g('fo', 'background-color') && g('fo', 'background-color') !== 'transparent') p.bg = g('fo', 'background-color');
          for (const side of ['top', 'bottom', 'left', 'right']) {
            const b = g('fo', 'border-' + side) || g('fo', 'border');
            if (b && b !== 'none') p['b_' + side] = b;
          }
          if (g('fo', 'break-before') === 'page') out.breakBefore = true;
          if (g('fo', 'break-after') === 'page') out.breakAfter = true;
        } else if (is(c, 'style', 'text-properties')) {
          const t = out.t;
          const g = (ns, a) => A(c, ns, a);
          const fn = g('style', 'font-name') || g('fo', 'font-family');
          if (fn) t.font = fn.replace(/^'|'$/g, '');
          if (g('fo', 'font-size') && !/%$/.test(g('fo', 'font-size'))) t.size = ptOf(g('fo', 'font-size'));
          if (g('fo', 'font-weight')) t.b = g('fo', 'font-weight') === 'bold' || parseInt(g('fo', 'font-weight'), 10) >= 600;
          if (g('fo', 'font-style')) t.i = g('fo', 'font-style') === 'italic' || g('fo', 'font-style') === 'oblique';
          const ul = g('style', 'text-underline-style');
          if (ul) t.u = ul !== 'none';
          const lt = g('style', 'text-line-through-style');
          if (lt) t.s = lt !== 'none';
          if (g('fo', 'color')) t.color = g('fo', 'color');
          if (g('style', 'use-window-font-color') === 'true') t.color = '#000000';
          const bg = g('fo', 'background-color') || g('loext', 'char-shading-value');
          if (bg && bg !== 'transparent') t.bg = bg;
          const pos = g('style', 'text-position');
          if (pos) t.pos = /^super|^\d/.test(pos) && !/^-/.test(pos) && !/^0%?\s/.test(pos) ? (/^sub|^-/.test(pos) ? 'sub' : 'sup') : (/^sub|^-/.test(pos) ? 'sub' : null);
          if (g('fo', 'font-variant') === 'small-caps') t.sc = true;
          if (g('fo', 'text-transform') === 'uppercase') t.caps = true;
          if (g('fo', 'letter-spacing') && g('fo', 'letter-spacing') !== 'normal') t.ls = ptOf(g('fo', 'letter-spacing'));
        } else if (is(c, 'style', 'table-cell-properties')) {
          out.cell = out.cell || {};
          const bg = A(c, 'fo', 'background-color');
          if (bg && bg !== 'transparent') out.cell.bg = bg;
          const b = A(c, 'fo', 'border') || A(c, 'fo', 'border-top');
          if (b) out.cell.border = b !== 'none';
          const va = A(c, 'style', 'vertical-align');
          if (va) out.cell.va = va;
        } else if (is(c, 'style', 'table-column-properties')) {
          out.col = { w: len(A(c, 'style', 'column-width')) };
        } else if (is(c, 'style', 'table-properties')) {
          out.table = { w: len(A(c, 'style', 'width')), align: A(c, 'table', 'align') };
        } else if (is(c, 'style', 'graphic-properties')) {
          out.g = { wrap: A(c, 'style', 'wrap'), hpos: A(c, 'style', 'horizontal-pos') };
        }
      }
    };
    const collect = root => {
      if (!root) return;
      for (const fd of deep(root, 'style', 'font-face')) {
        const fam = A(fd, 'svg', 'font-family');
        fonts[A(fd, 'style', 'name')] = (fam || A(fd, 'style', 'name')).replace(/^'|'$/g, '');
      }
      for (const d of deep(root, 'style', 'default-style')) {
        const fam = A(d, 'style', 'family');
        const o = { p: {}, t: {} };
        readProps(d, o);
        defaults[fam] = o;
      }
      for (const s of deep(root, 'style', 'style')) {
        const o = { parent: A(s, 'style', 'parent-style-name'), p: {}, t: {}, display: (A(s, 'style', 'display-name') || A(s, 'style', 'name') || '').toLowerCase(), outline: A(s, 'style', 'default-outline-level'), listStyle: A(s, 'style', 'list-style-name') };
        readProps(s, o);
        styles[A(s, 'style', 'family') + ':' + A(s, 'style', 'name')] = o;
      }
      for (const ls of deep(root, 'text', 'list-style')) {
        const lv = [];
        for (const l of kids(ls)) {
          const level = parseInt(A(l, 'text', 'level') || '1', 10) - 1;
          if (is(l, 'text', 'list-level-style-number')) {
            const f = A(l, 'style', 'num-format') || '1';
            lv[level] = { type: 'ol', fmt: { '1': 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', '': 'none' }[f] || 'decimal', start: parseInt(A(l, 'text', 'start-value') || '1', 10) };
          } else if (is(l, 'text', 'list-level-style-bullet')) {
            const ch = A(l, 'text', 'bullet-char') || '•';
            lv[level] = { type: 'ul', fmt: ch === '◦' || ch === 'o' ? 'circle' : (ch === '▪' || ch === '■' || ch === '') ? 'square' : (ch === '–' || ch === '-') ? '"– "' : 'disc' };
          } else lv[level] = { type: 'ul', fmt: 'none' };
        }
        listStyles[A(ls, 'style', 'name')] = lv;
      }
    };
    collect(stylesDoc && stylesDoc !== content ? stylesDoc : null);
    collect(content);

    /** Propriétés résolues d'un style (avec ses parents) */
    const resolve = (family, name, depth = 0) => {
      const s = name && styles[family + ':' + name];
      const base = depth === 0 ? JSON.parse(JSON.stringify(defaults[family] || { p: {}, t: {} })) : { p: {}, t: {} };
      if (!s || depth > 15) return Object.assign(base, { names: [] });
      const parent = s.parent ? resolve(family, s.parent, depth + 1) : { p: {}, t: {}, names: [] };
      return {
        p: Object.assign(base.p, parent.p, s.p), t: Object.assign(base.t, parent.t, s.t),
        names: [s.display, ...parent.names], outline: s.outline || parent.outline,
        breakBefore: s.breakBefore, breakAfter: s.breakAfter, cell: s.cell, listStyle: s.listStyle || parent.listStyle
      };
    };
    const standard = resolve('paragraph', 'Standard');
    const baseT = standard.t, baseP = standard.p;
    const fontCss = f => DocxImport.cssFont(fonts[f] || f);

    const settings = {
      fontCss: fontCss(baseT.font || 'Liberation Serif'),
      size: baseT.size || 12,
      lineHeight: typeof baseP.lh === 'number' ? baseP.lh : 1.15,
      after: baseP.mb ? ptOf(baseP.mb) : 0,
      before: baseP.mt ? ptOf(baseP.mt) : 0,
      color: baseT.color || '#000000'
    };

    /* ---------- CSS ---------- */
    const pCss = (r, full) => {
      const s = [], p = r.p, t = r.t;
      if (p.align && p.align !== 'left') s.push('text-align:' + p.align);
      if (p.ml && len(p.ml)) s.push(`margin-left:${ptOf(p.ml)}pt`);
      if (p.mr && len(p.mr)) s.push(`margin-right:${ptOf(p.mr)}pt`);
      if (p.ti && len(p.ti)) s.push(`text-indent:${ptOf(p.ti)}pt`);
      const mt = p.mt != null ? ptOf(p.mt) : 0, mb = p.mb != null ? ptOf(p.mb) : 0;
      if (full || mt !== settings.before) s.push(`margin-top:${mt}pt`);
      if (full || mb !== settings.after) s.push(`margin-bottom:${mb}pt`);
      if (p.lh != null) { const v = typeof p.lh === 'number' ? Math.round(p.lh * 100) / 100 : ptOf(p.lh) + 'pt'; if (full || v !== settings.lineHeight) s.push('line-height:' + v); }
      if (p.bg) s.push('background-color:' + p.bg);
      for (const side of ['top', 'bottom', 'left', 'right']) if (p['b_' + side]) s.push(`border-${side}:${p['b_' + side]}`);
      s.push(...tCss(t, full ? {} : baseT, full));
      return s.join(';');
    };
    const tCss = (t, base, full) => {
      const s = [];
      if (t.font && (full || t.font !== base.font)) s.push('font-family:' + fontCss(t.font));
      if (t.size && (full || t.size !== base.size)) s.push(`font-size:${t.size}pt`);
      if (full || !!t.b !== !!base.b) s.push('font-weight:' + (t.b ? 'bold' : 'normal'));
      if (full || !!t.i !== !!base.i) s.push('font-style:' + (t.i ? 'italic' : 'normal'));
      const deco = [t.u && !base.u && 'underline', t.s && !base.s && 'line-through'].filter(Boolean);
      if (deco.length) s.push('text-decoration:' + deco.join(' '));
      if (t.color && (full || t.color !== base.color)) s.push('color:' + t.color);
      else if (full) s.push('color:#000000');
      if (t.bg && t.bg !== base.bg) s.push('background-color:' + t.bg);
      if (t.caps && !base.caps) s.push('text-transform:uppercase');
      if (t.sc && !base.sc) s.push('font-variant:small-caps');
      if (t.ls && t.ls !== base.ls) s.push(`letter-spacing:${t.ls}pt`);
      return s;
    };

    /* ---------- Images ---------- */
    const imgCache = {};
    async function imageUrl(href) {
      if (!href) return null;
      if (imgCache[href] !== undefined) return imgCache[href];
      let blob = null;
      if (zip) {
        const f = zip.file(href.replace(/^\.\//, ''));
        const ext = href.split('.').pop().toLowerCase();
        if (f && IMG_MIME[ext]) blob = new Blob([await f.async('uint8array')], { type: IMG_MIME[ext] });
      }
      return (imgCache[href] = blob ? (opts.registerImage ? opts.registerImage(blob) : URL.createObjectURL(blob)) : null);
    }
    async function binaryImage(node) {
      const bd = first(node, 'office', 'binary-data');
      if (!bd) return null;
      const bytes = Uint8Array.from(atob(bd.textContent.replace(/\s+/g, '')), c => c.charCodeAt(0));
      const isPng = bytes[0] === 0x89;
      const blob = new Blob([bytes], { type: isPng ? 'image/png' : 'image/jpeg' });
      return opts.registerImage ? opts.registerImage(blob) : URL.createObjectURL(blob);
    }

    /* ---------- Contenu ---------- */
    let commentOpen = {};
    async function inline(node, baseText) {
      let h = '';
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) { h += xmlEsc(n.data.replace(/\s+/g, ' ')); continue; }
        if (n.nodeType !== 1) continue;
        if (is(n, 'text', 'span')) {
          const r = resolve('text', A(n, 'text', 'style-name'));
          const t = Object.assign({}, baseText, r.t);
          const css = tCss(t, baseText, false).join(';');
          let inner = await inline(n, t);
          if (t.pos && t.pos !== baseText.pos) inner = `<${t.pos}>${inner}</${t.pos}>`;
          h += css ? `<span style="${css}">${inner}</span>` : inner;
        } else if (is(n, 'text', 'a')) {
          const href = A(n, 'xlink', 'href') || '';
          h += /^\s*javascript:/i.test(href) ? await inline(n, baseText) : `<a href="${xmlEsc(href)}">${await inline(n, baseText)}</a>`;
        } else if (is(n, 'text', 's')) h += ' '.repeat(Math.max(1, parseInt(A(n, 'text', 'c') || '1', 10) - 1)) + ' ';
        else if (is(n, 'text', 'tab')) h += '<span class="pl-tab">\t</span>';
        else if (is(n, 'text', 'line-break')) h += '<br>';
        else if (is(n, 'text', 'page-number')) h += '<span class="pl-field" contenteditable="false" data-field="page">1</span>';
        else if (is(n, 'text', 'page-count')) h += '<span class="pl-field" contenteditable="false" data-field="numpages">1</span>';
        else if (is(n, 'text', 'note')) {
          const body = first(n, 'text', 'note-body');
          const txt = body ? kids(body).map(p => p.textContent.trim()).filter(Boolean).join('\n') : '';
          h += `<span class="pl-fn" contenteditable="false" data-note="${xmlEsc(txt)}">*</span>`;
        } else if (is(n, 'text', 'bookmark') || is(n, 'text', 'bookmark-start')) {
          const nm = A(n, 'text', 'name'); if (nm) h += `<span class="pl-anchor" id="${xmlEsc(nm)}"></span>`;
        } else if (is(n, 'office', 'annotation')) {
          const cid = 'o' + (A(n, 'office', 'name') || uid());
          const author = (first(n, 'dc', 'creator') || {}).textContent || '';
          const date = (first(n, 'dc', 'date') || {}).textContent || '';
          const text = kids(n).filter(c => is(c, 'text', 'p') || is(c, 'text', 'list')).map(c => c.textContent).join('\n').trim();
          // LibreOffice : fil de discussion (loext:parent-name) et état résolu (loext:resolved)
          const parent = A(n, 'loext', 'parent-name');
          const done = A(n, 'loext', 'resolved') === 'true';
          const ini = (first(n, 'meta', 'creator-initials') || {}).textContent || '';
          const ref = `<span class="pl-cref" contenteditable="false" data-cid="${xmlEsc(cid)}" data-author="${xmlEsc(author)}" data-initials="${xmlEsc(ini)}" data-date="${xmlEsc(date)}" data-text="${xmlEsc(text)}"${parent ? ` data-parent="o${xmlEsc(parent)}"` : ''}${done && !parent ? ' data-done="1"' : ''}></span>`;
          if (A(n, 'office', 'name')) { if (!parent) h += `<span class="pl-cstart" data-cid="${xmlEsc(cid)}"></span>`; commentOpen[A(n, 'office', 'name')] = { ref, reply: !!parent }; }
          else h += ref;
        } else if (is(n, 'office', 'annotation-end')) {
          const nm = A(n, 'office', 'name');
          const ref = commentOpen[nm];
          if (ref) { const cid = 'o' + nm; h += (ref.reply ? '' : `<span class="pl-cend" data-cid="${xmlEsc(cid)}"></span>`) + ref.ref; delete commentOpen[nm]; }
        } else if (is(n, 'draw', 'frame') || is(n, 'draw', 'a')) {
          h += await frame(is(n, 'draw', 'a') ? (first(n, 'draw', 'frame') || n) : n);
        } else if (is(n, 'text', 'soft-page-break') || is(n, 'text', 'sequence-ref') || is(n, 'text', 'bookmark-end') || is(n, 'text', 'reference-mark-end')) { /* ignoré */ }
        else if (is(n, 'text', 'tracked-changes') || is(n, 'text', 'change-start') || is(n, 'text', 'change-end') || is(n, 'text', 'change')) { /* état actuel affiché */ }
        else h += await inline(n, baseText);          // champs, dates, renvois… : texte affiché
      }
      return h;
    }
    async function frame(f) {
      const w = len(A(f, 'svg', 'width')), hgt = len(A(f, 'svg', 'height'));
      const st = resolve('graphic', A(f, 'draw', 'style-name'));
      const g = (styles['graphic:' + A(f, 'draw', 'style-name')] || {}).g || {};
      const floatSide = g.wrap && g.wrap !== 'none' && g.wrap !== 'run-through' && A(f, 'text', 'anchor-type') !== 'as-char' ? (g.hpos === 'right' ? 'right' : g.hpos === 'left' ? 'left' : null) : null;
      const img = first(f, 'draw', 'image');
      if (img) {
        const url = (await imageUrl(A(img, 'xlink', 'href'))) || (await binaryImage(img));
        const alt = (first(f, 'svg', 'title') || first(f, 'svg', 'desc') || {}).textContent || A(f, 'draw', 'name') || '';
        if (url) return `<img src="${url}" alt="${xmlEsc(alt)}" style="${w ? `width:${Math.round(w)}px;height:${Math.round(hgt)}px;` : ''}${floatSide ? `float:${floatSide};margin:2px 8px;` : ''}">`;
        return '<span class="pl-field" title="Image non prise en charge">[Image]</span>';
      }
      const tb = first(f, 'draw', 'text-box');
      if (tb) {
        const box = document.createElement('div');
        await blocks(tb, box);
        return `<span class="pl-textbox" style="display:inline-block;${w ? `width:${Math.round(w)}px;` : ''}${floatSide ? `float:${floatSide};margin:2px 8px;` : ''}">${box.innerHTML}</span>`;
      }
      if (first(f, 'draw', 'object')) return '<span class="pl-field" title="Objet incorporé (graphique, formule…)">[Objet]</span>';
      return '';
    }

    const pageBreak = () => { const h = document.createElement('hr'); h.className = 'pl-pagebreak'; h.contentEditable = 'false'; return h; };

    async function para(n, target, inList) {
      const r = resolve('paragraph', A(n, 'text', 'style-name'));
      let tag = 'p', cls = '';
      if (is(n, 'text', 'h')) {
        const lvl = Math.min(6, Math.max(1, parseInt(A(n, 'text', 'outline-level') || r.outline || '1', 10)));
        tag = 'h' + lvl;
      }
      const names = r.names || [];
      if (names.some(x => x === 'title')) { tag = 'h1'; cls = 'title'; }
      else if (names.some(x => x === 'subtitle')) { tag = 'p'; cls = 'subtitle'; }
      else if (tag === 'p' && names.some(x => /^heading[ _]?(\d)$/.test(x))) tag = 'h' + Math.min(6, +names.find(x => /^heading[ _]?(\d)$/.test(x)).match(/(\d)$/)[1]);
      else if (tag === 'p' && names.some(x => x === 'quotations' || x === 'quote')) tag = 'blockquote';
      if (r.breakBefore && !inList) target.append(pageBreak());
      const b = document.createElement(inList ? 'p' : tag);
      if (cls && !inList) b.className = cls;
      const css = pCss(r, tag !== 'p' || !!cls);
      if (css) b.setAttribute('style', css);
      b.innerHTML = (await inline(n, Object.assign({}, r.t))) || '<br>';
      if (!b.textContent.trim() && !b.querySelector('img,br,.pl-field,.pl-fn,span')) b.innerHTML = '<br>';
      target.append(b);
      if (r.breakAfter && !inList) target.append(pageBreak());
    }

    async function list(n, target, level, lstName) {
      const name = A(n, 'text', 'style-name') || lstName;
      const def = (listStyles[name] || [])[level] || { type: 'ul', fmt: 'disc' };
      const L = document.createElement(def.type);
      if (!['disc', 'decimal'].includes(def.fmt)) L.style.listStyleType = def.fmt;
      if (def.start && def.start !== 1) L.setAttribute('start', def.start);
      for (const item of kids(n)) {
        if (!is(item, 'text', 'list-item') && !is(item, 'text', 'list-header')) continue;
        const li = document.createElement('li');
        if (is(item, 'text', 'list-header')) li.style.listStyleType = 'none';
        for (const c of kids(item)) {
          if (is(c, 'text', 'list')) await list(c, li, level + 1, name);
          else if (is(c, 'text', 'p') || is(c, 'text', 'h')) {
            const tmp = document.createElement('div');
            await para(c, tmp, true);
            const p = tmp.firstChild;
            if (!li.firstChild) { li.innerHTML = p.innerHTML; const st = p.getAttribute('style'); if (st) li.setAttribute('style', st); }
            else li.append(p);
          } else await blocks({ children: [c] }, li);
        }
        if (!li.firstChild) li.innerHTML = '<br>';
        L.append(li);
      }
      target.append(L);
    }

    async function tableEl(t) {
      const T = document.createElement('table');
      const tst = resolve('table', A(t, 'table', 'style-name'));
      const cols = [];
      const walkCols = node => { for (const c of kids(node)) {
        if (is(c, 'table', 'table-column')) {
          const rep = parseInt(A(c, 'table', 'number-columns-repeated') || '1', 10);
          const cs = styles['table-column:' + A(c, 'table', 'style-name')];
          for (let i = 0; i < Math.min(rep, 200); i++) cols.push(cs && cs.col ? cs.col.w : 0);
        } else if (is(c, 'table', 'table-columns') || is(c, 'table', 'table-header-columns') || is(c, 'table', 'table-column-group')) walkCols(c);
      } };
      walkCols(t);
      let anyBorder = false;
      if (cols.length && cols.every(Boolean)) {
        const cg = document.createElement('colgroup');
        cols.forEach(w => { const c = document.createElement('col'); c.style.width = Math.round(w) + 'px'; cg.append(c); });
        T.append(cg);
        T.style.width = Math.round(cols.reduce((a, b) => a + b, 0)) + 'px';
      }
      const ts = styles['table:' + A(t, 'table', 'style-name')];
      if (ts && ts.table && ts.table.align === 'center') { T.style.marginLeft = 'auto'; T.style.marginRight = 'auto'; }
      const tb = document.createElement('tbody'); T.append(tb);
      const rows = [];
      const walkRows = (node, header) => { for (const c of kids(node)) {
        if (is(c, 'table', 'table-row')) rows.push({ el: c, header });
        else if (is(c, 'table', 'table-header-rows')) walkRows(c, true);
        else if (is(c, 'table', 'table-rows') || is(c, 'table', 'table-row-group')) walkRows(c, header);
      } };
      walkRows(t, false);
      for (const { el: r, header } of rows) {
        const rep = Math.min(parseInt(A(r, 'table', 'number-rows-repeated') || '1', 10), 50);
        for (let k = 0; k < rep; k++) {
          const TR = document.createElement('tr');
          if (header) TR.dataset.header = '1';
          for (const c of kids(r)) {
            if (!is(c, 'table', 'table-cell')) continue;
            const crep = Math.min(parseInt(A(c, 'table', 'number-columns-repeated') || '1', 10), 50);
            for (let j = 0; j < crep; j++) {
              const TD = document.createElement('td');
              const cs = parseInt(A(c, 'table', 'number-columns-spanned') || '1', 10), rs = parseInt(A(c, 'table', 'number-rows-spanned') || '1', 10);
              if (cs > 1) TD.colSpan = cs;
              if (rs > 1) TD.rowSpan = rs;
              const cst = styles['table-cell:' + A(c, 'table', 'style-name')];
              if (cst && cst.cell) {
                if (cst.cell.bg) TD.style.backgroundColor = cst.cell.bg;
                if (cst.cell.border) anyBorder = true;
                if (cst.cell.va === 'middle') TD.style.verticalAlign = 'middle'; else if (cst.cell.va === 'bottom') TD.style.verticalAlign = 'bottom';
              }
              await blocks(c, TD);
              if (!TD.firstChild) TD.innerHTML = '<p><br></p>';
              TR.append(TD);
            }
          }
          tb.append(TR);
        }
      }
      T.dataset.borders = anyBorder ? 'all' : 'none';
      return T;
    }

    async function blocks(container, target) {
      for (const n of kids(container)) {
        if (is(n, 'text', 'p') || is(n, 'text', 'h')) await para(n, target, false);
        else if (is(n, 'text', 'list')) await list(n, target, 0, null);
        else if (is(n, 'table', 'table')) target.append(await tableEl(n));
        else if (is(n, 'text', 'section') || is(n, 'text', 'index-body') || is(n, 'text', 'illustration-index') || is(n, 'text', 'alphabetical-index') || is(n, 'text', 'bibliography') || is(n, 'text', 'object-index') || is(n, 'text', 'user-index') || is(n, 'text', 'table-index')) await blocks(n, target);
        else if (is(n, 'text', 'table-of-content')) { const ib = first(n, 'text', 'index-body'); if (ib) await blocks(ib, target); }
        else if (is(n, 'text', 'index-title')) await blocks(n, target);
        else if (is(n, 'draw', 'frame')) { const p = document.createElement('p'); p.innerHTML = await frame(n); target.append(p); }
        else if (is(n, 'text', 'soft-page-break')) { /* ignoré */ }
      }
    }

    const body = deep(content, 'office', 'text')[0];
    if (!body) throw new Error('Aucun texte trouvé dans ce document OpenDocument.');
    const out = document.createElement('div');
    await blocks(body, out);

    /* ---------- Page, en-tête, pied ---------- */
    const page = { w: U.cmToPx(21), h: U.cmToPx(29.7), mt: U.cmToPx(2), mr: U.cmToPx(2), mb: U.cmToPx(2), ml: U.cmToPx(2), mh: U.cmToPx(1), mf: U.cmToPx(1) };
    let header = '', footer = '';
    const masterRoot = stylesDoc || content;
    const master = deep(masterRoot, 'style', 'master-page').find(m => A(m, 'style', 'name') === 'Standard' || A(m, 'style', 'name') === 'Default') || deep(masterRoot, 'style', 'master-page')[0];
    if (master) {
      const pl = deep(masterRoot, 'style', 'page-layout').find(l => A(l, 'style', 'name') === A(master, 'style', 'page-layout-name'));
      const pp = pl && first(pl, 'style', 'page-layout-properties');
      if (pp) {
        const g = a => A(pp, 'fo', a);
        if (g('page-width')) page.w = len(g('page-width'));
        if (g('page-height')) page.h = len(g('page-height'));
        for (const [a, k] of [['margin-top', 'mt'], ['margin-right', 'mr'], ['margin-bottom', 'mb'], ['margin-left', 'ml']]) if (g(a)) page[k] = len(g(a));
      }
      // en ODF, l'en-tête est dans la marge haute : on l'ajoute pour retrouver la même zone de texte
      const hs = pl && first(pl, 'style', 'header-style'), fs = pl && first(pl, 'style', 'footer-style');
      const hp = hs && first(hs, 'style', 'header-footer-properties'), fp = fs && first(fs, 'style', 'header-footer-properties');
      const hEl = first(master, 'style', 'header'), fEl = first(master, 'style', 'footer');
      if (hEl) {
        const d = document.createElement('div'); await blocks(hEl, d); header = d.innerHTML;
        page.mh = page.mt;
        page.mt += (hp ? len(A(hp, 'fo', 'min-height')) + len(A(hp, 'fo', 'margin-bottom')) : U.cmToPx(1));
      }
      if (fEl) {
        const d = document.createElement('div'); await blocks(fEl, d); footer = d.innerHTML;
        page.mf = page.mb;
        page.mb += (fp ? len(A(fp, 'fo', 'min-height')) + len(A(fp, 'fo', 'margin-top')) : U.cmToPx(1));
      }
    }
    const empty = h => !h || !h.replace(/<br>|<p[^>]*>|<\/p>|\s|&nbsp;/g, '');

    const props = {
      title: metaDoc ? ((deep(metaDoc, 'dc', 'title')[0] || {}).textContent || '') : '',
      author: metaDoc ? ((deep(metaDoc, 'meta', 'initial-creator')[0] || deep(metaDoc, 'dc', 'creator')[0] || {}).textContent || '') : ''
    };
    return { html: out.innerHTML || '<p><br></p>', header: empty(header) ? '' : header, footer: empty(footer) ? '' : footer, page, settings, props };
  }

  function parse(str) {
    const d = new DOMParser().parseFromString(str, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('Le fichier OpenDocument est endommagé (XML illisible).');
    return d;
  }

  /* =====================================================================
     ÉCRITURE
     ===================================================================== */
  async function exportOdt({ editor, headerEl, footerEl, page, props, settings }) {
    const autoP = new Map(), autoT = new Map(), autoOther = [];
    const pics = [];   // {name, bytes, mime}
    const picBySrc = new Map();
    let picN = 0, frameN = 0, tableN = 0, noteN = 0, annN = 0;
    const cm = px => (U.pxToCm(px)).toFixed(3) + 'cm';
    const pt = px => (U.pxToPt(px)).toFixed(1) + 'pt';

    // échantillons : apparence de référence des styles nommés
    const zoomBox = document.getElementById('zoomBox');
    const prevZoom = zoomBox ? zoomBox.style.zoom : '';
    if (zoomBox) zoomBox.style.zoom = 1;
    const sample = document.createElement('div');
    sample.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:500px';
    sample.innerHTML = '<p>x</p><h1>x</h1><h2>x</h2><h3>x</h3><h4>x</h4><h5>x</h5><h6>x</h6><h1 class="title">x</h1><p class="subtitle">x</p><blockquote>x</blockquote><pre>x</pre>';
    editor.append(sample);
    const read = e => {
      const c = getComputedStyle(e);
      return {
        font: c.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''), size: (parseFloat(c.fontSize) * 0.75).toFixed(1) + 'pt',
        b: parseInt(c.fontWeight, 10) >= 600, i: c.fontStyle === 'italic', color: rgbToHex(c.color) || '#000000',
        align: { center: 'center', right: 'end', end: 'end', justify: 'justify' }[c.textAlign] || 'start',
        mt: pt(parseFloat(c.marginTop) || 0), mb: pt(parseFloat(c.marginBottom) || 0), ml: pt(parseFloat(c.marginLeft) || 0), mr: pt(parseFloat(c.marginRight) || 0),
        ti: pt(parseFloat(c.textIndent) || 0), lh: c.lineHeight === 'normal' ? '115%' : Math.round(parseFloat(c.lineHeight) / parseFloat(c.fontSize) * 100) + '%',
        bg: rgbToHex(c.backgroundColor), u: false, s: false, pos: null, caps: c.textTransform === 'uppercase', sc: c.fontVariantCaps === 'small-caps'
      };
    };
    const NAMED = ['Standard', 'Heading_20_1', 'Heading_20_2', 'Heading_20_3', 'Heading_20_4', 'Heading_20_5', 'Heading_20_6', 'Title', 'Subtitle', 'Quotations', 'Preformatted_20_Text'];
    const DISPLAY = { Standard: 'Default Paragraph Style', Heading_20_1: 'Heading 1', Heading_20_2: 'Heading 2', Heading_20_3: 'Heading 3', Heading_20_4: 'Heading 4', Heading_20_5: 'Heading 5', Heading_20_6: 'Heading 6', Title: 'Title', Subtitle: 'Subtitle', Quotations: 'Quotations', Preformatted_20_Text: 'Preformatted Text' };
    const base = {};
    Array.from(sample.children).forEach((e, i) => { base[NAMED[i]] = read(e); });
    sample.remove();
    if (zoomBox) zoomBox.style.zoom = prevZoom;

    const styleName = e => {
      const t = e.tagName;
      if (t === 'H1' && e.classList.contains('title')) return 'Title';
      if (t === 'P' && e.classList.contains('subtitle')) return 'Subtitle';
      if (/^H[1-6]$/.test(t)) return 'Heading_20_' + t[1];
      if (t === 'BLOCKQUOTE') return 'Quotations';
      if (t === 'PRE') return 'Preformatted_20_Text';
      return 'Standard';
    };
    const textProps = (p, b) => {
      const a = [];
      if (p.font !== b.font) a.push(`style:font-name="${xmlEsc(p.font)}" fo:font-family="'${xmlEsc(p.font)}'"`);
      if (p.size !== b.size) a.push(`fo:font-size="${p.size}" style:font-size-asian="${p.size}" style:font-size-complex="${p.size}"`);
      if (p.b !== b.b) a.push(`fo:font-weight="${p.b ? 'bold' : 'normal'}" style:font-weight-asian="${p.b ? 'bold' : 'normal'}" style:font-weight-complex="${p.b ? 'bold' : 'normal'}"`);
      if (p.i !== b.i) a.push(`fo:font-style="${p.i ? 'italic' : 'normal'}" style:font-style-asian="${p.i ? 'italic' : 'normal'}" style:font-style-complex="${p.i ? 'italic' : 'normal'}"`);
      if (p.color !== b.color) a.push(`fo:color="${p.color}"`);
      if (p.u) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
      if (p.s) a.push('style:text-line-through-style="solid" style:text-line-through-type="single"');
      if (p.hl) a.push(`fo:background-color="${p.hl}"`);
      if (p.pos) a.push(`style:text-position="${p.pos === 'sup' ? 'super' : 'sub'} 58%"`);
      if (p.caps && !b.caps) a.push('fo:text-transform="uppercase"');
      if (p.sc && !b.sc) a.push('fo:font-variant="small-caps"');
      return a.join(' ');
    };
    const fontsUsed = new Set([settings && settings.fontCss ? settings.fontCss.split(',')[0].replace(/["']/g, '').trim() : 'Calibri']);
    Object.values(base).forEach(b => fontsUsed.add(b.font));

    const pStyle = (e, named, extra = '', master = '') => {
      const me = read(e), b = base[named];
      const pa = [];
      if (me.align !== b.align) pa.push(`fo:text-align="${me.align}"`);
      if (me.mt !== b.mt) pa.push(`fo:margin-top="${me.mt}"`);
      if (me.mb !== b.mb) pa.push(`fo:margin-bottom="${me.mb}"`);
      if (me.ml !== b.ml && !extra) pa.push(`fo:margin-left="${me.ml}"`);
      if (me.mr !== b.mr) pa.push(`fo:margin-right="${me.mr}"`);
      if (me.ti !== b.ti) pa.push(`fo:text-indent="${me.ti}"`);
      if (e.style.lineHeight) pa.push(`fo:line-height="${/^[\d.]+$/.test(e.style.lineHeight) ? Math.round(parseFloat(e.style.lineHeight) * 100) + '%' : pt(U.cssToPx(e.style.lineHeight))}"`);
      if (me.bg && me.bg !== b.bg) pa.push(`fo:background-color="${me.bg}"`);
      if (extra && extra !== 'x') pa.push(extra);   // 'x' : simple marqueur « élément de liste »
      const ta = textProps({ ...me, u: false, s: false, hl: null, pos: null }, b);
      fontsUsed.add(me.font);
      if (!pa.length && !ta && !master) return named;
      const key = named + '|' + pa.join(' ') + '|' + ta + '|' + master;
      if (!autoP.has(key)) autoP.set(key, { name: 'P' + (autoP.size + 1), xml: `<style:style style:name="P${autoP.size + 1}" style:family="paragraph" style:parent-style-name="${named}"${master ? ` style:master-page-name="${master}"` : ''}>${pa.length ? `<style:paragraph-properties ${pa.join(' ')}/>` : ''}${ta ? `<style:text-properties ${ta}/>` : ''}</style:style>` });
      return autoP.get(key).name;
    };
    const tStyle = (node, blockEl, b) => {
      const pe = node.nodeType === 1 ? node : node.parentElement;
      const c = getComputedStyle(pe);
      const p = {
        font: c.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''), size: (parseFloat(c.fontSize) * 0.75).toFixed(1) + 'pt',
        b: parseInt(c.fontWeight, 10) >= 600, i: c.fontStyle === 'italic', color: rgbToHex(c.color) || '#000000', u: false, s: false, hl: null, pos: null,
        caps: c.textTransform === 'uppercase', sc: c.fontVariantCaps === 'small-caps'
      };
      for (let a = pe; a && a !== blockEl && a !== editor; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if ((ac.textDecorationLine || '').includes('underline') || a.tagName === 'U') p.u = true;
        if ((ac.textDecorationLine || '').includes('line-through') || a.tagName === 'S') p.s = true;
        if (!p.hl) p.hl = rgbToHex(ac.backgroundColor);
        if (!p.pos && (a.tagName === 'SUP' || ac.verticalAlign === 'super')) p.pos = 'sup';
        if (!p.pos && (a.tagName === 'SUB' || ac.verticalAlign === 'sub')) p.pos = 'sub';
      }
      if (p.pos) p.size = b.size;
      const me = read(blockEl);
      const ta = textProps(p, { ...b, font: me.font, size: me.size, b: me.b, i: me.i, color: me.color });
      fontsUsed.add(p.font);
      if (!ta) return null;
      if (!autoT.has(ta)) autoT.set(ta, { name: 'T' + (autoT.size + 1), xml: `<style:style style:name="T${autoT.size + 1}" style:family="text"><style:text-properties ${ta}/></style:style>` });
      return autoT.get(ta).name;
    };

    // images
    for (const img of [...editor.querySelectorAll('img'), ...(headerEl ? headerEl.querySelectorAll('img') : []), ...(footerEl ? footerEl.querySelectorAll('img') : [])]) {
      const src = img.getAttribute('src');
      if (!src || picBySrc.has(src)) continue;
      try {
        const blob = await (await fetch(src)).blob();
        let ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[blob.type];
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!ext) ext = 'png';
        const name = `Pictures/plume${++picN}.${ext}`;
        pics.push({ name, bytes, mime: IMG_MIME[ext] || 'image/png' });
        picBySrc.set(src, name);
      } catch { /* image ignorée */ }
    }

    /* ---------- Sérialisation ---------- */
    const spanText = s => {
      let x = '';
      const parts = s.split(/(\t|\n| {2,})/);
      for (const p of parts) {
        if (p === '\t') x += '<text:tab/>';
        else if (p === '\n') x += '<text:line-break/>';
        else if (/^ {2,}$/.test(p)) x += ` <text:s text:c="${p.length - 1}"/>`;
        else if (p) x += xmlEsc(p);
      }
      return x;
    };
    function runs(nodes, blockEl, b) {
      let out = '';
      for (const n of nodes) {
        if (n.nodeType === 3) {
          const t = n.data.replace(/​/g, '');
          if (!t) continue;
          const st = tStyle(n, blockEl, b);
          const tx = spanText(n.parentElement.closest('pre') ? t : t.replace(/\n/g, ' '));
          out += st ? `<text:span text:style-name="${st}">${tx}</text:span>` : tx;
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'BR') { out += '<text:line-break/>'; continue; }
        if (tag === 'IMG') {
          const name = picBySrc.get(n.getAttribute('src'));
          if (!name) continue;
          const w = n.offsetWidth || n.naturalWidth || 200, h = n.offsetHeight || n.naturalHeight || 150;
          out += `<draw:frame draw:style-name="fr1" draw:name="Image${++frameN}" text:anchor-type="as-char" svg:width="${cm(w)}" svg:height="${cm(h)}" draw:z-index="${frameN}"><draw:image xlink:href="${name}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${n.alt ? `<svg:title>${xmlEsc(n.alt)}</svg:title>` : ''}</draw:frame>`;
          continue;
        }
        if (n.classList.contains('pl-island')) { const im = n.querySelector('img'); if (im) out += runs([im], blockEl, b); continue; }
        if (n.classList.contains('pl-field')) { out += n.dataset.field === 'page' ? '<text:page-number text:select-page="current">1</text:page-number>' : n.dataset.field === 'numpages' ? '<text:page-count>1</text:page-count>' : xmlEsc(n.textContent); continue; }
        if (n.classList.contains('pl-fn')) {
          noteN++;
          out += `<text:note text:id="ftn${noteN}" text:note-class="footnote"><text:note-citation>${noteN}</text:note-citation><text:note-body>${String(n.dataset.note || '').split('\n').map(l => `<text:p text:style-name="Footnote">${xmlEsc(l)}</text:p>`).join('')}</text:note-body></text:note>`;
          continue;
        }
        if (n.classList.contains('pl-anchor')) { if (n.id) out += `<text:bookmark text:name="${xmlEsc(n.id)}"/>`; continue; }
        // les réponses suivent leur commentaire racine (même plage), avec loext:parent-name
        if (n.classList.contains('pl-cstart')) {
          const ref = editor.querySelector(`.pl-cref[data-cid="${CSS.escape(n.dataset.cid)}"]`);
          if (ref) { out += annotation(ref, 'a' + n.dataset.cid); for (const r of repliesOf(n.dataset.cid)) out += annotation(r, 'a' + r.dataset.cid, 'a' + n.dataset.cid, ref); }
          continue;
        }
        if (n.classList.contains('pl-cend')) { out += `<office:annotation-end office:name="${xmlEsc('a' + n.dataset.cid)}"/>`; for (const r of repliesOf(n.dataset.cid)) out += `<office:annotation-end office:name="${xmlEsc('a' + r.dataset.cid)}"/>`; continue; }
        if (n.classList.contains('pl-cref')) {
          const par = n.dataset.parent && editor.querySelector(`.pl-cref[data-cid="${CSS.escape(n.dataset.parent)}"]`);
          if (par) { if (!editor.querySelector(`.pl-cstart[data-cid="${CSS.escape(n.dataset.parent)}"]`)) out += annotation(n, null, 'a' + n.dataset.parent, par); continue; }
          if (!editor.querySelector(`.pl-cstart[data-cid="${CSS.escape(n.dataset.cid)}"]`)) out += annotation(n, repliesOf(n.dataset.cid).length ? 'a' + n.dataset.cid : null);
          continue;
        }
        if (n.classList.contains('pl-del')) continue;              // état actuel du texte : suppressions appliquées
        if (n.classList.contains('pl-tab')) { out += '<text:tab/>'; continue; }
        if (tag === 'A' && n.getAttribute('href')) {
          out += `<text:a xlink:type="simple" xlink:href="${xmlEsc(n.getAttribute('href'))}">${runs(Array.from(n.childNodes), blockEl, b)}</text:a>`;
          continue;
        }
        if (n.contentEditable === 'false' && !n.classList.contains('pl-tab')) continue;
        out += runs(Array.from(n.childNodes), blockEl, b);
      }
      return out;
    }
    function repliesOf(cid) { return Array.from(editor.querySelectorAll(`.pl-cref[data-parent="${CSS.escape(cid)}"]`)); }
    function annotation(ref, name, parentName, root) {
      annN++;
      const done = (root || ref).dataset.done === '1';
      return `<office:annotation${name ? ` office:name="${xmlEsc(name)}"` : ''}${parentName ? ` loext:parent-name="${xmlEsc(parentName)}"` : ''} loext:resolved="${done}"><dc:creator>${xmlEsc(ref.dataset.author || '')}</dc:creator>${ref.dataset.date ? `<dc:date>${xmlEsc(ref.dataset.date.replace(/Z$/, ''))}</dc:date>` : ''}${String(ref.dataset.text || '').split('\n').map(l => `<text:p>${xmlEsc(l)}</text:p>`).join('')}</office:annotation>`;
    }
    const isBlock = n => n.nodeType === 1 && /^(P|H[1-6]|DIV|BLOCKQUOTE|PRE|UL|OL|LI|TABLE|HR)$/.test(n.tagName);
    function blocks(container) {
      let out = '', inl = [];
      const flush = () => {
        if (inl.some(n => n.nodeType === 1 || n.textContent.trim())) out += `<text:p text:style-name="${pStyle(container, 'Standard')}">${runs(inl, container, base.Standard)}</text:p>`;
        inl = [];
      };
      for (const n of Array.from(container.childNodes)) {
        if (!isBlock(n)) { inl.push(n); continue; }
        flush();
        out += block(n);
      }
      flush();
      return out;
    }
    let breakNext = false;
    // sections : une page maîtresse par section (taille, orientation, marges, colonnes)
    const markers = Array.from(editor.children).filter(e => e.tagName === 'HR' && e.classList.contains('pl-section'));
    const secs = [...markers.map(m => { try { return Object.assign({}, page, { cols: null, type: null }, JSON.parse(m.dataset.sect || '{}')); } catch { return page; } }), page];
    let pendingMaster = secs.length > 1 ? 'MP0' : '';
    function block(e) {
      const t = e.tagName;
      if (t === 'HR') {
        if (e.classList.contains('pl-pagebreak')) { breakNext = 'page'; return ''; }
        if (e.classList.contains('pl-colbreak')) { breakNext = 'column'; return ''; }
        if (e.classList.contains('pl-section')) { pendingMaster = 'MP' + (markers.indexOf(e) + 1); return ''; }
        return `<text:p text:style-name="${ensureOther('Hr', '<style:style style:name="Hr" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.5pt solid #000000" fo:padding="0cm"/></style:style>')}"/>`;
      }
      if (t === 'TABLE') return table(e);
      if (t === 'UL' || t === 'OL') return list(e, 0);
      if (e.classList.contains('pl-toc')) {
        return Array.from(e.querySelectorAll('.toc-line')).map(l => `<text:p text:style-name="Standard">${xmlEsc((l.querySelector('.txt') || l).textContent)}<text:tab/>${xmlEsc((l.querySelector('.pg') || {}).textContent || '')}</text:p>`).join('');
      }
      if (Array.from(e.children).some(isBlock)) return blocks(e);
      const named = styleName(e);
      if (e.dataset.pbb === '1') breakNext = breakNext || 'page';
      const keep = [e.dataset.keepnext === '1' ? 'fo:keep-with-next="always"' : '', e.dataset.keeplines === '1' ? 'fo:keep-together="always"' : '', e.dataset.widow === '0' ? 'fo:widows="0" fo:orphans="0"' : ''].filter(Boolean).join(' ');
      const extra = [breakNext && !pendingMaster ? `fo:break-before="${breakNext}"` : '', keep].filter(Boolean).join(' ');
      breakNext = false;
      const st = pStyle(e, named, extra, pendingMaster);
      pendingMaster = '';
      const inner = runs(Array.from(e.childNodes), e, base[named]);
      if (/^Heading/.test(named)) return `<text:h text:style-name="${st}" text:outline-level="${named.slice(-1)}">${inner}</text:h>`;
      return `<text:p text:style-name="${st}">${inner}</text:p>`;
    }
    function ensureOther(name, xml) { if (!autoOther.some(x => x.name === name)) autoOther.push({ name, xml }); return name; }
    let listN = 0;
    function list(L, level) {
      let lname = null;
      if (level === 0) {
        listN++;
        lname = 'L' + listN;
        let lv = '';
        const scan = [];
        const walk = (l, d) => { if (d > 9 || scan[d]) return; scan[d] = { tag: l.tagName, type: getComputedStyle(l).listStyleType, start: l.getAttribute('start') }; l.querySelectorAll(':scope > li > ul, :scope > li > ol').forEach(x => walk(x, d + 1)); };
        walk(L, 0);
        for (let i = 0; i < 10; i++) {
          const f = scan[i] || (scan[0] && scan[0].tag === 'OL' ? { tag: 'OL', type: 'decimal' } : { tag: 'UL', type: 'disc' });
          const indent = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${(0.635 * (i + 1)).toFixed(3)}cm" fo:text-indent="-0.635cm" fo:margin-left="${(0.635 * (i + 1)).toFixed(3)}cm"/></style:list-level-properties>`;
          if (f.tag === 'OL') {
            const nf = { 'lower-alpha': 'a', 'upper-alpha': 'A', 'lower-roman': 'i', 'upper-roman': 'I', 'lower-latin': 'a', 'upper-latin': 'A' }[f.type] || '1';
            lv += `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${nf}"${f.start && f.start !== '1' ? ` text:start-value="${parseInt(f.start, 10)}"` : ''}>${indent}</text:list-level-style-number>`;
          } else {
            const ch = { circle: '◦', square: '▪', none: ' ' }[f.type] || (/^["']/.test(f.type || '') ? f.type.replace(/["']/g, '').trim() || '–' : '•');
            lv += `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${xmlEsc(ch)}">${indent}</text:list-level-style-bullet>`;
          }
        }
        autoOther.push({ name: lname, xml: `<text:list-style style:name="${lname}">${lv}</text:list-style>` });
      }
      let out = `<text:list${lname ? ` text:style-name="${lname}"` : ''}>`;
      for (const li of Array.from(L.children)) {
        if (li.tagName !== 'LI') continue;
        out += '<text:list-item>';
        let inl = [];
        const flush = () => { out += `<text:p text:style-name="${pStyle(li, 'Standard', 'x')}">${runs(inl, li, base.Standard)}</text:p>`; inl = []; };
        let had = false;
        for (const n of Array.from(li.childNodes)) {
          if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { if (inl.length || !had) { flush(); had = true; } out += list(n, level + 1); }
          else if (n.nodeType === 1 && n.tagName === 'TABLE') { if (inl.length) flush(); out += table(n); had = true; }
          else if (n.nodeType === 1 && isBlock(n)) { if (inl.length) flush(); out += `<text:p text:style-name="${pStyle(n, styleName(n), 'x')}">${runs(Array.from(n.childNodes), n, base[styleName(n)])}</text:p>`; had = true; }
          else inl.push(n);
        }
        if (inl.length || !had) flush();
        out += '</text:list-item>';
      }
      return out + '</text:list>';
    }
    function table(T) {
      tableN++;
      const tname = 'Tableau' + tableN;
      const rows = Array.from(T.rows);
      const grid = [];
      rows.forEach((tr, r) => {
        grid[r] = grid[r] || [];
        let c = 0;
        for (const td of Array.from(tr.cells)) {
          while (grid[r][c]) c++;
          for (let i = 0; i < (td.rowSpan || 1); i++) for (let j = 0; j < (td.colSpan || 1); j++) {
            grid[r + i] = grid[r + i] || [];
            grid[r + i][c + j] = { td, start: i === 0 && j === 0 };
          }
          c += td.colSpan || 1;
        }
      });
      const nCols = Math.max(1, ...grid.map(r => r.length));
      const cols = T.querySelectorAll(':scope > colgroup > col');
      let widths = cols.length === nCols ? Array.from(cols).map(c => c.getBoundingClientRect().width || U.cssToPx(c.style.width)) : [];
      if (!widths.length || widths.some(w => !w)) { const tw = T.getBoundingClientRect().width || 600; widths = new Array(nCols).fill(tw / nCols); }
      const total = widths.reduce((a, b) => a + b, 0);
      const borders = T.dataset.borders !== 'none';
      let st = `<style:style style:name="${tname}" style:family="table"><style:table-properties style:width="${cm(total)}" table:align="${T.style.marginLeft === 'auto' ? 'center' : 'margins'}"/></style:style>`;
      widths.forEach((w, i) => { st += `<style:style style:name="${tname}.C${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${cm(w)}"/></style:style>`; });
      autoOther.push({ name: tname, xml: st });
      const cellStyle = td => {
        const bg = rgbToHex(getComputedStyle(td).backgroundColor);
        const va = { middle: 'middle', bottom: 'bottom' }[getComputedStyle(td).verticalAlign] || 'top';
        const key = `Cell|${borders}|${bg}|${va}`;
        const name = 'Ce' + (autoOther.filter(x => x.name.startsWith('Ce')).length + 1);
        const found = autoOther.find(x => x.key === key);
        if (found) return found.name;
        autoOther.push({ name, key, xml: `<style:style style:name="${name}" style:family="table-cell"><style:table-cell-properties fo:padding="0.097cm" fo:border="${borders ? '0.5pt solid #000000' : 'none'}"${bg ? ` fo:background-color="${bg}"` : ''} style:vertical-align="${va}"/></style:style>` });
        return name;
      };
      let x = `<table:table table:name="${tname}" table:style-name="${tname}">`;
      widths.forEach((w, i) => { x += `<table:table-column table:style-name="${tname}.C${i + 1}"/>`; });
      let inHeader = false;
      grid.forEach((row, r) => {
        const tr = rows[r];
        const header = tr && tr.dataset.header;
        if (header && !inHeader && r === 0) { x += '<table:table-header-rows>'; inHeader = true; }
        if (!header && inHeader) { x += '</table:table-header-rows>'; inHeader = false; }
        x += '<table:table-row>';
        for (let c = 0; c < nCols; c++) {
          const cell = row[c];
          if (!cell) { x += `<table:table-cell table:style-name="${cellStyle(rows[0].cells[0] || T)}"><text:p/></table:table-cell>`; continue; }
          if (!cell.start) { x += '<table:covered-table-cell/>'; continue; }
          const td = cell.td;
          let content = blocks(td);
          if (!content) content = '<text:p/>';
          x += `<table:table-cell table:style-name="${cellStyle(td)}"${td.colSpan > 1 ? ` table:number-columns-spanned="${td.colSpan}"` : ''}${td.rowSpan > 1 ? ` table:number-rows-spanned="${td.rowSpan}"` : ''} office:value-type="string">${content}</table:table-cell>`;
        }
        x += '</table:table-row>';
      });
      if (inHeader) x += '</table:table-header-rows>';
      return x + '</table:table>';
    }

    const bodyXml = blocks(editor) || '<text:p/>';
    pendingMaster = ''; breakNext = false;
    const hdr = headerEl && headerEl.textContent.trim() ? blocks(headerEl) : '';
    const ftr = footerEl && (footerEl.textContent.trim() || footerEl.querySelector('.pl-field')) ? blocks(footerEl) : '';

    const NSDECL = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join(' ');
    const fontDecls = '<office:font-face-decls>' + [...fontsUsed].filter(Boolean).map(f => `<style:font-face style:name="${xmlEsc(f)}" svg:font-family="'${xmlEsc(f)}'"/>`).join('') + '</office:font-face-decls>';
    const auto = [...autoP.values(), ...autoT.values()].map(x => x.xml).join('') + autoOther.map(x => x.xml).join('') +
      '<style:style style:name="fr1" style:family="graphic" style:parent-style-name="Graphics"><style:graphic-properties style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>';
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NSDECL} office:version="1.3">${fontDecls}<office:automatic-styles>${auto}</office:automatic-styles><office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;

    // styles nommés + mise en page
    const named = NAMED.map(n => {
      const b = base[n], N = base.Standard;
      const tp = n === 'Standard'
        ? `style:font-name="${xmlEsc(b.font)}" fo:font-size="${b.size}" fo:color="${b.color}"`
        : textProps({ ...b, u: false, s: false, hl: null, pos: null }, { ...N, b: false, i: false, caps: false, sc: false });
      const pp = `fo:margin-top="${b.mt}" fo:margin-bottom="${b.mb}" fo:line-height="${b.lh}"${b.align !== 'start' ? ` fo:text-align="${b.align}"` : ''}${b.ml !== '0.0pt' ? ` fo:margin-left="${b.ml}"` : ''}${b.mr !== '0.0pt' ? ` fo:margin-right="${b.mr}"` : ''}${n.startsWith('Heading') ? ' fo:keep-with-next="always"' : ''}`;
      return `<style:style style:name="${n}" style:display-name="${DISPLAY[n]}" style:family="paragraph"${n !== 'Standard' ? ' style:parent-style-name="Standard" style:next-style-name="Standard"' : ''}${n.startsWith('Heading') ? ` style:default-outline-level="${n.slice(-1)}" style:class="text"` : ''}><style:paragraph-properties ${pp}/>${tp ? `<style:text-properties ${tp}/>` : ''}</style:style>`;
    }).join('') + '<style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="0.6cm" fo:text-indent="-0.6cm" fo:margin-top="0cm" fo:margin-bottom="0cm"/><style:text-properties fo:font-size="10pt"/></style:style>' +
      '<style:style style:name="Graphics" style:family="graphic"><style:graphic-properties text:anchor-type="as-char" svg:y="0cm" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>';
    const hh = hdr ? Math.max(0.5, U.pxToCm(page.mt - page.mh) - 0.5) : 0;
    const fh = ftr ? Math.max(0.5, U.pxToCm(page.mb - page.mf) - 0.5) : 0;
    const colsXml = c => {
      if (!c || !(c.n > 1)) return '';
      const gap = cm(c.space != null ? c.space : U.cmToPx(1.25));
      const sep = c.sep ? '<style:column-sep style:width="0.02cm" style:color="#000000" style:height="100%" style:style="solid"/>' : '';
      if (c.eq === false && Array.isArray(c.list) && c.list.length >= c.n) {
        const tot = c.list.slice(0, c.n).reduce((a, k) => a + k.w + (k.space || 0), 0) || 1;
        return `<style:columns fo:column-count="${c.n}">${sep}${c.list.slice(0, c.n).map((k, j) => `<style:column style:rel-width="${Math.round((k.w + (k.space || 0)) / tot * 65535)}*" fo:start-indent="0cm" fo:end-indent="${j < c.n - 1 ? cm(k.space || 0) : '0cm'}"/>`).join('')}</style:columns>`;
      }
      return `<style:columns fo:column-count="${c.n}" fo:column-gap="${gap}">${sep}</style:columns>`;
    };
    const layoutOf = (name, P) => `<style:page-layout style:name="${name}"><style:page-layout-properties fo:page-width="${cm(P.w)}" fo:page-height="${cm(P.h)}" style:print-orientation="${P.w > P.h ? 'landscape' : 'portrait'}" fo:margin-top="${hdr ? cm(P.mh) : cm(P.mt)}" fo:margin-bottom="${ftr ? cm(P.mf) : cm(P.mb)}" fo:margin-left="${cm(P.ml)}" fo:margin-right="${cm(P.mr)}">${colsXml(P.cols)}</style:page-layout-properties>` +
      `<style:header-style>${hdr ? `<style:header-footer-properties fo:min-height="0cm" fo:margin-bottom="${hh.toFixed(3)}cm"/>` : ''}</style:header-style><style:footer-style>${ftr ? `<style:header-footer-properties fo:min-height="0cm" fo:margin-top="${fh.toFixed(3)}cm"/>` : ''}</style:footer-style></style:page-layout>`;
    const layout = layoutOf('pm1', page) + (secs.length > 1 ? secs.map((P, i) => layoutOf('pmS' + i, P)).join('') : '');
    const hfXml = `${hdr ? `<style:header>${hdr}</style:header>` : ''}${ftr ? `<style:footer>${ftr}</style:footer>` : ''}`;
    const masters = secs.length > 1 ? secs.map((P, i) => `<style:master-page style:name="MP${i}" style:display-name="Section ${i + 1}" style:page-layout-name="pmS${i}">${hfXml}</style:master-page>`).join('') : '';
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NSDECL} office:version="1.3">${fontDecls}<office:styles><style:default-style style:family="paragraph"><style:paragraph-properties style:tab-stop-distance="1.25cm"/><style:text-properties style:font-name="${xmlEsc(base.Standard.font)}" fo:font-size="${base.Standard.size}" fo:language="fr" fo:country="BE"/></style:default-style>${named}</office:styles><office:automatic-styles>${layout}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${hfXml}</style:master-page>${masters}</office:master-styles></office:document-styles>`;
    // les styles automatiques des en-têtes/pieds doivent être dans styles.xml : on y recopie les mêmes
    const stylesFinal = stylesXml.replace('<office:automatic-styles>', '<office:automatic-styles>' + (hdr || ftr ? auto : ''));

    const now = new Date().toISOString().replace(/\.\d+Z$/, '');
    const meta = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NSDECL} office:version="1.3"><office:meta><meta:generator>Plume/${(window.App && App.VERSION) || '1'} (Pixel's ASBL)</meta:generator><dc:title>${xmlEsc(props.title || '')}</dc:title><meta:initial-creator>${xmlEsc(props.author || '')}</meta:initial-creator><dc:creator>${xmlEsc(props.author || '')}</dc:creator><meta:creation-date>${xmlEsc((props.created || now).replace(/Z$/, ''))}</meta:creation-date><dc:date>${now}</dc:date><dc:language>fr-BE</dc:language></office:meta></office:document-meta>`;
    const settingsXml = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-settings xmlns:office="${NS.office}" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3"><office:settings/></office:document-settings>`;
    const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIME_ODT}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>${pics.map(p => `<manifest:file-entry manifest:full-path="${p.name}" manifest:media-type="${p.mime}"/>`).join('')}</manifest:manifest>`;

    const zip = new JSZip();
    zip.file('mimetype', MIME_ODT, { compression: 'STORE', createFolders: false });
    zip.file('content.xml', content, { createFolders: false });
    zip.file('styles.xml', stylesFinal, { createFolders: false });
    zip.file('meta.xml', meta, { createFolders: false });
    zip.file('settings.xml', settingsXml, { createFolders: false });
    zip.file('META-INF/manifest.xml', manifest, { createFolders: false });
    for (const p of pics) zip.file(p.name, p.bytes, { createFolders: false });
    if (typeof EmbedFonts !== 'undefined') await EmbedFonts.applyOdt(zip);
    return zip.generateAsync({ type: 'blob', mimeType: MIME_ODT, compression: 'DEFLATE' });
  }

  return { importOdt, exportOdt };
})();
