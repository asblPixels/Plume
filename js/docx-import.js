/* =====================================================================
   Plume — import .docx (Office Open XML → HTML éditable)
   Écrit pour Plume : lit document.xml, styles, numérotation, thème,
   relations, images, en-têtes / pieds de page et notes de bas de page.
   ===================================================================== */
'use strict';

const DocxImport = (() => {

  const HIGHLIGHT = {
    yellow: '#FFFF00', green: '#00FF00', cyan: '#00FFFF', magenta: '#FF00FF', blue: '#0000FF', red: '#FF0000',
    darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
    darkYellow: '#808000', darkGray: '#808080', lightGray: '#C0C0C0', black: '#000000', white: '#FFFFFF'
  };

  /** Polices de remplacement libres (métriques compatibles quand elles existent) */
  const FALLBACK = {
    'calibri': 'Carlito, "Liberation Sans", Arial, sans-serif',
    'calibri light': 'Carlito, "Liberation Sans", Arial, sans-serif',
    'cambria': 'Caladea, "Liberation Serif", Georgia, serif',
    'arial': '"Liberation Sans", Arimo, Helvetica, sans-serif',
    'helvetica': '"Liberation Sans", Arimo, Arial, sans-serif',
    'times new roman': '"Liberation Serif", Tinos, Times, serif',
    'courier new': '"Liberation Mono", Cousine, monospace',
    'aptos': '"Aptos", "Segoe UI", Carlito, "Liberation Sans", sans-serif',
    'aptos display': '"Aptos", "Segoe UI", Carlito, sans-serif',
    'georgia': 'Gelasio, Georgia, serif',
    'verdana': '"DejaVu Sans", Verdana, sans-serif',
    'segoe ui': '"Segoe UI", "Open Sans", "Noto Sans", sans-serif',
    'consolas': '"DejaVu Sans Mono", "Liberation Mono", monospace',
    'playwrite fr moderne': 'cursive', 'playwrite fr trad': 'cursive', 'marelle': 'cursive', 'belle allure': 'cursive',
    'andika': '"Andika", sans-serif', 'opendyslexic': 'sans-serif', 'comic neue': '"Comic Sans MS", sans-serif',
    'atkinson hyperlegible': 'sans-serif', 'lexend': 'sans-serif'
  };
  function cssFont(name) {
    if (!name) return null;
    const fb = FALLBACK[name.toLowerCase()] ||
      (/(mono|courier|consol|code)/i.test(name) ? 'monospace' : /(times|serif|garamond|georgia|cambria|book)/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif');
    // guillemets simples : la valeur est placée dans un attribut style="…"
    return `'${name.replace(/["']/g, '')}', ${fb}`.replace(/"/g, "'");
  }

  /* ---------- Accès XML ---------- */
  const parseXml = s => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (n, name) => n ? Array.from(n.children).filter(c => !name || c.nodeName === name) : [];
  const kid = (n, name) => n ? Array.from(n.children).find(c => c.nodeName === name) || null : null;
  const val = (n, a = 'w:val') => n ? n.getAttribute(a) : null;
  const onOff = n => { if (!n) return undefined; const v = val(n); return !(v === '0' || v === 'false' || v === 'off'); };
  const num = v => (v == null || v === '' ? null : parseFloat(v));
  const tw2pt = v => (v == null ? null : Math.round(v / 20 * 10) / 10);

  /* ---------- Propriétés de texte (rPr) ---------- */
  function parseRPr(r, ctx) {
    const o = {};
    if (!r) return o;
    for (const c of r.children) {
      switch (c.nodeName) {
        case 'w:rStyle': o.rStyle = val(c); break;
        case 'w:b': o.b = onOff(c); break;
        case 'w:i': o.i = onOff(c); break;
        case 'w:strike': o.strike = onOff(c); break;
        case 'w:dstrike': o.strike = onOff(c); break;
        case 'w:caps': o.caps = onOff(c); break;
        case 'w:smallCaps': o.smallCaps = onOff(c); break;
        case 'w:vanish': o.vanish = onOff(c); break;
        case 'w:u': o.u = val(c) && val(c) !== 'none'; break;
        case 'w:sz': o.sz = num(val(c)) / 2; break;
        case 'w:color': {
          let v = val(c);
          const th = c.getAttribute('w:themeColor');
          if ((!v || v === 'auto') && th && ctx.theme.colors[th]) v = ctx.theme.colors[th];
          o.color = v === 'auto' ? 'auto' : (v ? '#' + v.toUpperCase() : undefined);
          break;
        }
        case 'w:highlight': if (val(c) && val(c) !== 'none') o.hl = HIGHLIGHT[val(c)] || null; else o.hl = null; break;
        case 'w:shd': { const f = c.getAttribute('w:fill'); if (f && f !== 'auto') o.shd = '#' + f.toUpperCase(); break; }
        case 'w:vertAlign': o.vert = val(c) === 'superscript' ? 'sup' : val(c) === 'subscript' ? 'sub' : null; break;
        case 'w:spacing': o.spacing = tw2pt(num(val(c))); break;
        case 'w:rFonts': {
          let f = c.getAttribute('w:ascii') || c.getAttribute('w:hAnsi');
          const th = c.getAttribute('w:asciiTheme') || c.getAttribute('w:hAnsiTheme');
          if (!f && th) f = th.startsWith('major') ? ctx.theme.major : ctx.theme.minor;
          if (f) o.font = f;
          break;
        }
      }
    }
    return o;
  }

  /* ---------- Propriétés de paragraphe (pPr) ---------- */
  function parsePPr(p, ctx) {
    const o = {};
    if (!p) return o;
    for (const c of p.children) {
      switch (c.nodeName) {
        case 'w:pStyle': o.pStyle = val(c); break;
        case 'w:jc': o.jc = val(c); break;
        case 'w:ind': {
          const l = c.getAttribute('w:left') ?? c.getAttribute('w:start');
          const r = c.getAttribute('w:right') ?? c.getAttribute('w:end');
          if (l != null) o.indL = tw2pt(num(l));
          if (r != null) o.indR = tw2pt(num(r));
          if (c.getAttribute('w:firstLine') != null) { o.first = tw2pt(num(c.getAttribute('w:firstLine'))); o.hang = 0; }
          if (c.getAttribute('w:hanging') != null) { o.hang = tw2pt(num(c.getAttribute('w:hanging'))); o.first = 0; }
          break;
        }
        case 'w:spacing': {
          if (c.getAttribute('w:before') != null) o.before = tw2pt(num(c.getAttribute('w:before')));
          if (c.getAttribute('w:after') != null) o.after = tw2pt(num(c.getAttribute('w:after')));
          if (c.getAttribute('w:beforeAutospacing') === '1') o.before = 14;
          if (c.getAttribute('w:afterAutospacing') === '1') o.after = 14;
          if (c.getAttribute('w:line') != null) {
            o.line = num(c.getAttribute('w:line'));
            o.lineRule = c.getAttribute('w:lineRule') || 'auto';
          }
          break;
        }
        case 'w:shd': { const f = c.getAttribute('w:fill'); if (f && f !== 'auto') o.shd = '#' + f.toUpperCase(); break; }
        case 'w:pageBreakBefore': o.pbb = onOff(c); break;
        case 'w:keepNext': o.keepNext = onOff(c); break;
        case 'w:keepLines': o.keepLines = onOff(c); break;
        case 'w:widowControl': o.widow = onOff(c); break;
        case 'w:numPr': {
          const id = kid(c, 'w:numId'), lv = kid(c, 'w:ilvl');
          if (id) o.numId = val(id);
          if (lv) o.ilvl = parseInt(val(lv), 10) || 0;
          break;
        }
        case 'w:pBdr': {
          for (const side of ['top', 'bottom', 'left', 'right']) {
            const b = kid(c, 'w:' + side);
            if (b && val(b) && val(b) !== 'none' && val(b) !== 'nil') {
              o['bdr_' + side] = {
                w: Math.max(0.5, (num(b.getAttribute('w:sz')) || 4) / 8),
                color: (b.getAttribute('w:color') && b.getAttribute('w:color') !== 'auto') ? '#' + b.getAttribute('w:color') : '#000000',
                space: num(b.getAttribute('w:space')) || 0
              };
            }
          }
          break;
        }
        case 'w:rPr': o.markRPr = c; break;
        case 'w:sectPr': o.sectPr = c; break;
      }
    }
    return o;
  }

  /* ---------- Styles ---------- */
  function loadStyles(xml, ctx) {
    const st = { byId: {}, defaults: { rPr: {}, pPr: {} }, normalId: 'Normal', tableBorders: {} };
    if (!xml) return st;
    const doc = parseXml(xml).documentElement;
    const dd = kid(doc, 'w:docDefaults');
    if (dd) {
      st.defaults.rPr = parseRPr(kid(kid(dd, 'w:rPrDefault'), 'w:rPr'), ctx);
      st.defaults.pPr = parsePPr(kid(kid(dd, 'w:pPrDefault'), 'w:pPr'), ctx);
    }
    for (const s of kids(doc, 'w:style')) {
      const id = s.getAttribute('w:styleId');
      const type = s.getAttribute('w:type');
      const o = {
        id, type,
        name: (val(kid(s, 'w:name')) || id || '').toLowerCase(),
        basedOn: val(kid(s, 'w:basedOn')),
        pPr: parsePPr(kid(s, 'w:pPr'), ctx),
        rPr: parseRPr(kid(s, 'w:rPr'), ctx)
      };
      if (type === 'table') {
        const tb = kid(kid(s, 'w:tblPr'), 'w:tblBorders');
        o.tblBorders = tb ? hasBorders(tb) : undefined;
      }
      st.byId[id] = o;
      if (type === 'paragraph' && s.getAttribute('w:default') === '1') st.normalId = id;
    }
    return st;
  }
  function hasBorders(tb) {
    return kids(tb).some(b => val(b) && val(b) !== 'none' && val(b) !== 'nil');
  }
  /** Fusionne la chaîne basedOn d'un style (du plus général au plus précis) */
  function chain(st, id, depth = 0) {
    const s = st.byId[id];
    if (!s || depth > 20) return { pPr: {}, rPr: {}, names: [] };
    if (s._chain) return s._chain;
    const base = s.basedOn ? chain(st, s.basedOn, depth + 1) : { pPr: {}, rPr: {}, names: [] };
    const pPr = Object.assign({}, base.pPr, s.pPr);
    delete pPr.pStyle;
    s._chain = { pPr, rPr: Object.assign({}, base.rPr, s.rPr), names: [s.name, ...base.names], tblBorders: s.tblBorders ?? base.tblBorders };
    return s._chain;
  }

  /* ---------- Thème ---------- */
  function loadTheme(xml) {
    const t = { colors: {}, minor: null, major: null };
    if (!xml) return t;
    const d = parseXml(xml);
    const minor = d.getElementsByTagName('a:minorFont')[0];
    const major = d.getElementsByTagName('a:majorFont')[0];
    t.minor = minor && val(minor.getElementsByTagName('a:latin')[0], 'typeface');
    t.major = major && val(major.getElementsByTagName('a:latin')[0], 'typeface');
    const cs = d.getElementsByTagName('a:clrScheme')[0];
    if (cs) for (const c of cs.children) {
      const name = c.nodeName.replace('a:', '');
      const srgb = c.getElementsByTagName('a:srgbClr')[0];
      const sys = c.getElementsByTagName('a:sysClr')[0];
      const v = srgb ? val(srgb, 'val') : sys ? val(sys, 'lastClr') : null;
      if (v) t.colors[name] = v;
    }
    const map = { text1: 'dk1', background1: 'lt1', text2: 'dk2', background2: 'lt2', dark1: 'dk1', light1: 'lt1', dark2: 'dk2', light2: 'lt2', hyperlink: 'hlink', followedHyperlink: 'folHlink' };
    for (const [k, v] of Object.entries(map)) if (t.colors[v]) t.colors[k] = t.colors[v];
    return t;
  }

  /* ---------- Numérotation ---------- */
  function loadNumbering(xml) {
    const n = { abs: {}, nums: {} };
    if (!xml) return n;
    const d = parseXml(xml).documentElement;
    for (const a of kids(d, 'w:abstractNum')) {
      const lv = {};
      for (const l of kids(a, 'w:lvl')) {
        lv[l.getAttribute('w:ilvl')] = {
          fmt: val(kid(l, 'w:numFmt')) || 'decimal',
          text: val(kid(l, 'w:lvlText')) || '',
          start: parseInt(val(kid(l, 'w:start')) || '1', 10)
        };
      }
      n.abs[a.getAttribute('w:abstractNumId')] = lv;
    }
    for (const m of kids(d, 'w:num')) {
      const id = m.getAttribute('w:numId');
      const absId = val(kid(m, 'w:abstractNumId'));
      const lv = JSON.parse(JSON.stringify(n.abs[absId] || {}));
      for (const ov of kids(m, 'w:lvlOverride')) {
        const so = kid(ov, 'w:startOverride');
        const il = ov.getAttribute('w:ilvl');
        if (so && lv[il]) lv[il].start = parseInt(val(so), 10);
      }
      n.nums[id] = lv;
    }
    return n;
  }
  function listStyleOf(lvl) {
    if (!lvl) return { tag: 'ul', type: 'disc' };
    switch (lvl.fmt) {
      case 'bullet': {
        const ch = lvl.text;
        const type = ch === 'o' ? 'circle' : (ch === '' || ch === '§' || ch === '▪' || ch === '■') ? 'square' : (ch === '–' || ch === '-') ? '"– "' : 'disc';
        return { tag: 'ul', type };
      }
      case 'lowerLetter': return { tag: 'ol', type: 'lower-alpha' };
      case 'upperLetter': return { tag: 'ol', type: 'upper-alpha' };
      case 'lowerRoman': return { tag: 'ol', type: 'lower-roman' };
      case 'upperRoman': return { tag: 'ol', type: 'upper-roman' };
      case 'none': return { tag: 'ul', type: 'none' };
      default: return { tag: 'ol', type: 'decimal' };
    }
  }

  /* ---------- Relations ---------- */
  function loadRels(xml) {
    const r = {};
    if (!xml) return r;
    for (const e of parseXml(xml).getElementsByTagName('Relationship')) {
      r[e.getAttribute('Id')] = { target: e.getAttribute('Target'), type: e.getAttribute('Type'), mode: e.getAttribute('TargetMode') };
    }
    return r;
  }
  const relsPath = part => part.replace(/([^/]+)$/, '_rels/$1.rels');
  function resolveTarget(part, target) {
    if (target.startsWith('/')) return target.slice(1);
    const base = part.split('/').slice(0, -1);
    for (const seg of target.split('/')) {
      if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg);
    }
    return base.join('/');
  }

  /** XML brut encodé en base64 (UTF-8) pour les îlots conservés tels quels */
  const b64 = str => btoa(unescape(encodeURIComponent(str)));
  const rawXml = node => b64(new XMLSerializer().serializeToString(node));
  const isSimplePicture = d => {
    const inl = d.getElementsByTagName('wp:inline')[0];
    if (!inl || d.getElementsByTagName('w:txbxContent')[0]) return false;
    const gd = d.getElementsByTagName('a:graphicData')[0];
    return !!(gd && /picture$/.test(gd.getAttribute('uri') || '') && d.getElementsByTagName('a:blip')[0]);
  };

  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

  /* =====================================================================
     Conversion principale
     ===================================================================== */
  async function importDocx(buffer, opts = {}) {
    const zip = await JSZip.loadAsync(buffer);
    const read = async p => { const f = zip.file(p); return f ? f.async('string') : null; };

    // Trouver le document principal via _rels/.rels
    const rootRels = loadRels(await read('_rels/.rels'));
    let mainPart = 'word/document.xml';
    for (const r of Object.values(rootRels)) if (/officeDocument$/.test(r.type)) mainPart = r.target.replace(/^\//, '');
    const docXml = await read(mainPart);
    if (!docXml) throw new Error('Ce fichier ne contient pas de document Word (document.xml manquant).');

    const mainRels = loadRels(await read(relsPath(mainPart)));
    const findRel = suffix => Object.values(mainRels).find(r => r.type.endsWith('/' + suffix));
    const partOf = suffix => { const r = findRel(suffix); return r ? resolveTarget(mainPart, r.target) : null; };

    const ctx = { theme: { colors: {}, minor: null, major: null } };
    const themePart = partOf('theme');
    ctx.theme = loadTheme(themePart ? await read(themePart) : null);
    const stylesPart = partOf('styles');
    const st = loadStyles(stylesPart ? await read(stylesPart) : null, ctx);
    const numPart = partOf('numbering');
    const numbering = loadNumbering(numPart ? await read(numPart) : null);

    // Notes de bas de page / de fin (texte simple)
    const notes = { footnote: {}, endnote: {} };
    for (const kind of ['footnotes', 'endnotes']) {
      const p = partOf(kind);
      if (!p) continue;
      const x = await read(p);
      if (!x) continue;
      const tag = kind === 'footnotes' ? 'w:footnote' : 'w:endnote';
      for (const fn of parseXml(x).getElementsByTagName(tag)) {
        const id = fn.getAttribute('w:id');
        const paras = Array.from(fn.getElementsByTagName('w:p')).map(p =>
          Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join('')).filter(Boolean);
        notes[kind.slice(0, -1)][id] = paras.join('\n').trim();
      }
    }

    // Commentaires
    const comments = {};
    const cPart = partOf('comments');
    if (cPart) {
      const x = await read(cPart);
      if (x) for (const c of parseXml(x).getElementsByTagName('w:comment')) {
        const paras = Array.from(c.getElementsByTagName('w:p')).map(p => Array.from(p.getElementsByTagName('w:t')).map(t => t.textContent).join(''));
        comments[c.getAttribute('w:id')] = { author: c.getAttribute('w:author') || '', date: c.getAttribute('w:date') || '', initials: c.getAttribute('w:initials') || '', text: paras.join('\n').trim() };
      }
    }

    // Réglages du document (style Normal)
    const normal = chain(st, st.normalId);
    const baseR = Object.assign({}, st.defaults.rPr, normal.rPr);
    const baseP = Object.assign({}, st.defaults.pPr, normal.pPr);
    const settings = {
      font: baseR.font || 'Calibri',
      size: baseR.sz || 11,
      color: baseR.color && baseR.color !== 'auto' ? baseR.color : '#000000',
      lineHeight: lineCss(baseP) || 1,
      after: baseP.after ?? 0,
      before: baseP.before ?? 0
    };

    const images = [];
    const imgCache = {};
    async function imageUrl(part, rid) {
      const rels = await relsFor(part);
      const r = rels[rid];
      if (!r || r.mode === 'External') return null;
      const path = resolveTarget(part, r.target);
      if (imgCache[path] !== undefined) return imgCache[path];
      const f = zip.file(path);
      if (!f) return (imgCache[path] = null);
      const ext = path.split('.').pop().toLowerCase();
      if (!MIME[ext]) return (imgCache[path] = null); // EMF/WMF : non affichables dans un navigateur
      const blob = new Blob([await f.async('uint8array')], { type: MIME[ext] });
      const url = opts.registerImage ? opts.registerImage(blob) : URL.createObjectURL(blob);
      images.push(url);
      return (imgCache[path] = url);
    }
    const relsCache = {};
    async function relsFor(part) {
      if (!relsCache[part]) relsCache[part] = loadRels(await read(relsPath(part)));
      return relsCache[part];
    }

    let convertInline = null;
    /* ---------- Conversion d'une "story" (corps, en-tête, pied) ---------- */
    async function convertStory(part, rootEl) {
      const rels = await relsFor(part);
      const out = document.createElement('div');
      const listStack = [];        // [{el, numId, ilvl}]
      const counters = {};         // numId:ilvl -> nombre d'éléments déjà vus
      const fields = [];           // pile des champs complexes
      let pending = [];            // blocs à insérer après le paragraphe courant (zones de texte)

      const closeLists = () => { listStack.length = 0; };
      const breakEl = t => { const h = document.createElement('hr'); h.className = t === 'column' ? 'pl-colbreak' : 'pl-pagebreak'; h.contentEditable = 'false'; return h; };

      convertInline = async (container, target) => { const saved = listStack.splice(0); await blocks(container, target); listStack.length = 0; listStack.push(...saved); };
      async function blocks(container, target) {
        for (const n of container.children) {
          switch (n.nodeName) {
            case 'w:p': await para(n, target); break;
            case 'w:tbl': closeLists(); target.append(await table(n)); break;
            case 'w:sdt': await blocks(kid(n, 'w:sdtContent') || n, target); break;
            case 'w:customXml': case 'w:ins': case 'w:moveTo': await blocks(n, target); break;
            case 'mc:AlternateContent': { const c = kid(n, 'mc:Choice') || kid(n, 'mc:Fallback'); if (c) await blocks(c, target); break; }
          }
        }
      }

      /** Paragraphe → bloc HTML (ou élément de liste) */
      async function para(p, target) {
        const pPrEl = kid(p, 'w:pPr');
        const direct = parsePPr(pPrEl, ctx);
        const styleId = direct.pStyle || st.normalId;
        const ch = chain(st, styleId);
        const eff = Object.assign({}, st.defaults.pPr, ch.pPr, direct);
        const styleR = Object.assign({}, st.defaults.rPr, ch.rPr);
        const names = ch.names;

        // Type de bloc
        let tag = 'p', cls = '';
        const hn = names.map(n => n.match(/^heading (\d)$/)).find(Boolean);
        if (hn && +hn[1] <= 6) tag = 'h' + hn[1];
        else if (names.includes('title')) { tag = 'h1'; cls = 'title'; }
        else if (names.includes('subtitle')) cls = 'subtitle';
        else if (names.includes('quote') || names.includes('intense quote')) tag = 'blockquote';

        // Contenu en ligne (découpé aux sauts de page)
        const segs = await inline(p, styleR, part);

        const isList = eff.numId && eff.numId !== '0' && numbering.nums[eff.numId] && tag === 'p';
        const css = blockCss(eff, styleR, tag, cls, !!isList);

        // enchaînements : saut de page avant, paragraphes / lignes solidaires, veuves et orphelines
        const isHeading = /^h\d$/.test(tag);
        const flow = b => {
          if (eff.keepNext && !isHeading) b.dataset.keepnext = '1';
          else if (isHeading && eff.keepNext === false) b.dataset.keepnext = '0';
          if (eff.keepLines) b.dataset.keeplines = '1';
          if (eff.widow === false) b.dataset.widow = '0';
        };
        let firstBlock = true;
        segs.forEach((html, i) => {
          if (i > 0) { closeLists(); target.append(breakEl(segs.breaks[i - 1])); }
          const empty = !html.replace(/<span class="pl-anchor"[^>]*><\/span>/g, '').trim();
          if (segs.length > 1 && empty) return; // paragraphe ne contenant que le saut de page
          if (isList && i === 0) {
            const li = listItem(eff);
            li.innerHTML = html || '<br>';
            if (css) li.setAttribute('style', css);
            if (direct.pStyle && direct.pStyle !== st.normalId) li.dataset.pstyle = direct.pStyle;
            flow(li);
            if (eff.pbb && firstBlock) li.dataset.pbb = '1';
            firstBlock = false;
          } else {
            if (!isList) closeLists();
            const b = document.createElement(tag);
            if (cls) b.className = cls;
            if (css) b.setAttribute('style', css);
            if (styleId !== st.normalId) b.dataset.pstyle = styleId;
            b.innerHTML = html || '<br>';
            flow(b);
            if (eff.pbb && firstBlock) b.dataset.pbb = '1';
            firstBlock = false;
            target.append(b);
          }
        });
        if (!isList && segs.length === 0) { closeLists(); }

        if (pending.length) { closeLists(); for (const b of pending) target.append(b); pending = []; }

        // Fin de section portée par le paragraphe : marqueur avec les propriétés de la section
        if (direct.sectPr && part === mainPart) {
          closeLists();
          const hr = document.createElement('hr');
          hr.className = 'pl-section'; hr.contentEditable = 'false';
          hr.dataset.sect = JSON.stringify(parseSect(direct.sectPr));
          target.append(hr);
        }

        function listItem(eff) {
          const ilvl = Math.min(eff.ilvl || 0, 8);
          const lvl = numbering.nums[eff.numId][ilvl] || numbering.nums[eff.numId][0];
          const ls = listStyleOf(lvl);
          while (listStack.length > ilvl + 1) listStack.pop();
          if (listStack.length === ilvl + 1) {
            const top = listStack[ilvl];
            if (top.numId !== eff.numId || top.el.tagName.toLowerCase() !== ls.tag) listStack.pop();
          }
          while (listStack.length < ilvl + 1) {
            const lv = listStack.length;
            const lvl2 = numbering.nums[eff.numId][lv] || lvl;
            const ls2 = listStyleOf(lvl2);
            const L = document.createElement(ls2.tag);
            L.dataset.numid = eff.numId;
            if (!['disc', 'decimal'].includes(ls2.type)) L.style.listStyleType = ls2.type;
            if (ls2.tag === 'ol') {
              const key = eff.numId + ':' + lv;
              const start = (lvl2 && lvl2.start) || 1;
              const seen = counters[key] || 0;
              const s = seen ? start + seen : start;
              if (s !== 1) L.setAttribute('start', s);
            }
            if (listStack.length === 0) target.append(L);
            else {
              const parent = listStack[listStack.length - 1].el;
              let li = parent.lastElementChild;
              if (!li) { li = document.createElement('li'); li.style.listStyleType = 'none'; parent.append(li); }
              li.append(L);
            }
            listStack.push({ el: L, numId: eff.numId });
          }
          // remise à zéro des niveaux inférieurs
          for (let k = ilvl + 1; k < 9; k++) delete counters[eff.numId + ':' + k];
          const key = eff.numId + ':' + ilvl;
          counters[key] = (counters[key] || 0) + 1;
          const li = document.createElement('li');
          listStack[ilvl].el.append(li);
          return li;
        }
      }

      /** Contenu en ligne d'un paragraphe : renvoie des segments HTML séparés par les sauts de page */
      async function inline(p, styleR, part) {
        const segs = [''];
        segs.breaks = [];
        let link = null;          // {href}
        let buf = null;           // texte en attente {open, close, text}
        let rev = null;           // révision en cours {type, author, date}

        const revWrap = h => rev ? `<span class="pl-${rev.type}" data-author="${xmlEsc(rev.author)}" data-date="${xmlEsc(rev.date)}"${rev.type === 'del' ? ' contenteditable="false"' : ''}>${h}</span>` : h;
        const flush = () => {
          if (!buf) return;
          let h = buf.open + buf.text + buf.close;
          if (buf.link) h = `<a href="${xmlEsc(buf.link)}">${h}</a>`;
          h = revWrap(h);
          segs[segs.length - 1] += h;
          buf = null;
        };
        const pushText = (html, rp, raw = false) => {
          const w = runWrap(rp, styleR);
          const lk = currentLink();
          if (buf && buf.open === w.open && buf.link === lk && buf.rev === rev && !raw) { buf.text += html; return; }
          flush();
          buf = { open: w.open, close: w.close, text: html, link: lk, rev };
          if (raw) flush();
        };
        const pushRaw = html => { flush(); segs[segs.length - 1] += html; };
        const island = (node, kind, preview, block) => {
          flush();
          const tag = block ? 'div' : 'span';
          const fl = preview.match(/float:(left|right);margin:([^;"]+);/);
          const outer = fl ? ` style="float:${fl[1]};margin:${fl[2]}"` : '';
          if (fl) preview = preview.replace(fl[0], '');
          segs[segs.length - 1] += `<${tag} class="pl-island" contenteditable="false" data-kind="${kind}" data-part="${xmlEsc(part)}" data-x="${rawXml(node)}"${outer}>${preview}</${tag}>`;
        };
        const currentLink = () => {
          if (link) return link;
          for (let k = fields.length - 1; k >= 0; k--) if (fields[k].phase === 'result' && fields[k].href) return fields[k].href;
          return null;
        };
        const inInstr = () => fields.some(f => f.phase === 'instr');
        const skipping = () => fields.some(f => f.skip && f.phase === 'result');

        async function walk(node) {
          for (const n of node.children) {
            switch (n.nodeName) {
              case 'w:r': await run(n); break;
              case 'w:hyperlink': {
                const rid = n.getAttribute('r:id');
                const anchor = n.getAttribute('w:anchor');
                const prev = link;
                if (rid && rels[rid]) link = rels[rid].target;
                else if (anchor) link = '#' + anchor;
                await walk(n);
                flush();
                link = prev;
                break;
              }
              case 'w:fldSimple': {
                const instr = (n.getAttribute('w:instr') || '').trim();
                const f = fieldSpan(instr);
                if (f) pushRaw(f);
                else if (/^HYPERLINK/.test(instr)) {
                  const prev = link; link = hyperlinkFromInstr(instr); await walk(n); flush(); link = prev;
                } else await walk(n);
                break;
              }
              case 'w:ins': case 'w:moveTo': case 'w:del': case 'w:moveFrom': {
                const prev = rev;
                flush();
                rev = { type: /ins|moveTo/.test(n.nodeName) ? 'ins' : 'del', author: n.getAttribute('w:author') || '', date: n.getAttribute('w:date') || '' };
                await walk(n); flush();
                rev = prev;
                break;
              }
              case 'w:commentRangeStart': pushRaw(`<span class="pl-cstart" data-cid="${xmlEsc(n.getAttribute('w:id'))}"></span>`); break;
              case 'w:commentRangeEnd': pushRaw(`<span class="pl-cend" data-cid="${xmlEsc(n.getAttribute('w:id'))}"></span>`); break;
              case 'w:smartTag': case 'w:customXml': case 'w:sdtContent': case 'w:dir': case 'w:bdo':
                await walk(n); break;
              case 'w:sdt': await walk(kid(n, 'w:sdtContent') || n); break;
              case 'w:bookmarkStart': {
                const nm = n.getAttribute('w:name');
                if (nm && !nm.startsWith('_GoBack')) pushRaw(`<span class="pl-anchor" id="${xmlEsc(nm)}"></span>`);
                break;
              }
              case 'm:oMath': case 'm:oMathPara': {
                island(n, 'math', `<span class="pl-math">${mathHtml(n) || 'équation'}</span>`);
                break;
              }
              case 'mc:AlternateContent': { const c = kid(n, 'mc:Choice') || kid(n, 'mc:Fallback'); if (c) await walk(c); break; }
            }
          }
        }

        async function run(r) {
          const direct = parseRPr(kid(r, 'w:rPr'), ctx);
          const charStyle = direct.rStyle ? chain(st, direct.rStyle).rPr : {};
          const rp = Object.assign({}, styleR, charStyle, direct);
          if (rp.vanish) return;
          // Objets Office non éditables dans Plume : conservés tels quels (îlot)
          const complex = Array.from(r.children).find(c => (c.nodeName === 'w:drawing' && !isSimplePicture(c)) || c.nodeName === 'mc:AlternateContent' || c.nodeName === 'w:pict' || c.nodeName === 'w:object');
          if (complex && !inInstr() && !skipping()) {
            const pv = await previewOf(complex, part);
            island(r, pv.kind, pv.html, false);
            return;
          }
          for (const c of r.children) {
            const nm = c.nodeName;
            if (nm === 'w:fldChar') {
              const t = c.getAttribute('w:fldCharType');
              if (t === 'begin') fields.push({ phase: 'instr', instr: '' });
              else if (t === 'separate') {
                const f = fields[fields.length - 1];
                if (f) {
                  f.phase = 'result';
                  const instr = f.instr.trim();
                  const fs = fieldSpan(instr);
                  if (fs) { flush(); pushRaw(fs); f.skip = true; }
                  else if (/^HYPERLINK/.test(instr)) { flush(); f.href = hyperlinkFromInstr(instr); }
                }
              } else if (t === 'end') {
                const f = fields.pop();
                if (f && f.phase === 'instr') { // champ sans résultat
                  const fs = fieldSpan(f.instr.trim());
                  if (fs) pushRaw(fs);
                }
                flush();
              }
              continue;
            }
            if (nm === 'w:instrText') { const f = fields[fields.length - 1]; if (f && f.phase === 'instr') f.instr += c.textContent; continue; }
            if (inInstr() || skipping()) continue;
            switch (nm) {
              case 'w:t': case 'w:delText': if (c.textContent) pushText(xmlEsc(c.textContent), rp); break;
              case 'w:commentReference': {
                const id = c.getAttribute('w:id'); const cm = comments[id] || {};
                pushRaw(`<span class="pl-cref" contenteditable="false" data-cid="${xmlEsc(id)}" data-author="${xmlEsc(cm.author || '')}" data-initials="${xmlEsc(cm.initials || '')}" data-date="${xmlEsc(cm.date || '')}" data-text="${xmlEsc(cm.text || '')}"></span>`);
                break;
              }
              case 'w:tab': pushText('<span class="pl-tab">\t</span>', rp); break;
              case 'w:noBreakHyphen': pushText('‑', rp); break;
              case 'w:softHyphen': pushText('­', rp); break;
              case 'w:sym': {
                const code = parseInt(c.getAttribute('w:char') || '0', 16);
                pushText(xmlEsc(String.fromCharCode(code >= 0xF000 ? code - 0xF000 : code)), rp); break;
              }
              case 'w:br': case 'w:cr': {
                const t = c.getAttribute('w:type');
                if (t === 'page' || t === 'column') { flush(); segs.push(''); segs.breaks.push(t); }
                else pushRaw('<br>');
                break;
              }
              case 'w:footnoteReference': case 'w:endnoteReference': {
                const kind = nm === 'w:footnoteReference' ? 'footnote' : 'endnote';
                const txt = notes[kind][c.getAttribute('w:id')] || '';
                pushRaw(`<span class="pl-fn" contenteditable="false" data-note="${xmlEsc(txt)}">*</span>`);
                break;
              }
              case 'w:drawing': await drawing(c, rp); break;
              case 'w:pict': case 'w:object': await pict(c, rp); break;
              case 'mc:AlternateContent': {
                const ch = kid(c, 'mc:Choice') || kid(c, 'mc:Fallback');
                if (ch) for (const d of ch.children) {
                  if (d.nodeName === 'w:drawing') await drawing(d, rp);
                  else if (d.nodeName === 'w:pict') await pict(d, rp);
                }
                break;
              }
            }
          }
        }

        async function drawing(d, rp) {
          // Zone de texte ?
          const txbx = d.getElementsByTagName('w:txbxContent')[0];
          if (txbx) {
            const box = document.createElement('div');
            box.className = 'pl-textbox';
            const saved = listStack.splice(0);
            await blocks(txbx, box);
            listStack.push(...saved);
            pending.push(box);
            return;
          }
          const blip = d.getElementsByTagName('a:blip')[0];
          const ext = d.getElementsByTagName('wp:extent')[0];
          const docPr = d.getElementsByTagName('wp:docPr')[0];
          const alt = docPr ? (docPr.getAttribute('descr') || docPr.getAttribute('title') || '') : '';
          const w = ext ? Math.round(U.emuToPx(+ext.getAttribute('cx'))) : null;
          const h = ext ? Math.round(U.emuToPx(+ext.getAttribute('cy'))) : null;
          if (blip) {
            const url = await imageUrl(part, blip.getAttribute('r:embed') || blip.getAttribute('r:link'));
            if (url) {
              let style = w ? `width:${w}px;height:${h}px;` : '';
              const anchor = d.getElementsByTagName('wp:anchor')[0];
              if (anchor) {
                const al = anchor.getElementsByTagName('wp:align')[0];
                const hasWrap = anchor.getElementsByTagName('wp:wrapSquare')[0] || anchor.getElementsByTagName('wp:wrapTight')[0];
                if (al && hasWrap && /right|left/.test(al.textContent)) style += `float:${al.textContent.trim()};margin:4px 8px;`;
              }
              pushRaw(`<img src="${url}" alt="${xmlEsc(alt)}" style="${style}">`);
              return;
            }
          }
          const gd = d.getElementsByTagName('a:graphicData')[0];
          const uri = gd ? gd.getAttribute('uri') || '' : '';
          if (/chart/.test(uri)) pushRaw(`<span class="pl-field" title="Graphique Office : non affiché dans Plume">[Graphique]</span>`);
          else if (/diagram/.test(uri)) pushRaw(`<span class="pl-field" title="SmartArt : non affiché dans Plume">[SmartArt]</span>`);
          else if (blip) pushRaw(`<span class="pl-field" title="Format d'image non pris en charge (EMF/WMF)">[Image]</span>`);
        }
        async function pict(pc, rp) {
          const txbx = pc.getElementsByTagName('w:txbxContent')[0];
          if (txbx) {
            const box = document.createElement('div'); box.className = 'pl-textbox';
            const saved = listStack.splice(0);
            await blocks(txbx, box);
            listStack.push(...saved);
            pending.push(box); return;
          }
          const im = pc.getElementsByTagName('v:imagedata')[0];
          if (im) {
            const url = await imageUrl(part, im.getAttribute('r:id'));
            const shape = pc.getElementsByTagName('v:shape')[0];
            let style = '';
            const sm = shape && (shape.getAttribute('style') || '');
            const wm = sm && sm.match(/width:([\d.]+)pt/), hm = sm && sm.match(/height:([\d.]+)pt/);
            if (wm && hm) style = `width:${Math.round(U.ptToPx(+wm[1]))}px;height:${Math.round(U.ptToPx(+hm[1]))}px;`;
            if (url) pushRaw(`<img src="${url}" alt="" style="${style}">`);
          }
        }

        await walk(p);
        flush();
        return segs;
      }

      /** Tableau */
      async function table(t) {
        const tblPr = kid(t, 'w:tblPr');
        const tStyle = val(kid(tblPr, 'w:tblStyle'));
        const direct = kid(tblPr, 'w:tblBorders');
        let borders = direct ? hasBorders(direct) : undefined;
        if (borders === undefined && tStyle) borders = chain(st, tStyle).tblBorders;
        const T = document.createElement('table');
        T.dataset.borders = borders ? 'all' : 'none';
        const jc = val(kid(tblPr, 'w:jc'));
        const cols = kids(kid(t, 'w:tblGrid'), 'w:gridCol').map(g => Math.max(8, Math.round(U.twipToPx(+g.getAttribute('w:w') || 0))));
        if (cols.length) {
          const cg = document.createElement('colgroup');
          for (const w of cols) { const c = document.createElement('col'); c.style.width = w + 'px'; cg.append(c); }
          T.append(cg);
          T.style.width = cols.reduce((a, b) => a + b, 0) + 'px';
        }
        if (jc === 'center') { T.style.marginLeft = 'auto'; T.style.marginRight = 'auto'; }
        const tbody = document.createElement('tbody');
        T.append(tbody);
        const grid = []; // grid[row][col] = td
        let ri = 0;
        const rowsOf = node => kids(node).flatMap(c => c.nodeName === 'w:tr' ? [c] : (c.nodeName === 'w:sdt' ? rowsOf(kid(c, 'w:sdtContent') || c) : []));
        for (const tr of rowsOf(t)) {
          const TR = document.createElement('tr');
          const trPr = kid(tr, 'w:trPr');
          const hgt = kid(trPr, 'w:trHeight');
          if (hgt) TR.style.height = Math.round(U.twipToPx(+hgt.getAttribute('w:val'))) + 'px';
          if (kid(trPr, 'w:tblHeader')) TR.dataset.header = '1';
          grid[ri] = [];
          let ci = +(val(kid(kid(tr, 'w:trPr'), 'w:gridBefore')) || 0);
          const cellsOf = node => kids(node).flatMap(c => c.nodeName === 'w:tc' ? [c] : (c.nodeName === 'w:sdt' ? cellsOf(kid(c, 'w:sdtContent') || c) : []));
          for (const tc of cellsOf(tr)) {
            const tcPr = kid(tc, 'w:tcPr');
            const span = +(val(kid(tcPr, 'w:gridSpan')) || 1);
            const vm = kid(tcPr, 'w:vMerge');
            const vmv = vm ? (val(vm) || 'continue') : null;
            if (vmv === 'continue') {
              const above = grid[ri - 1] && grid[ri - 1][ci];
              if (above) {
                above.rowSpan = (above.rowSpan || 1) + 1;
                for (let k = 0; k < span; k++) grid[ri][ci + k] = above;
                ci += span; continue;
              }
            }
            const TD = document.createElement('td');
            if (span > 1) TD.colSpan = span;
            const shd = kid(tcPr, 'w:shd');
            const fill = shd && shd.getAttribute('w:fill');
            if (fill && fill !== 'auto') TD.style.backgroundColor = '#' + fill;
            const va = val(kid(tcPr, 'w:vAlign'));
            if (va === 'center') TD.style.verticalAlign = 'middle'; else if (va === 'bottom') TD.style.verticalAlign = 'bottom';
            const saved = listStack.splice(0);
            await blocks(tc, TD);
            listStack.length = 0; listStack.push(...saved);
            if (!TD.firstChild) TD.innerHTML = '<p><br></p>';
            TR.append(TD);
            for (let k = 0; k < span; k++) grid[ri][ci + k] = TD;
            ci += span;
          }
          tbody.append(TR);
          ri++;
        }
        return T;
      }

      await blocks(rootEl, out);
      return out.innerHTML;
    }

    /* ---------- Aperçus des objets conservés ---------- */
    async function previewOf(node, part) {
      const rels = await relsFor(part);
      const choice = node.nodeName === 'mc:AlternateContent' ? (kid(node, 'mc:Choice') || kid(node, 'mc:Fallback')) : node;
      const ext = choice.getElementsByTagName('wp:extent')[0];
      const w = ext ? Math.round(U.emuToPx(+ext.getAttribute('cx'))) : 200;
      const h = ext ? Math.round(U.emuToPx(+ext.getAttribute('cy'))) : 120;
      const anchor = choice.getElementsByTagName('wp:anchor')[0];
      let float = '';
      if (anchor) {
        const al = anchor.getElementsByTagName('wp:align')[0];
        const behind = anchor.getAttribute('behindDoc') === '1';
        // habillage : tout sauf « aucun » et « haut et bas » fait flotter l'objet
        const wrapped = !anchor.getElementsByTagName('wp:wrapNone')[0] && !anchor.getElementsByTagName('wp:wrapTopAndBottom')[0];
        const side = al && /right/.test(al.textContent) ? 'right' : (al && /left/.test(al.textContent) ? 'left' : null);
        if (wrapped && !behind) float = `float:${side || 'left'};margin:2px ${side === 'right' ? 0 : 10}px 6px ${side === 'right' ? 10 : 0}px;`;
      }
      const box = (inner, kind, label) => ({ kind, html: `<span class="pl-island-box" style="width:${w}px;height:${h}px;${float}" title="${xmlEsc(label)} — conservé tel quel à l'enregistrement">${inner}</span>` });
      const gd = choice.getElementsByTagName('a:graphicData')[0];
      const uri = gd ? gd.getAttribute('uri') || '' : '';
      // graphique
      if (/chart/.test(uri)) {
        const c = choice.getElementsByTagName('c:chart')[0];
        const rel = c && rels[c.getAttribute('r:id')];
        let svg = '';
        if (rel) { const x = await read(resolveTarget(part, rel.target)); if (x) svg = chartSvg(x, w, h); }
        return box(svg || '<span class="pl-island-label">Graphique</span>', 'chart', 'Graphique Office');
      }
      // SmartArt
      if (/diagram/.test(uri)) {
        const ri = choice.getElementsByTagName('dgm:relIds')[0];
        const rel = ri && rels[ri.getAttribute('r:dm')];
        let items = [];
        if (rel) { const x = await read(resolveTarget(part, rel.target)); if (x) items = Array.from(parseXml(x).getElementsByTagName('dgm:pt')).map(p => Array.from(p.getElementsByTagName('a:t')).map(t => t.textContent).join('')).filter(Boolean); }
        return box(`<span class="pl-smart">${items.slice(0, 12).map(t => `<span>${xmlEsc(t)}</span>`).join('')}</span>`, 'smartart', 'SmartArt');
      }
      // zone de texte / forme avec texte
      const tx = choice.getElementsByTagName('w:txbxContent')[0];
      if (tx) {
        const holder = document.createElement('div');
        const saved = []; // listes indépendantes
        await (async () => { const out = document.createElement('div'); await convertInline(tx, out); holder.append(...out.childNodes); })();
        return { kind: 'textbox', html: `<span class="pl-island-box pl-tb" style="width:${w}px;min-height:${Math.min(h, 400)}px;${float}" title="Zone de texte — conservée telle quelle">${holder.innerHTML}</span>` };
      }
      // image (flottante, EMF/WMF, VML, objet OLE)
      const blip = choice.getElementsByTagName('a:blip')[0];
      const vimg = choice.getElementsByTagName('v:imagedata')[0];
      const rid = blip ? (blip.getAttribute('r:embed') || blip.getAttribute('r:link')) : vimg ? vimg.getAttribute('r:id') : null;
      if (rid) {
        const url = await imageUrl(part, rid);
        let ww = w, hh = h;
        if (!ext) {
          const shape = choice.getElementsByTagName('v:shape')[0];
          const sm = shape && (shape.getAttribute('style') || '');
          const wm = sm && sm.match(/width:([\d.]+)pt/), hm = sm && sm.match(/height:([\d.]+)pt/);
          if (wm && hm) { ww = Math.round(U.ptToPx(+wm[1])); hh = Math.round(U.ptToPx(+hm[1])); }
        }
        const kind = node.nodeName === 'w:object' ? 'ole' : anchor ? 'float' : 'image';
        if (url) return { kind, html: `<img src="${url}" alt="" style="width:${ww}px;height:${hh}px;${float}" draggable="false">` };
        return { kind, html: `<span class="pl-island-box" style="width:${ww}px;height:${hh}px;${float}" title="Image EMF/WMF — conservée telle quelle"><span class="pl-island-label">Image (EMF/WMF)</span></span>` };
      }
      return box('<span class="pl-island-label">Forme</span>', 'shape', 'Forme Office');
    }
    /** Aperçu HTML simple d'une équation OMML (exposants, indices, fractions, racines) */
    function mathHtml(n) {
      const k = (x, name) => x && Array.from(x.children).find(c => c.nodeName === name);
      const all = x => x ? Array.from(x.children).map(mathHtml).join('') : '';
      switch (n.nodeName) {
        case 'm:t': return xmlEsc(n.textContent);
        case 'm:sSup': return all(k(n, 'm:e')) + '<sup>' + all(k(n, 'm:sup')) + '</sup>';
        case 'm:sSub': return all(k(n, 'm:e')) + '<sub>' + all(k(n, 'm:sub')) + '</sub>';
        case 'm:sSubSup': return all(k(n, 'm:e')) + '<sub>' + all(k(n, 'm:sub')) + '</sub><sup>' + all(k(n, 'm:sup')) + '</sup>';
        case 'm:f': return '<span style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;font-size:.9em"><span style="border-bottom:1px solid">' + all(k(n, 'm:num')) + '</span><span>' + all(k(n, 'm:den')) + '</span></span>';
        case 'm:rad': return '√<span style="border-top:1px solid">' + all(k(n, 'm:e')) + '</span>';
        case 'm:d': return '(' + Array.from(n.children).filter(c => c.nodeName === 'm:e').map(all).join(', ') + ')';
        case 'm:rPr': case 'm:ctrlPr': case 'w:rPr': case 'm:sSupPr': case 'm:sSubPr': case 'm:fPr': case 'm:radPr': case 'm:dPr': case 'm:deg': return '';
        default: return all(n);
      }
    }
    /** Mini rendu SVG d'un graphique Office (barres, lignes, secteurs) */
    function chartSvg(xml, w, h) {
      const d = parseXml(xml);
      const title = Array.from((d.getElementsByTagName('c:title')[0] || { getElementsByTagName: () => [] }).getElementsByTagName('a:t')).map(t => t.textContent).join('');
      const plot = d.getElementsByTagName('c:plotArea')[0];
      if (!plot) return '';
      const type = Array.from(plot.children).find(c => /Chart$/.test(c.nodeName));
      const series = Array.from(plot.getElementsByTagName('c:ser')).slice(0, 6).map(s => {
        const v = s.getElementsByTagName('c:val')[0] || s.getElementsByTagName('c:yVal')[0];
        const pts = v ? Array.from(v.getElementsByTagName('c:pt')).map(p => ({ i: +p.getAttribute('idx'), v: parseFloat((p.getElementsByTagName('c:v')[0] || {}).textContent) || 0 })) : [];
        const clr = s.getElementsByTagName('a:srgbClr')[0];
        return { pts, color: clr ? '#' + clr.getAttribute('val') : null };
      });
      const COLORS = ['#156082', '#E97132', '#196B24', '#0F9ED5', '#A02B93', '#4EA72E'];
      const n = Math.max(1, ...series.map(s => s.pts.length));
      const max = Math.max(1e-9, ...series.flatMap(s => s.pts.map(p => p.v)));
      const top = title ? 26 : 10, left = 24, bottom = h - 16, right = w - 10;
      let g = '';
      const kindName = type ? type.nodeName : '';
      if (/pie|doughnut/i.test(kindName) && series[0]) {
        const tot = series[0].pts.reduce((a, p) => a + Math.max(0, p.v), 0) || 1;
        const cx = w / 2, cy = (top + bottom) / 2, r = Math.max(10, Math.min(w, bottom - top) / 2 - 4);
        let a0 = -Math.PI / 2;
        series[0].pts.forEach((p, i) => {
          const a1 = a0 + Math.max(0, p.v) / tot * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          g += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${COLORS[i % 6]}"/>`;
          a0 = a1;
        });
      } else if (/line|scatter|area/i.test(kindName)) {
        series.forEach((s, k) => {
          const pts = s.pts.map(p => `${left + (n > 1 ? p.i / (n - 1) : .5) * (right - left)},${bottom - p.v / max * (bottom - top)}`).join(' ');
          g += `<polyline points="${pts}" fill="none" stroke="${s.color || COLORS[k % 6]}" stroke-width="2"/>`;
        });
      } else {
        const gw = (right - left) / n, bw = gw * .8 / Math.max(1, series.length);
        series.forEach((s, k) => s.pts.forEach(p => {
          const bh = Math.max(0, p.v) / max * (bottom - top);
          g += `<rect x="${left + p.i * gw + gw * .1 + k * bw}" y="${bottom - bh}" width="${Math.max(1, bw - 1)}" height="${bh}" fill="${s.color || COLORS[k % 6]}"/>`;
        }));
      }
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${title ? `<text x="${w / 2}" y="18" text-anchor="middle" font-size="13" fill="#404040">${xmlEsc(title)}</text>` : ''}<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#bbb"/>${g}</svg>`;
    }

    /* ---------- Styles CSS ---------- */
    function lineCss(p) {
      if (p.line == null) return null;
      if (p.lineRule === 'auto' || !p.lineRule) return Math.round(p.line / 240 * 100) / 100;
      return (Math.round(p.line / 20 * 10) / 10) + 'pt';
    }
    function blockCss(eff, styleR, tag, cls, isList) {
      const s = [];
      const full = tag !== 'p' || cls; // titres : on fixe tout pour reproduire l'aspect d'origine
      const jc = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right' }[eff.jc];
      if (jc) s.push('text-align:' + jc);
      if (!isList) {
        if (eff.indL) s.push(`margin-left:${eff.indL}pt`);
        if (eff.indR) s.push(`margin-right:${eff.indR}pt`);
      }
      if (eff.first) s.push(`text-indent:${eff.first}pt`);
      else if (eff.hang && !isList) s.push(`text-indent:-${eff.hang}pt`);
      const before = eff.before ?? 0, after = eff.after ?? 0;
      if (full || before !== (baseP.before ?? 0)) s.push(`margin-top:${before}pt`);
      if (full || after !== (baseP.after ?? 0)) s.push(`margin-bottom:${after}pt`);
      const lh = lineCss(eff);
      if (lh != null && (full || lh !== settings.lineHeight)) s.push(`line-height:${lh}`);
      if (eff.shd) s.push(`background-color:${eff.shd}`);
      for (const side of ['top', 'bottom', 'left', 'right']) {
        const b = eff['bdr_' + side];
        if (b) s.push(`border-${side}:${b.w}pt solid ${b.color}`, `padding-${side}:${b.space}pt`);
      }
      // propriétés de caractère du style de paragraphe
      const r = styleR;
      const diff = (k, def) => full || (r[k] ?? def) !== (baseR[k] ?? def);
      if (r.font && diff('font')) s.push(`font-family:${cssFont(r.font)}`);
      if (r.sz && diff('sz')) s.push(`font-size:${r.sz}pt`);
      if (diff('b', false)) s.push(`font-weight:${r.b ? 'bold' : 'normal'}`);
      if (diff('i', false)) s.push(`font-style:${r.i ? 'italic' : 'normal'}`);
      if (r.color && diff('color')) s.push(`color:${r.color === 'auto' ? '#000000' : r.color}`);
      else if (full && !r.color) s.push('color:#000000');
      if (r.caps && diff('caps', false)) s.push('text-transform:uppercase');
      if (r.smallCaps && diff('smallCaps', false)) s.push('font-variant:small-caps');
      if (r.spacing && diff('spacing')) s.push(`letter-spacing:${r.spacing}pt`);
      if ((r.u || r.strike) && (diff('u', false) || diff('strike', false))) s.push(`text-decoration:${[r.u && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ')}`);
      return s.join(';');
    }
    /** Enveloppe HTML d'un morceau de texte selon ses différences avec le style du paragraphe */
    function runWrap(rp, base) {
      const s = [];
      if (rp.font && rp.font !== base.font) s.push(`font-family:${cssFont(rp.font)}`);
      if (rp.sz && rp.sz !== base.sz) s.push(`font-size:${rp.sz}pt`);
      if (!!rp.b !== !!base.b) s.push(`font-weight:${rp.b ? 'bold' : 'normal'}`);
      if (!!rp.i !== !!base.i) s.push(`font-style:${rp.i ? 'italic' : 'normal'}`);
      const deco = [];
      if (rp.u && !base.u) deco.push('underline');
      if (rp.strike && !base.strike) deco.push('line-through');
      if (deco.length) s.push(`text-decoration:${deco.join(' ')}`);
      if (rp.color && rp.color !== base.color) s.push(`color:${rp.color === 'auto' ? '#000000' : rp.color}`);
      const bg = rp.hl || rp.shd;
      if (bg && bg !== (base.hl || base.shd)) s.push(`background-color:${bg}`);
      if (rp.caps && !base.caps) s.push('text-transform:uppercase');
      if (rp.smallCaps && !base.smallCaps) s.push('font-variant:small-caps');
      if (rp.spacing && rp.spacing !== base.spacing) s.push(`letter-spacing:${rp.spacing}pt`);
      let open = s.length ? `<span style="${s.join(';')}">` : '';
      let close = s.length ? '</span>' : '';
      if (rp.vert && rp.vert !== base.vert) { open += `<${rp.vert}>`; close = `</${rp.vert}>` + close; }
      return { open, close };
    }
    function fieldSpan(instr) {
      const m = instr.match(/^(PAGE|NUMPAGES|SECTIONPAGES)\b/i);
      if (!m) return null;
      const f = m[1].toUpperCase() === 'PAGE' ? 'page' : 'numpages';
      return `<span class="pl-field" contenteditable="false" data-field="${f}">${f === 'page' ? '1' : '1'}</span>`;
    }
    function hyperlinkFromInstr(instr) {
      const m = instr.match(/HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/);
      if (!m) return null;
      return /\\l/.test(instr) ? '#' + m[1] : m[1];
    }
    const pageBreak = () => { const h = document.createElement('hr'); h.className = 'pl-pagebreak'; h.contentEditable = 'false'; return h; };

    /* ---------- Sections ---------- */
    /** Propriétés d'une section Word (w:sectPr) → objet page de Plume (px) */
    function parseSect(sect) {
      const page = { w: 794, h: 1123, mt: 94.5, mr: 94.5, mb: 94.5, ml: 94.5, mh: 47, mf: 47 };
      if (!sect) return page;
      const sz = kid(sect, 'w:pgSz');
      if (sz) {
        page.w = U.twipToPx(+sz.getAttribute('w:w') || 11906); page.h = U.twipToPx(+sz.getAttribute('w:h') || 16838);
        // orientation déclarée sans dimensions cohérentes : on permute
        if (sz.getAttribute('w:orient') === 'landscape' && page.w < page.h) [page.w, page.h] = [page.h, page.w];
      }
      const mg = kid(sect, 'w:pgMar');
      if (mg) {
        const g = a => Math.abs(U.twipToPx(+(mg.getAttribute(a) || 0)));
        Object.assign(page, { mt: g('w:top'), mr: g('w:right'), mb: g('w:bottom'), ml: g('w:left'), mh: g('w:header'), mf: g('w:footer') });
      }
      const ty = val(kid(sect, 'w:type'));
      page.type = ['continuous', 'evenPage', 'oddPage', 'nextColumn'].includes(ty) ? (ty === 'nextColumn' ? 'nextPage' : ty) : 'nextPage';
      const cl = kid(sect, 'w:cols');
      if (cl) {
        const n = Math.max(1, parseInt(cl.getAttribute('w:num') || '1', 10) || 1);
        const sp = cl.getAttribute('w:space');
        const sepA = cl.getAttribute('w:sep');
        const list = kids(cl, 'w:col').map(c => ({ w: U.twipToPx(+(c.getAttribute('w:w') || 0)), space: U.twipToPx(+(c.getAttribute('w:space') || 0)) }));
        const eqA = cl.getAttribute('w:equalWidth');
        page.cols = { n, space: sp != null ? U.twipToPx(+sp) : U.cmToPx(1.25), sep: sepA === '1' || sepA === 'true' || sepA === 'on' };
        if (list.length >= n && n > 1 && (eqA === '0' || eqA === 'false' || eqA === 'off')) { page.cols.eq = false; page.cols.list = list; }
        else page.cols.eq = true;
      }
      // éléments de section conservés tels quels (bordures, titlePg, numérotation…)
      page.sectExtra = kids(sect).filter(c => !['w:pgSz', 'w:pgMar', 'w:headerReference', 'w:footerReference', 'w:type', 'w:cols'].includes(c.nodeName)).map(c => new XMLSerializer().serializeToString(c));
      page.hfExtra = [];
      for (const tag of ['w:headerReference', 'w:footerReference']) for (const ref of kids(sect, tag)) {
        const type = ref.getAttribute('w:type') || 'default';
        if (type === 'default') continue;
        const rel = mainRels[ref.getAttribute('r:id')];
        if (rel) page.hfExtra.push({ tag, type, part: resolveTarget(mainPart, rel.target) });
      }
      page.titlePg = !!kid(sect, 'w:titlePg') && val(kid(sect, 'w:titlePg')) !== '0';
      return page;
    }

    /* ---------- Corps, section, en-têtes ---------- */
    const docEl = parseXml(docXml).documentElement;
    const body = kid(docEl, 'w:body');
    const html = await convertStory(mainPart, body);

    const sect = kid(body, 'w:sectPr');
    const page = parseSect(sect);
    let headerHtml = '', footerHtml = '';
    if (sect) {
      page.first = { header: '', footer: '' };
      if (page.titlePg) for (const x of page.hfExtra.filter(h => h.type === 'first')) {
        const xml = await read(x.part);
        if (xml) page.first[x.tag === 'w:headerReference' ? 'header' : 'footer'] = await convertStory(x.part, parseXml(xml).documentElement);
      }
      const pick = tag => {
        const refs = kids(sect, tag);
        return refs.find(r => r.getAttribute('w:type') === 'default') || refs[0];
      };
      for (const [tag, set] of [['w:headerReference', v => headerHtml = v], ['w:footerReference', v => footerHtml = v]]) {
        const ref = pick(tag);
        if (!ref) continue;
        const rel = mainRels[ref.getAttribute('r:id')];
        if (!rel) continue;
        const p = resolveTarget(mainPart, rel.target);
        const x = await read(p);
        if (!x) continue;
        set(await convertStory(p, parseXml(x).documentElement));
      }
    }
    const isEmptyHF = h => !h || !h.replace(/<br>|<p[^>]*>|<\/p>|\s|&nbsp;/g, '');
    if (isEmptyHF(headerHtml)) headerHtml = '';
    if (isEmptyHF(footerHtml)) footerHtml = '';

    // Propriétés
    let title = '', author = '';
    const core = await read('docProps/core.xml');
    if (core) {
      const c = parseXml(core);
      title = (c.getElementsByTagName('dc:title')[0] || {}).textContent || '';
      author = (c.getElementsByTagName('dc:creator')[0] || {}).textContent || '';
    }

    return {
      html: html || '<p><br></p>', header: headerHtml, footer: footerHtml,
      page, settings: { ...settings, fontCss: cssFont(settings.font) }, props: { title, author },
      source: zip
    };
  }

  return { importDocx, cssFont };
})();
