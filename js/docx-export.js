/* =====================================================================
   Plume — export .docx (HTML éditable → Office Open XML)
   Les styles Word (Normal, Titre 1…) sont générés à partir de l'aspect
   réel du document dans Plume, puis seules les différences sont écrites
   en mise en forme directe : le document reste propre dans Word.
   ===================================================================== */
'use strict';

const DocxExport = (() => {

  const NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
    'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word" ' +
    'xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ' +
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
    'xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"';
  const IGNORABLE = 'mc:Ignorable="w14 w15 wp14"';
  const unb64 = s => decodeURIComponent(escape(atob(s)));
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  const STYLE_MAP = {
    p: 'Normal', h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', h4: 'Heading4', h5: 'Heading5', h6: 'Heading6',
    'h1.title': 'Title', 'p.subtitle': 'Subtitle', blockquote: 'Quote', pre: 'PlumeCode'
  };
  const STYLE_NAMES = {
    Normal: 'Normal', Heading1: 'heading 1', Heading2: 'heading 2', Heading3: 'heading 3', Heading4: 'heading 4',
    Heading5: 'heading 5', Heading6: 'heading 6', Title: 'Title', Subtitle: 'Subtitle', Quote: 'Quote', PlumeCode: 'Code'
  };
  const SAMPLE_HTML = '<p>x</p><h1>x</h1><h2>x</h2><h3>x</h3><h4>x</h4><h5>x</h5><h6>x</h6><h1 class="title">x</h1><p class="subtitle">x</p><blockquote>x</blockquote><pre>x</pre>';
  const SAMPLE_KEYS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h1.title', 'p.subtitle', 'blockquote', 'pre'];

  const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'DL', 'DD', 'DT', 'ADDRESS', 'NAV', 'ASIDE', 'FIGCAPTION', 'CENTER']);
  const isBlock = n => n.nodeType === 1 && BLOCK_TAGS.has(n.tagName);

  const firstFamily = f => (f || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  const pxPt = px => Math.round(px * 0.75 * 100) / 100;
  const twip = px => Math.round(px * 15);
  const halfPt = px => Math.round(px * 1.5);

  /** Lit les propriétés calculées utiles d'un élément */
  function readBlock(e) {
    const c = getComputedStyle(e);
    const fs = parseFloat(c.fontSize);
    const lhRaw = e.style.lineHeight;
    let line = null;
    if (lhRaw) {
      if (/^[\d.]+$/.test(lhRaw)) line = { rule: 'auto', v: Math.round(240 * parseFloat(lhRaw)) };
      else line = { rule: 'exact', v: twip(U.cssToPx(lhRaw, fs)) };
    }
    return {
      font: firstFamily(c.fontFamily), sz: halfPt(fs), b: parseInt(c.fontWeight, 10) >= 600, i: c.fontStyle === 'italic',
      color: rgbToHex(c.color) || '#000000', caps: c.textTransform === 'uppercase', smallCaps: c.fontVariantCaps === 'small-caps' || c.fontVariant === 'small-caps',
      spacing: c.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(c.letterSpacing) * 15),
      jc: { center: 'center', right: 'right', end: 'right', justify: 'both' }[c.textAlign] || 'left',
      ml: twip(parseFloat(c.marginLeft) || 0), mr: twip(parseFloat(c.marginRight) || 0), ti: twip(parseFloat(c.textIndent) || 0),
      before: twip(parseFloat(c.marginTop) || 0), after: twip(parseFloat(c.marginBottom) || 0),
      lineRatio: c.lineHeight === 'normal' ? 1.15 : parseFloat(c.lineHeight) / fs, line,
      bg: rgbToHex(c.backgroundColor),
      borders: ['top', 'bottom', 'left', 'right'].map(s => {
        const w = parseFloat(c['border' + s[0].toUpperCase() + s.slice(1) + 'Width']);
        const st = c['border' + s[0].toUpperCase() + s.slice(1) + 'Style'];
        return w > 0 && st !== 'none' ? { side: s, sz: Math.max(2, Math.round(w * 0.75 * 8)), color: rgbToHex(c['border' + s[0].toUpperCase() + s.slice(1) + 'Color']) || '#000000', pad: Math.round(parseFloat(c['padding' + s[0].toUpperCase() + s.slice(1)]) * 0.75) } : null;
      }).filter(Boolean)
    };
  }

  function rPrXml(p, base, extra = '') {
    const o = [];
    if (extra) o.push(extra);
    if (p.font !== base.font) o.push(`<w:rFonts w:ascii="${xmlEsc(p.font)}" w:hAnsi="${xmlEsc(p.font)}" w:eastAsia="${xmlEsc(p.font)}" w:cs="${xmlEsc(p.font)}"/>`);
    if (p.b !== base.b) o.push(p.b ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>');
    if (p.i !== base.i) o.push(p.i ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>');
    if (p.caps && !base.caps) o.push('<w:caps/>');
    if (p.smallCaps && !base.smallCaps) o.push('<w:smallCaps/>');
    if (p.strike) o.push('<w:strike/>');
    if (p.spacing !== base.spacing && p.spacing) o.push(`<w:spacing w:val="${p.spacing}"/>`);
    if (p.color !== base.color) o.push(`<w:color w:val="${p.color.slice(1)}"/>`);
    if (p.sz !== base.sz) o.push(`<w:sz w:val="${p.sz}"/><w:szCs w:val="${p.sz}"/>`);
    if (p.hl) o.push(`<w:shd w:val="clear" w:color="auto" w:fill="${p.hl.slice(1)}"/>`);
    if (p.u) o.push('<w:u w:val="single"/>');
    if (p.vert) o.push(`<w:vertAlign w:val="${p.vert}"/>`);
    return o.length ? `<w:rPr>${o.join('')}</w:rPr>` : '';
  }

  /* =====================================================================
     Export principal
     ===================================================================== */
  async function exportDocx({ editor, headerEl, footerEl, page, props, source }) {
    /* ---------- Parties d'origine (document ouvert depuis un .docx) ---------- */
    const src = source || null;
    const srcRead = async p => { const f = src && src.file(p); return f ? f.async('string') : null; };
    const srcRelsCache = {};
    const relsPathOf = part => part.replace(/([^/]+)$/, '_rels/$1.rels');
    const parseRels = xml => {
      const r = {};
      if (!xml) return r;
      for (const e of new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('Relationship'))
        r[e.getAttribute('Id')] = { target: e.getAttribute('Target'), type: e.getAttribute('Type'), mode: e.getAttribute('TargetMode') };
      return r;
    };
    const resolve = (part, target) => {
      if (target.startsWith('/')) return target.slice(1);
      const base = part.split('/').slice(0, -1);
      for (const seg of target.split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
      return base.join('/');
    };
    const relTarget = (fromPart, toPath) => {
      const a = fromPart.split('/').slice(0, -1), b = toPath.split('/');
      while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
      return '../'.repeat(a.length) + b.join('/');
    };
    const srcRels = async part => (srcRelsCache[part] ??= parseRels(await srcRead(relsPathOf(part))));
    const srcCT = src ? new DOMParser().parseFromString(await srcRead('[Content_Types].xml') || '<Types/>', 'application/xml') : null;
    const copied = new Set();   // parties recopiées telles quelles
    /** Recopie une partie d'origine et, récursivement, tout ce qu'elle référence */
    async function copyPart(path) {
      if (!src || copied.has(path) || !src.file(path)) return;
      copied.add(path);
      const rp = relsPathOf(path);
      if (src.file(rp)) {
        copied.add(rp);
        for (const r of Object.values(await srcRels(path))) if (r.mode !== 'External') await copyPart(resolve(path, r.target));
      }
    }
    // Préchargement des relations utilisées par les îlots (sérialisation synchrone ensuite)
    const islandParts = new Set();
    for (const root of [editor, headerEl, footerEl]) if (root) root.querySelectorAll('.pl-island').forEach(i => islandParts.add(i.dataset.part || 'word/document.xml'));
    for (const p of islandParts) await srcRels(p);

    // Pour mesurer, on se place à 100 % et en page claire
    const zoomBox = document.getElementById('zoomBox');
    const prevZoom = zoomBox ? zoomBox.style.zoom : '';
    if (zoomBox) zoomBox.style.zoom = 1;
    const darkPage = document.documentElement.classList.contains('page-dark');
    document.documentElement.classList.remove('page-dark');
    editor.dataset.exporting = '1';

    // Échantillons des styles (lus puis retirés immédiatement)
    const samples = document.createElement('div');
    samples.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:500px';
    samples.innerHTML = SAMPLE_HTML;
    editor.append(samples);
    const base = {};
    Array.from(samples.children).forEach((e, i) => { base[STYLE_MAP[SAMPLE_KEYS[i]]] = readBlock(e); });
    samples.remove();

    // Images : récupération des octets
    const imgData = new Map();
    const allImgs = [...editor.querySelectorAll('img:not(.pl-island img)'), ...(headerEl ? headerEl.querySelectorAll('img:not(.pl-island img)') : []), ...(footerEl ? footerEl.querySelectorAll('img:not(.pl-island img)') : [])];
    let imgN = 0;
    for (const img of allImgs) {
      const src = img.getAttribute('src');
      if (!src || imgData.has(src)) continue;
      try {
        const blob = await (await fetch(src)).blob();
        let ext = ({ 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' })[blob.type];
        let bytes;
        if (ext) bytes = new Uint8Array(await blob.arrayBuffer());
        else { bytes = await toPng(img); ext = 'png'; }
        if (bytes) imgData.set(src, { bytes, ext, name: `plume-image${++imgN}.${ext}` });
      } catch (e) { console.warn('Image ignorée', src, e); }
    }

    const numbering = { abstracts: [], nums: [] };
    let inDel = false, revId = 1000;
    const commentMap = {}, commentData = {};
    let commentN = 0;
    const commentId = cid => (commentMap[cid] ??= String(commentN++));
    /** Réécrit un îlot (XML d'origine) en recréant ses relations dans la partie cible */
    function islandXml(n, part) {
      let xml;
      try { xml = unb64(n.dataset.x); } catch { return ''; }
      const srcPart = n.dataset.part || 'word/document.xml';
      const rels = srcRelsCache[srcPart] || {};
      xml = xml.replace(/\b(r:[A-Za-z]+|o:relid)="([^"]+)"/g, (m, attr, rid) => {
        const r = rels[rid];
        if (!r) return m;
        if (r.mode === 'External') return `${attr}="${part.addRel(r.type, r.target, true)}"`;
        const path = resolve(srcPart, r.target);
        pendingCopies.add(path);
        return `${attr}="${part.addRel(r.type, relTarget(part.name, path))}"`;
      });
      // ids de dessin uniques
      xml = xml.replace(/(<wp:docPr\b[^>]*\bid=")(\d+)"/g, (m, a) => `${a}${5000 + docPrId++}"`);
      return xml;
    }
    const pendingCopies = new Set();
    const srcStylesXml = src ? await srcRead('word/styles.xml') : null;
    const srcStyleIds = new Set(srcStylesXml ? Array.from(srcStylesXml.matchAll(/w:styleId="([^"]+)"/g), m => m[1]) : []);
    const srcNumXml = src ? await srcRead('word/numbering.xml') : null;
    const srcNumIds = new Set(srcNumXml ? Array.from(srcNumXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g), m => m[1]) : []);
    const footnotes = [];
    let docPrId = 1, bookmarkId = 0;

    /** Contexte de sérialisation propre à une partie (document, en-tête…) */
    function makePart(name) {
      const rels = [];
      return {
        name, rels,
        addRel(type, target, external) {
          const found = rels.find(r => r.type === type && r.target === target);
          if (found) return found.id;
          const id = 'rId' + (rels.length + 100);
          rels.push({ id, type, target, external });
          return id;
        }
      };
    }

    /* ---------- Sérialisation des blocs ---------- */
    function blocks(container, part, inherit = {}) {
      let out = '';
      let inlineBuf = [];
      const flushInline = () => {
        if (!inlineBuf.length) return;
        const hasContent = inlineBuf.some(n => n.nodeType === 1 || n.textContent.trim());
        if (hasContent) out += paragraphFromNodes(inlineBuf, container, inherit.style || 'Normal', null, part, true);
        inlineBuf = [];
      };
      for (const n of Array.from(container.childNodes)) {
        if (n.nodeType === 3 || (n.nodeType === 1 && !isBlock(n))) {
          if (n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'SCRIPT')) continue;
          inlineBuf.push(n); continue;
        }
        if (n.nodeType !== 1) continue;
        flushInline();
        out += block(n, part, inherit);
      }
      flushInline();
      return out;
    }

    function styleOf(e) {
      const t = e.tagName.toLowerCase();
      if (e.dataset && e.dataset.pstyle && srcStyleIds.has(e.dataset.pstyle)) {
        // style d'origine conservé si le type de bloc n'a pas été changé dans Plume
        const mapped = STYLE_MAP[t === 'h1' && e.classList.contains('title') ? 'h1.title' : t === 'p' && e.classList.contains('subtitle') ? 'p.subtitle' : t];
        const isHeading = /^Heading\d$|^Title$|^Subtitle$|^Quote$/.test(mapped || '');
        if (!isHeading || /heading|titre|title|subtitle|quote|citation/i.test(e.dataset.pstyle)) return e.dataset.pstyle;
      }
      if (t === 'h1' && e.classList.contains('title')) return 'Title';
      if (t === 'p' && e.classList.contains('subtitle')) return 'Subtitle';
      return STYLE_MAP[t] || null;
    }

    function block(e, part, inherit) {
      const t = e.tagName;
      if (t === 'HR') {
        if (e.classList.contains('pl-pagebreak')) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
      }
      if (t === 'TABLE') return table(e, part);
      if (t === 'UL' || t === 'OL') return list(e, part, 0, null);
      if (e.classList.contains('pl-toc')) return toc(e);
      if (e.classList.contains('pl-notes')) return '';
      const st = styleOf(e);
      const hasBlockKids = Array.from(e.children).some(isBlock);
      if (hasBlockKids) return blocks(e, part, { style: st || inherit.style });
      return paragraphFromNodes(Array.from(e.childNodes), e, st || inherit.style || 'Normal', null, part, false);
    }

    /** Liste à puces / numérotée */
    function list(L, part, level, inst) {
      if (!inst && L.dataset.numid && srcNumIds.has(L.dataset.numid)) inst = { numId: L.dataset.numid, original: true };
      if (!inst) {
        // nouvelle instance de numérotation : formats par niveau à partir de la structure
        const fmts = [];
        const scan = (lst, d) => {
          if (d > 8) return;
          if (!fmts[d]) fmts[d] = { tag: lst.tagName, type: getComputedStyle(lst).listStyleType, start: lst.tagName === 'OL' ? parseInt(lst.getAttribute('start') || '1', 10) : 1 };
          lst.querySelectorAll(':scope > li > ul, :scope > li > ol').forEach(s => scan(s, d + 1));
        };
        scan(L, 0);
        const absId = numbering.abstracts.length;
        numbering.abstracts.push(fmts);
        numbering.nums.push(absId);
        inst = { numId: 'NEW' + (numbering.nums.length - 1) };
      }
      let out = '';
      for (const li of Array.from(L.children)) {
        if (li.tagName !== 'LI') { out += block(li, part, {}); continue; }
        let inl = [];
        let first = true;
        const numPr = () => {
          const v = first ? `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${inst.numId}"/></w:numPr>` : null;
          first = false; return v;
        };
        const flush = () => {
          if (!inl.length) return;
          out += paragraphFromNodes(inl, li, 'Normal', numPr() || `<w:ind w:left="${720 * (level + 1)}"/>`, part, true, true);
          inl = [];
        };
        for (const n of Array.from(li.childNodes)) {
          if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { flush(); if (first) { out += paragraphFromNodes([], li, 'Normal', numPr(), part, true, true); } out += list(n, part, level + 1, inst); }
          else if (n.nodeType === 1 && isBlock(n)) {
            flush();
            if (n.tagName === 'TABLE') out += table(n, part);
            else out += paragraphFromNodes(Array.from(n.childNodes), n, styleOf(n) || 'Normal', numPr() || `<w:ind w:left="${720 * (level + 1)}"/>`, part, false, true);
          } else inl.push(n);
        }
        flush();
        if (first) out += paragraphFromNodes([], li, 'Normal', numPr(), part, true, true);
      }
      return out;
    }

    /** Paragraphe à partir d'un bloc HTML */
    function paragraphFromNodes(nodes, blockEl, styleId, numPrXml, part, blockIsParent, isListItem) {
      const b = base[styleId] || (srcStyleIds.has(styleId) ? readBlock(blockEl) : base.Normal);
      const me = readBlock(blockEl);
      const ppr = [];
      if (styleId !== 'Normal') ppr.push(`<w:pStyle w:val="${styleId}"/>`);
      if (numPrXml) ppr.push(numPrXml);
      const pBdr = me.borders.filter(x => !b.borders.some(y => y.side === x.side));
      if (pBdr.length && !blockIsParent) ppr.push('<w:pBdr>' + pBdr.map(x => `<w:${x.side} w:val="single" w:sz="${x.sz}" w:space="${x.pad}" w:color="${x.color.slice(1)}"/>`).join('') + '</w:pBdr>');
      if (me.bg && me.bg !== b.bg && !blockIsParent) ppr.push(`<w:shd w:val="clear" w:color="auto" w:fill="${me.bg.slice(1)}"/>`);
      // espacement
      const sp = [];
      if (!blockIsParent || isListItem) {
        if (me.before !== b.before) sp.push(`w:before="${me.before}"`);
        if (me.after !== b.after && !isListItem) sp.push(`w:after="${me.after}"`);
      }
      if (me.line) sp.push(`w:line="${me.line.v}" w:lineRule="${me.line.rule}"`);
      if (sp.length) ppr.push(`<w:spacing ${sp.join(' ')}/>`);
      if (!isListItem && !blockIsParent && (me.ml !== b.ml || me.mr !== b.mr || me.ti !== b.ti)) {
        const ti = me.ti >= 0 ? `w:firstLine="${me.ti}"` : `w:hanging="${-me.ti}"`;
        ppr.push(`<w:ind w:left="${me.ml}" w:right="${me.mr}" ${ti}/>`);
      }
      if (me.jc !== b.jc) ppr.push(`<w:jc w:val="${me.jc}"/>`);
      // marque de paragraphe : taille de la police du bloc
      const markR = rPrXml({ ...me, strike: false, u: false, hl: null, vert: null }, b);
      if (markR) ppr.push(markR);
      return `<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${runs(nodes, blockEl, b, part)}</w:p>`;
    }

    /** Suite de runs pour des nœuds en ligne */
    function runs(nodes, blockEl, b, part) {
      let out = '';
      let cur = null; // {rpr, text}
      const flush = () => { if (cur) { out += `<w:r>${cur.rpr}${cur.text}</w:r>`; cur = null; } };
      const emit = (rpr, xml) => { if (cur && cur.rpr === rpr) cur.text += xml; else { flush(); cur = { rpr, text: xml }; } };

      const textXml = s => {
        let x = '';
        const parts = s.split(/(\t|\n)/);
        for (const p of parts) {
          if (p === '\t') x += '<w:tab/>';
          else if (p === '\n') x += '<w:br/>';
          else if (p) x += inDel ? `<w:delText xml:space="preserve">${xmlEsc(p)}</w:delText>` : `<w:t xml:space="preserve">${xmlEsc(p)}</w:t>`;
        }
        return x;
      };
      const propsFor = node => {
        const pe = node.nodeType === 1 ? node : node.parentElement;
        const c = getComputedStyle(pe);
        const fs = parseFloat(c.fontSize);
        const p = {
          font: firstFamily(c.fontFamily), sz: halfPt(fs), b: parseInt(c.fontWeight, 10) >= 600, i: c.fontStyle === 'italic',
          color: rgbToHex(c.color) || '#000000', caps: c.textTransform === 'uppercase', smallCaps: c.fontVariantCaps === 'small-caps',
          spacing: c.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(c.letterSpacing) * 15),
          u: false, strike: false, hl: null, vert: null
        };
        for (let a = pe; a && a !== blockEl && a !== editor; a = a.parentElement) {
          const ac = getComputedStyle(a);
          const deco = ac.textDecorationLine || '';
          if (deco.includes('underline') || a.tagName === 'U') p.u = true;
          if (deco.includes('line-through') || a.tagName === 'S' || a.tagName === 'STRIKE' || a.tagName === 'DEL') p.strike = true;
          if (!p.hl) p.hl = rgbToHex(ac.backgroundColor);
          if (!p.vert) {
            if (a.tagName === 'SUP' || ac.verticalAlign === 'super') p.vert = 'superscript';
            else if (a.tagName === 'SUB' || ac.verticalAlign === 'sub') p.vert = 'subscript';
          }
        }
        if (p.vert) p.sz = b.sz === p.sz ? b.sz : Math.round(p.sz / 0.83); // sup/sub : taille d'origine
        if (p.vert && Math.abs(p.sz - b.sz) <= 2) p.sz = b.sz;
        return p;
      };

      const walk = (list) => {
        for (const n of list) {
          if (n.nodeType === 1 && n.classList.contains('pl-island')) { flush(); out += islandXml(n, part); continue; }
          if (n.nodeType === 1 && n.classList.contains('pl-cstart')) { flush(); out += `<w:commentRangeStart w:id="${commentId(n.dataset.cid)}"/>`; continue; }
          if (n.nodeType === 1 && n.classList.contains('pl-cend')) { flush(); out += `<w:commentRangeEnd w:id="${commentId(n.dataset.cid)}"/>`; continue; }
          if (n.nodeType === 1 && n.classList.contains('pl-cref')) {
            flush();
            const id = commentId(n.dataset.cid);
            commentData[id] = { author: n.dataset.author || '', initials: n.dataset.initials || '', date: n.dataset.date || '', text: n.dataset.text || '' };
            out += `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`;
            continue;
          }
          if (n.nodeType === 1 && (n.classList.contains('pl-ins') || n.classList.contains('pl-del'))) {
            flush();
            const del = n.classList.contains('pl-del');
            const saveOut = out; out = '';
            const prevDel = inDel; inDel = del;
            walk(Array.from(n.childNodes)); flush();
            inDel = prevDel;
            out = saveOut + `<w:${del ? 'del' : 'ins'} w:id="${revId++}" w:author="${xmlEsc(n.dataset.author || 'Plume')}"${n.dataset.date ? ` w:date="${xmlEsc(n.dataset.date)}"` : ''}>` + out + `</w:${del ? 'del' : 'ins'}>`;
            continue;
          }
          if (n.nodeType === 3) {
            const t = n.textContent.replace(/[\r]/g, '');
            if (!t) continue;
            const text = /\S| /.test(t) || t.includes('\t') ? t : (t.includes('\n') ? '' : t);
            if (!text) continue;
            emit(rPrXml(propsFor(n), b), textXml(text.replace(/\n/g, n.parentElement.closest('pre') ? '\n' : ' ')));
            continue;
          }
          if (n.nodeType !== 1) continue;
          const tag = n.tagName;
          if (tag === 'BR') { emit(rPrXml(propsFor(n.parentElement), b), '<w:br/>'); continue; }
          if (tag === 'IMG') { flush(); out += drawing(n, part); continue; }
          if (n.classList.contains('pl-anchor')) { flush(); const id = bookmarkId++; out += `<w:bookmarkStart w:id="${id}" w:name="${xmlEsc(n.id || ('_pl' + id))}"/><w:bookmarkEnd w:id="${id}"/>`; continue; }
          if (n.classList.contains('pl-field') && n.dataset.field) {
            flush();
            const rp = rPrXml(propsFor(n), b);
            const instr = n.dataset.field === 'page' ? 'PAGE' : 'NUMPAGES';
            out += `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${instr} \\* MERGEFORMAT </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>${xmlEsc(n.textContent || '1')}</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
            continue;
          }
          if (n.classList.contains('pl-fn')) {
            flush();
            footnotes.push(n.dataset.note || '');
            out += `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footnotes.length}"/></w:r>`;
            continue;
          }
          if (tag === 'A' && n.getAttribute('href')) {
            flush();
            const href = n.getAttribute('href');
            let open;
            if (href.startsWith('#')) open = `<w:hyperlink w:anchor="${xmlEsc(href.slice(1))}" w:history="1">`;
            else open = `<w:hyperlink r:id="${part.addRel(REL + '/hyperlink', href, true)}" w:history="1">`;
            const saveOut = out; out = '';
            walk(Array.from(n.childNodes)); flush();
            out = saveOut + open + out + '</w:hyperlink>';
            continue;
          }
          if (n.contentEditable === 'false' && !n.classList.contains('pl-tab')) continue;
          if (isBlock(n)) { walk(Array.from(n.childNodes)); continue; }
          walk(Array.from(n.childNodes));
        }
      };
      walk(nodes);
      flush();
      return out;
    }

    /** Image en ligne */
    function drawing(img, part) {
      const d = imgData.get(img.getAttribute('src'));
      if (!d) return '';
      const rid = part.addRel(REL + '/image', 'media/' + d.name);
      const w = img.offsetWidth || img.naturalWidth || 200;
      const h = img.offsetHeight || img.naturalHeight || 150;
      const cx = U.pxToEmu(w), cy = U.pxToEmu(h);
      const id = docPrId++;
      const alt = xmlEsc(img.getAttribute('alt') || '');
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Image ${id}" descr="${alt}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${d.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    }

    /** Tableau */
    function table(T, part) {
      const rows = Array.from(T.rows);
      // grille : occupation des cellules (fusions)
      const grid = [];
      rows.forEach((tr, r) => {
        grid[r] = grid[r] || [];
        let c = 0;
        for (const td of Array.from(tr.cells)) {
          while (grid[r][c]) c++;
          const cs = td.colSpan || 1, rs = td.rowSpan || 1;
          for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) {
            grid[r + i] = grid[r + i] || [];
            grid[r + i][c + j] = { td, start: i === 0 && j === 0, top: i === 0, rowStart: r, colStart: c, cs, rs };
          }
          c += cs;
        }
      });
      const nCols = Math.max(1, ...grid.map(r => r.length));
      // largeurs de colonnes
      let widths = [];
      const cols = T.querySelectorAll(':scope > colgroup > col');
      if (cols.length === nCols) widths = Array.from(cols).map(c => c.getBoundingClientRect().width || U.cssToPx(c.style.width));
      if (!widths.length || widths.some(w => !w)) {
        widths = new Array(nCols).fill(0);
        grid.forEach(r => r.forEach((cell, c) => { if (cell && cell.start && cell.cs === 1 && !widths[c]) widths[c] = cell.td.getBoundingClientRect().width; }));
        const total = T.getBoundingClientRect().width || 600;
        const known = widths.filter(Boolean);
        const rest = (total - known.reduce((a, b) => a + b, 0)) / Math.max(1, nCols - known.length);
        widths = widths.map(w => w || Math.max(20, rest));
      }
      const tw = widths.map(twip);
      const borders = T.dataset.borders !== 'none';
      const bdr = borders
        ? '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('') + '</w:tblBorders>'
        : '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="nil"/>`).join('') + '</w:tblBorders>';
      const center = T.style.marginLeft === 'auto' ? '<w:jc w:val="center"/>' : '';
      let x = `<w:tbl><w:tblPr><w:tblW w:w="${tw.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${center}${bdr}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`;
      x += '<w:tblGrid>' + tw.map(w => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>';
      grid.forEach((row, r) => {
        const tr = rows[r];
        let trPr = '';
        if (tr) {
          if (tr.dataset.header) trPr += '<w:tblHeader/>';
          if (tr.style.height) trPr += `<w:trHeight w:val="${twip(U.cssToPx(tr.style.height))}"/>`;
        }
        x += `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}`;
        let c = 0;
        while (c < nCols) {
          const cell = row[c];
          if (!cell) { x += `<w:tc><w:tcPr><w:tcW w:w="${tw[c]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`; c++; continue; }
          const w = tw.slice(c, c + cell.cs).reduce((a, b) => a + b, 0);
          const span = cell.cs > 1 ? `<w:gridSpan w:val="${cell.cs}"/>` : '';
          if (!cell.top) {
            x += `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span}<w:vMerge/></w:tcPr><w:p/></w:tc>`;
          } else {
            const td = cell.td;
            const cs = getComputedStyle(td);
            const bg = rgbToHex(cs.backgroundColor);
            const va = { middle: 'center', bottom: 'bottom' }[cs.verticalAlign];
            const tcPr = `<w:tcW w:w="${w}" w:type="dxa"/>${span}${cell.rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}${bg ? `<w:shd w:val="clear" w:color="auto" w:fill="${bg.slice(1)}"/>` : ''}${va ? `<w:vAlign w:val="${va}"/>` : ''}`;
            let content = blocks(td, part, {});
            if (!/<w:p[ >\/]/.test(content) || /<\/w:tbl>$/.test(content)) content += '<w:p/>';
            x += `<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`;
          }
          c += cell.cs;
        }
        x += '</w:tr>';
      });
      return x + '</w:tbl>';
    }

    /** Table des matières → vrai champ TOC (Word peut la mettre à jour) */
    function toc(e) {
      const lines = Array.from(e.querySelectorAll('.toc-line'));
      let x = `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${xmlEsc((e.querySelector('.toc-title') || {}).textContent || 'Table des matières')}</w:t></w:r></w:p>`;
      const begin = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
      const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
      if (!lines.length) return x + `<w:p>${begin}<w:r><w:t>Aucune entrée de table des matières.</w:t></w:r>${end}</w:p>`;
      lines.forEach((l, i) => {
        const lvl = l.classList.contains('toc-l3') ? 3 : l.classList.contains('toc-l2') ? 2 : 1;
        const txt = (l.querySelector('.txt') || l).textContent;
        const pg = (l.querySelector('.pg') || {}).textContent || '';
        x += `<w:p><w:pPr><w:pStyle w:val="TOC${lvl}"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${twip(page.w - page.ml - page.mr) - 10}"/></w:tabs></w:pPr>${i === 0 ? begin : ''}<w:r><w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${xmlEsc(pg)}</w:t></w:r>${i === lines.length - 1 ? end : ''}</w:p>`;
      });
      return x;
    }

    /* ---------- Parties ---------- */
    const mainPart = makePart('word/document.xml');
    let bodyXml = blocks(editor, mainPart);
    const hdrPart = makePart('word/plume-header.xml'), ftrPart = makePart('word/plume-footer.xml');
    const hasHF = elx => elx && (elx.textContent.trim() || elx.querySelector('img,.pl-field'));
    const headerXml = hasHF(headerEl) ? blocks(headerEl, hdrPart) || '<w:p/>' : null;
    const footerXml = hasHF(footerEl) ? blocks(footerEl, ftrPart) || '<w:p/>' : null;

    // Section
    const landscape = page.w > page.h;
    let sect = '<w:sectPr>';
    if (headerXml) sect += `<w:headerReference w:type="default" r:id="${mainPart.addRel(REL + '/header', 'plume-header.xml')}"/>`;
    if (footerXml) sect += `<w:footerReference w:type="default" r:id="${mainPart.addRel(REL + '/footer', 'plume-footer.xml')}"/>`;
    sect += `<w:pgSz w:w="${twip(page.w)}" w:h="${twip(page.h)}"${landscape ? ' w:orient="landscape"' : ''}/>`;
    sect += `<w:pgMar w:top="${twip(page.mt)}" w:right="${twip(page.mr)}" w:bottom="${twip(page.mb)}" w:left="${twip(page.ml)}" w:header="${twip(page.mh)}" w:footer="${twip(page.mf)}" w:gutter="0"/>`;
    // références d'en-têtes supplémentaires (première page, paires) recopiées
    let extraRefs = '';
    for (const x of (page.hfExtra || [])) {
      if (!src || !src.file(x.part)) continue;
      await copyPart(x.part);
      extraRefs += `<${x.tag} w:type="${x.type}" r:id="${mainPart.addRel(REL + (x.tag === 'w:headerReference' ? '/header' : '/footer'), relTarget('word/document.xml', x.part))}"/>`;
    }
    const ORDER_BEFORE = ['w:footnotePr', 'w:endnotePr', 'w:type'];
    const extras = page.sectExtra || [];
    const nameOf = x => (x.match(/^<([\w:]+)/) || [])[1];
    const strip = x => x.replace(/\sxmlns(:\w+)?="[^"]*"/g, '');
    const before = extras.filter(x => ORDER_BEFORE.includes(nameOf(x))).map(strip).join('');
    const after = extras.filter(x => !ORDER_BEFORE.includes(nameOf(x))).map(strip).join('');
    sect = sect.replace('<w:pgSz', extraRefs + before + '<w:pgSz');
    sect += (after || '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>') + '</w:sectPr>';
    if (!bodyXml) bodyXml = '<w:p/>';

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS} ${IGNORABLE}><w:body>${bodyXml}${sect}</w:body></w:document>`;

    /* ---------- styles.xml ---------- */
    const N = base.Normal;
    const pStyle = (id, b, extra = {}) => {
      const r = rPrXml({ ...b, strike: false, u: false, hl: null, vert: null }, { ...N, font: id === 'Normal' ? null : N.font, sz: id === 'Normal' ? null : N.sz, color: id === 'Normal' ? '#000000' : N.color, b: false, i: false, caps: false, smallCaps: false, spacing: 0 });
      const lineV = Math.round(240 * b.lineRatio / (N.lineRatio || 1.15) * (N.lineRatio || 1.15));
      const ppr = `<w:pPr>${extra.keepNext ? '<w:keepNext/><w:keepLines/>' : ''}<w:spacing w:before="${b.before}" w:after="${b.after}" w:line="${lineV}" w:lineRule="auto"/>${b.ml || b.mr ? `<w:ind w:left="${b.ml}" w:right="${b.mr}"/>` : ''}${b.jc !== 'left' ? `<w:jc w:val="${b.jc}"/>` : ''}${extra.outline != null ? `<w:outlineLvl w:val="${extra.outline}"/>` : ''}</w:pPr>`;
      return `<w:style w:type="paragraph"${id === 'Normal' ? ' w:default="1"' : ''} w:styleId="${id}"><w:name w:val="${STYLE_NAMES[id] || id}"/>${id !== 'Normal' ? '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' : ''}<w:qFormat/>${extra.ui != null ? `<w:uiPriority w:val="${extra.ui}"/>` : ''}${ppr}${r}</w:style>`;
    };
    const defFont = N.font;
    let stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${NS}>` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${xmlEsc(defFont)}" w:eastAsia="${xmlEsc(defFont)}" w:hAnsi="${xmlEsc(defFont)}" w:cs="${xmlEsc(defFont)}"/><w:sz w:val="${N.sz}"/><w:szCs w:val="${N.sz}"/><w:lang w:val="fr-BE" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="${N.after}" w:line="${Math.round(240 * N.lineRatio)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`;
    stylesXml += pStyle('Normal', N, { ui: 0 });
    for (let i = 1; i <= 6; i++) stylesXml += pStyle('Heading' + i, base['Heading' + i], { keepNext: true, outline: i - 1, ui: 9 });
    stylesXml += pStyle('Title', base.Title, { ui: 10 }) + pStyle('Subtitle', base.Subtitle, { ui: 11 }) + pStyle('Quote', base.Quote, { ui: 29 }) + pStyle('PlumeCode', base.PlumeCode, {});
    stylesXml += `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="34"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>`;
    stylesXml += `<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:qFormat/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>`;
    for (let i = 1; i <= 3; i++) stylesXml += `<w:style w:type="paragraph" w:styleId="TOC${i}"><w:name w:val="toc ${i}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="39"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="100"/><w:ind w:left="${(i - 1) * 220}"/></w:pPr></w:style>`;
    stylesXml += `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`;
    stylesXml += `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>`;
    stylesXml += `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`;
    stylesXml += `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>`;
    stylesXml += `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`;
    stylesXml += `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>`;
    stylesXml += `<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>`;
    stylesXml += `<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>`;
    stylesXml += '</w:styles>';
    // Document d'origine : on garde ses styles et on ajoute seulement ceux qui manquent
    if (srcStylesXml) {
      const add = Array.from(stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)).filter(m => !srcStyleIds.has(m[1])).map(m => m[0].replace(' w:default="1"', '')).join('');
      stylesXml = srcStylesXml.replace(/<\/w:styles>\s*$/, add + '</w:styles>');
    }

    /* ---------- numbering.xml ---------- */
    const FMT = { disc: ['bullet', '•'], circle: ['bullet', '◦'], square: ['bullet', '▪'], none: ['none', ''], decimal: ['decimal'], 'lower-alpha': ['lowerLetter'], 'upper-alpha': ['upperLetter'], 'lower-roman': ['lowerRoman'], 'upper-roman': ['upperRoman'], 'lower-latin': ['lowerLetter'], 'upper-latin': ['upperLetter'] };
    let numberingXml = null;
    const absBase = srcNumXml ? 1 + Math.max(-1, ...Array.from(srcNumXml.matchAll(/w:abstractNumId="(\d+)"/g), m => +m[1])) : 0;
    const numBase = srcNumXml ? Math.max(0, ...Array.from(srcNumXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g), m => +m[1])) : 0;
    const fixNum = x => x && x.replace(/w:val="NEW(\d+)"/g, (m, i) => `w:val="${numBase + 1 + +i}"`);
    let absXml = '', numXml = '';
    if (numbering.abstracts.length) {
      numberingXml = '';
      numbering.abstracts.forEach((fmts, a) => {
        numberingXml += `<w:abstractNum w:abstractNumId="${absBase + a}"><w:multiLevelType w:val="hybridMultilevel"/>`;
        for (let l = 0; l < 9; l++) {
          const f = fmts[l] || (fmts[0] && fmts[0].tag === 'OL' ? { tag: 'OL', type: ['decimal', 'lower-alpha', 'lower-roman'][l % 3] } : { tag: 'UL', type: ['disc', 'circle', 'square'][l % 3] });
          let [nf, txt] = FMT[f.type] || (f.tag === 'OL' ? ['decimal'] : ['bullet', '•']);
          if (/^["']/.test(f.type)) { nf = 'bullet'; txt = f.type.replace(/["']/g, '').trim() || '–'; }
          if (nf !== 'bullet' && nf !== 'none') txt = `%${l + 1}.`;
          numberingXml += `<w:lvl w:ilvl="${l}"><w:start w:val="${f.start || 1}"/><w:numFmt w:val="${nf}"/><w:lvlText w:val="${xmlEsc(txt)}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr>${nf === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:hint="default"/></w:rPr>' : ''}</w:lvl>`;
        }
        numberingXml += '</w:abstractNum>';
      });
      absXml = numberingXml;
      numbering.nums.forEach((a, i) => { numXml += `<w:num w:numId="${numBase + 1 + i}"><w:abstractNumId w:val="${absBase + a}"/></w:num>`; });
    }
    if (srcNumXml) {
      let x = srcNumXml;
      if (absXml) {
        const firstNum = x.search(/<w:num\b/);
        x = firstNum >= 0 ? x.slice(0, firstNum) + absXml + x.slice(firstNum) : x.replace(/<\/w:numbering>/, absXml + '</w:numbering>');
        x = /<w:numIdMacAtCleanup/.test(x) ? x.replace(/<w:numIdMacAtCleanup/, numXml + '<w:numIdMacAtCleanup') : x.replace(/<\/w:numbering>\s*$/, numXml + '</w:numbering>');
      }
      numberingXml = x;
    } else if (absXml) numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering ${NS}>${absXml}${numXml}</w:numbering>`;

    /* ---------- footnotes.xml ---------- */
    let footnotesXml = null;
    if (footnotes.length) {
      footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${NS}>` +
        '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>';
      footnotes.forEach((t, i) => {
        const paras = String(t).split('\n');
        footnotesXml += `<w:footnote w:id="${i + 1}">` + paras.map((p, k) => `<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>' : ''}<w:r><w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r></w:p>`).join('') + '</w:footnote>';
      });
      footnotesXml += '</w:footnotes>';
    }

    /* ---------- comments.xml ---------- */
    let commentsXml = null;
    const cids = Object.keys(commentData);
    if (cids.length) {
      commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments ${NS}>` + cids.map(id => {
        const c = commentData[id];
        const paras = String(c.text || '').split('\n');
        return `<w:comment w:id="${id}" w:author="${xmlEsc(c.author || 'Plume')}"${c.date ? ` w:date="${xmlEsc(c.date)}"` : ''} w:initials="${xmlEsc(c.initials || '')}">` +
          paras.map((t, k) => `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}<w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`).join('') + '</w:comment>';
      }).join('') + '</w:comments>';
    }

    const hasToc = !!editor.querySelector('.pl-toc');
    const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${NS}>${hasToc ? '<w:updateFields w:val="true"/>' : ''}<w:defaultTabStop w:val="708"/><w:hyphenationZone w:val="425"/><w:characterSpacingControl w:val="doNotCompress"/>${footnotesXml ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat><w:themeFontLang w:val="fr-BE"/></w:settings>`;

    /* ---------- Assemblage du paquet ---------- */
    const zip = new JSZip();
    const _file = zip.file.bind(zip);
    zip.file = (n, d) => _file(n, d, { createFolders: false });
    const relsXml = rels => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('') + '</Relationships>';

    const docRels = [...mainPart.rels,
      { id: 'rId1', type: REL + '/styles', target: 'styles.xml' },
      { id: 'rId2', type: REL + '/settings', target: 'settings.xml' }];
    if (numberingXml) docRels.push({ id: 'rId3', type: REL + '/numbering', target: 'numbering.xml' });
    if (footnotesXml) docRels.push({ id: 'rId4', type: REL + '/footnotes', target: 'footnotes.xml' });
    if (commentsXml) docRels.push({ id: 'rId5', type: REL + '/comments', target: 'comments.xml' });

    // Parties d'origine reprises telles quelles : réglages, thème, polices, objets des îlots
    let useSrcSettings = false;
    if (src) {
      const mr = await srcRels('word/document.xml');
      let k = 10;
      for (const r of Object.values(mr)) {
        const kind = r.type.split('/').pop();
        if (!['theme', 'fontTable', 'webSettings', 'settings'].includes(kind)) continue;
        const path = resolve('word/document.xml', r.target);
        if (kind === 'settings') { if (path !== 'word/settings.xml') continue; useSrcSettings = true; }
        await copyPart(path);
        if (kind !== 'settings') docRels.push({ id: 'rId' + (k++), type: r.type, target: relTarget('word/document.xml', path) });
      }
      for (const p of pendingCopies) await copyPart(p);
    }
    // réglages d'origine qui annoncent des notes : les parties correspondantes doivent exister
    const sep = tag => `<w:${tag} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${tag}><w:${tag} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${tag}>`;
    let endnotesXml = null;
    if (useSrcSettings) {
      const st = await srcRead('word/settings.xml') || '';
      if (/<w:footnotePr/.test(st) && !footnotesXml) {
        footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes ${NS}>${sep('footnote')}</w:footnotes>`;
        docRels.push({ id: 'rId4', type: REL + '/footnotes', target: 'footnotes.xml' });
      }
      if (/<w:endnotePr/.test(st)) {
        endnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:endnotes ${NS}>${sep('endnote')}</w:endnotes>`;
        docRels.push({ id: 'rId6', type: REL + '/endnotes', target: 'endnotes.xml' });
      }
    }
    const GENERATED = new Set(['word/endnotes.xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/comments.xml', '[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'docProps/app.xml']);
    if (!useSrcSettings) copied.delete('word/settings.xml');

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
      numberingXml ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : '',
      footnotesXml ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '',
      headerXml ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '',
      footerXml ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : '',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '%%NOTES%%',
      commentsXml ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : '',
      '</Types>'].join('');
    let ctFinal = ct.replace('%%NOTES%%', (footnotesXml && !ct.includes('/word/footnotes.xml') ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : '') + (endnotesXml ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>' : '')).replace('/word/header1.xml', '/word/plume-header.xml').replace('/word/footer1.xml', '/word/plume-footer.xml');
    if (srcCT) {
      const have = new Set(Array.from(ctFinal.matchAll(/Extension="([^"]+)"/g), m => m[1].toLowerCase()));
      let extra = '';
      for (const d of srcCT.getElementsByTagName('Default')) {
        const e = d.getAttribute('Extension');
        if (!have.has(e.toLowerCase())) { extra += `<Default Extension="${xmlEsc(e)}" ContentType="${xmlEsc(d.getAttribute('ContentType'))}"/>`; have.add(e.toLowerCase()); }
      }
      for (const o of srcCT.getElementsByTagName('Override')) {
        const pn = o.getAttribute('PartName').replace(/^\//, '');
        if (copied.has(pn) && !GENERATED.has(pn)) extra += `<Override PartName="/${xmlEsc(pn)}" ContentType="${xmlEsc(o.getAttribute('ContentType'))}"/>`;
      }
      ctFinal = ctFinal.replace('</Types>', extra + '</Types>');
    }

    zip.file('[Content_Types].xml', ctFinal);
    for (const pth of copied) if (!GENERATED.has(pth) && src.file(pth)) zip.file(pth, await src.file(pth).async('uint8array'));
    zip.file('_rels/.rels', relsXml([
      { id: 'rId1', type: REL + '/officeDocument', target: 'word/document.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
      { id: 'rId3', type: REL + '/extended-properties', target: 'docProps/app.xml' }]));
    zip.file('word/document.xml', fixNum(documentXml));
    zip.file('word/_rels/document.xml.rels', relsXml(docRels));
    zip.file('word/styles.xml', stylesXml);
    if (!useSrcSettings) zip.file('word/settings.xml', settingsXml);
    if (commentsXml) zip.file('word/comments.xml', commentsXml);
    if (endnotesXml) zip.file('word/endnotes.xml', endnotesXml);
    if (numberingXml) zip.file('word/numbering.xml', numberingXml);
    if (footnotesXml) zip.file('word/footnotes.xml', footnotesXml);
    if (headerXml) {
      zip.file('word/plume-header.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${NS} ${IGNORABLE}>${fixNum(headerXml)}</w:hdr>`);
      if (hdrPart.rels.length) zip.file('word/_rels/plume-header.xml.rels', relsXml(hdrPart.rels));
    }
    if (footerXml) {
      zip.file('word/plume-footer.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS} ${IGNORABLE}>${fixNum(footerXml)}</w:ftr>`);
      if (ftrPart.rels.length) zip.file('word/_rels/plume-footer.xml.rels', relsXml(ftrPart.rels));
    }
    for (const d of imgData.values()) zip.file('word/media/' + d.name, d.bytes);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(props.title || '')}</dc:title><dc:creator>${xmlEsc(props.author || '')}</dc:creator><cp:lastModifiedBy>${xmlEsc(props.author || '')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${props.created || now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
    zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Plume (Pixel's ASBL)</Application><DocSecurity>0</DocSecurity><Company>Pixel's ASBL</Company></Properties>`);

    // restauration de l'affichage
    if (zoomBox) zoomBox.style.zoom = prevZoom;
    if (darkPage) document.documentElement.classList.add('page-dark');
    delete editor.dataset.exporting;

    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }

  /** Convertit une image (webp, svg…) en PNG via un canvas */
  async function toPng(img) {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      return new Uint8Array(await b.arrayBuffer());
    } catch { return null; }
  }

  return { exportDocx };
})();
