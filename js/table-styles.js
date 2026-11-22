/* =====================================================================
   Plume — styles de tableau (équivalent des styles de tableau Word)
   - définition d'un style : bordures du tableau, mise en forme de tout
     le tableau et zones conditionnelles (ligne d'en-tête, ligne des
     totaux, première / dernière colonne, bandes, coins)
   - calcul de la mise en forme de chaque cellule selon les options
     (w:tblLook) avec l'ordre de priorité de Word :
     tableau entier < bandes < première/dernière colonne
     < ligne d'en-tête/des totaux < coins < mise en forme directe
   - la mise en forme déduite est posée en variables CSS (--ts-*) :
     elle n'est jamais « figée » dans le document, l'export .docx
     réécrit seulement w:tblStyle et w:tblLook
   - galerie de styles originaux de Plume + écriture des w:style
   ===================================================================== */
'use strict';

const TableStyles = (() => {

  /** Zones conditionnelles, de la moins prioritaire à la plus prioritaire */
  const CONDS = ['wholeTable', 'band1Vert', 'band2Vert', 'band1Horz', 'band2Horz', 'firstCol', 'lastCol', 'firstRow', 'lastRow', 'nwCell', 'neCell', 'swCell', 'seCell'];
  const SIDES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'];
  const LOOK_KEYS = ['firstRow', 'lastRow', 'firstColumn', 'lastColumn', 'hBand', 'vBand'];
  /** Valeur par défaut de Word pour un nouveau tableau (w:tblLook w:val="04A0") */
  const DEFAULT_LOOK = 'firstRow firstColumn hBand';
  const VARS = ['bg', 'color', 'fw', 'fst', 'ff', 'fz', 'tt', 'ta', 'va', 'pa', 'pb', 'lh', 'bt', 'bb', 'bl', 'br'];

  /* ---------- Options (w:tblLook) ---------- */
  function parseLook(str) {
    const s = new Set(String(str == null ? DEFAULT_LOOK : str).split(/\s+/).filter(Boolean));
    const o = {};
    for (const k of LOOK_KEYS) o[k] = s.has(k);
    return o;
  }
  const lookString = o => LOOK_KEYS.filter(k => o[k]).join(' ');
  /** Lecture de w:tblLook : attributs Word 2010+ ou ancienne valeur hexadécimale w:val */
  function lookFromXml(el) {
    if (!el) return 'hBand vBand';   // élément absent : tout désactivé sauf les bandes (valeurs par défaut du schéma)
    const has = a => el.hasAttribute('w:' + a);
    const on = a => { const v = el.getAttribute('w:' + a); return v === '1' || v === 'true' || v === 'on'; };
    const o = {};
    if (['firstRow', 'lastRow', 'firstColumn', 'lastColumn', 'noHBand', 'noVBand'].some(has)) {
      o.firstRow = on('firstRow'); o.lastRow = on('lastRow'); o.firstColumn = on('firstColumn'); o.lastColumn = on('lastColumn');
      o.hBand = !on('noHBand'); o.vBand = !on('noVBand');
    } else {
      const v = parseInt(el.getAttribute('w:val') || '0', 16) || 0;
      o.firstRow = !!(v & 0x20); o.lastRow = !!(v & 0x40); o.firstColumn = !!(v & 0x80); o.lastColumn = !!(v & 0x100);
      o.hBand = !(v & 0x200); o.vBand = !(v & 0x400);
    }
    return lookString(o);
  }
  function lookXml(str) {
    const o = parseLook(str);
    const v = (o.firstRow ? 0x20 : 0) | (o.lastRow ? 0x40 : 0) | (o.firstColumn ? 0x80 : 0) | (o.lastColumn ? 0x100 : 0) | (o.hBand ? 0 : 0x200) | (o.vBand ? 0 : 0x400);
    const b = x => (x ? '1' : '0');
    return `<w:tblLook w:val="${v.toString(16).toUpperCase().padStart(4, '0')}" w:firstRow="${b(o.firstRow)}" w:lastRow="${b(o.lastRow)}" w:firstColumn="${b(o.firstColumn)}" w:lastColumn="${b(o.lastColumn)}" w:noHBand="${b(!o.hBand)}" w:noVBand="${b(!o.vBand)}"/>`;
  }

  /* ---------- Fusion des définitions ---------- */
  /** Fusionne deux zones (b l'emporte sur a pour chaque propriété définie) */
  function mergePart(a, b) {
    if (!a) return b ? JSON.parse(JSON.stringify(b)) : undefined;
    if (!b) return a;
    const o = Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      if (k === 'borders') o.borders = Object.assign({}, a.borders || {}, v);
      else o[k] = v;
    }
    return o;
  }

  /* ---------- Calcul des cellules ---------- */
  /** Grille logique du tableau (fusions horizontales et verticales) */
  function layout(T) {
    const rows = Array.from(T.rows);
    const occ = [];
    const cells = [];
    rows.forEach((tr, r) => {
      occ[r] = occ[r] || [];
      let c = 0;
      for (const td of Array.from(tr.cells)) {
        while (occ[r][c]) c++;
        const cs = td.colSpan || 1, rs = Math.max(1, td.rowSpan || 1);
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) { occ[r + i] = occ[r + i] || []; occ[r + i][c + j] = true; }
        cells.push({ td, r, c, r2: Math.min(rows.length - 1, r + rs - 1), c2: c + cs - 1 });
        c += cs;
      }
    });
    const nC = Math.max(1, ...occ.map(r => r.length));
    return { cells, nR: rows.length, nC };
  }

  /**
   * Mise en forme déduite de chaque cellule : Map(td → propriétés)
   * def : définition du style ; look : options ; extra : { borders } bordures directes du tableau
   */
  function compute(T, def, lookStr, extra = {}) {
    const look = parseLook(lookStr);
    const { cells, nR, nC } = layout(T);
    const out = new Map();
    if (!def) return out;
    const rb = Math.max(1, +(extra.rowBand || def.rowBand) || 1), cb = Math.max(1, +(extra.colBand || def.colBand) || 1);
    const tblB = Object.assign({}, def.tblBorders || {}, extra.borders || {});
    const cond = def.cond || {};
    const r0 = look.firstRow && nR > 1 ? 1 : 0, rEnd = look.lastRow && nR > 1 ? nR - 2 : nR - 1;
    const c0 = look.firstColumn && nC > 1 ? 1 : 0, cEnd = look.lastColumn && nC > 1 ? nC - 2 : nC - 1;
    for (const cell of cells) {
      const { r, c, r2, c2 } = cell;
      const parts = [];   // [part, région [r0, c0, r1, c1]]
      parts.push([{ borders: tblB }, [0, 0, nR - 1, nC - 1]]);
      if (def.whole) parts.push([def.whole, [0, 0, nR - 1, nC - 1]]);
      if (cond.wholeTable) parts.push([cond.wholeTable, [0, 0, nR - 1, nC - 1]]);
      // bandes verticales (sans la première / dernière colonne mises en valeur)
      if (look.vBand && c >= c0 && c2 <= cEnd) {
        const k = Math.floor((c - c0) / cb), a = c0 + k * cb;
        const p = cond[k % 2 ? 'band2Vert' : 'band1Vert'];
        if (p) parts.push([p, [0, a, nR - 1, Math.min(cEnd, a + cb - 1)]]);
      }
      // bandes horizontales (sans la ligne d'en-tête / des totaux)
      if (look.hBand && r >= r0 && r2 <= rEnd) {
        const k = Math.floor((r - r0) / rb), a = r0 + k * rb;
        const p = cond[k % 2 ? 'band2Horz' : 'band1Horz'];
        if (p) parts.push([p, [a, 0, Math.min(rEnd, a + rb - 1), nC - 1]]);
      }
      const fc = look.firstColumn && c === 0, lc = look.lastColumn && c2 === nC - 1;
      const fr = look.firstRow && r === 0, lr = look.lastRow && r2 === nR - 1 && nR > 1;
      if (fc && cond.firstCol) parts.push([cond.firstCol, [0, 0, nR - 1, 0]]);
      if (lc && cond.lastCol) parts.push([cond.lastCol, [0, nC - 1, nR - 1, nC - 1]]);
      if (fr && cond.firstRow) parts.push([cond.firstRow, [0, 0, 0, nC - 1]]);
      if (lr && cond.lastRow) parts.push([cond.lastRow, [nR - 1, 0, nR - 1, nC - 1]]);
      if (fr && fc && cond.nwCell) parts.push([cond.nwCell, [0, 0, 0, 0]]);
      if (fr && lc && cond.neCell) parts.push([cond.neCell, [0, nC - 1, 0, nC - 1]]);
      if (lr && fc && cond.swCell) parts.push([cond.swCell, [nR - 1, 0, nR - 1, 0]]);
      if (lr && lc && cond.seCell) parts.push([cond.seCell, [nR - 1, nC - 1, nR - 1, nC - 1]]);

      const p = { borders: {} };
      for (const [part, [ra, ca, rz, cz]] of parts) {
        for (const k of ['shd', 'color', 'b', 'i', 'caps', 'font', 'sz', 'jc', 'va', 'before', 'after', 'line', 'lineRule']) if (part[k] !== undefined) p[k] = part[k];
        const B = part.borders;
        if (!B) continue;
        const pick = (edge, inner, isEdge) => isEdge ? B[edge] : B[inner];
        const set = (side, v) => { if (v !== undefined) p.borders[side] = v; };
        set('top', pick('top', 'insideH', r <= ra));
        set('bottom', pick('bottom', 'insideH', r2 >= rz));
        set('left', pick('left', 'insideV', c <= ca));
        set('right', pick('right', 'insideV', c2 >= cz));
      }
      out.set(cell.td, p);
    }
    return out;
  }

  /* ---------- Conversion en CSS ---------- */
  const BSTYLE = { single: 'solid', thick: 'solid', double: 'double', triple: 'double', dotted: 'dotted', dashed: 'dashed', dashSmallGap: 'dashed', dotDash: 'dashed', dotDotDash: 'dotted', wave: 'solid', inset: 'inset', outset: 'outset', threeDEmboss: 'ridge', threeDEngrave: 'groove' };
  function borderCss(b) {
    if (!b || !b.v || b.v === 'nil' || b.v === 'none') return null;
    const st = BSTYLE[b.v] || 'solid';
    let w = (+b.sz || 4) / 8;
    if (st === 'double') w = Math.max(2.25, w * 3);   // trait double : deux traits et un espace
    w = Math.max(0.75, w);
    const c = !b.c || b.c === 'auto' ? '#000000' : b.c;
    return `${Math.round(w * 100) / 100}pt ${st} ${c}`;
  }
  const JC = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right', left: 'left', start: 'left' };
  /**
   * Propriétés définies par le style Normal du document : dans Word, le style de paragraphe
   * l'emporte sur le style de tableau (valeurs par défaut du document < style de tableau
   * < style de paragraphe < mise en forme directe). Plume écrit toujours ces propriétés
   * dans son style Normal.
   */
  const PLUME_NORMAL_DEFS = ['after', 'before', 'line', 'font', 'sz'];
  const normalDefs = () => (typeof Ed !== 'undefined' && Ed.settings && Ed.settings.normalDefs) || PLUME_NORMAL_DEFS;
  function cssVars(p, skip = []) {
    if (skip.length) { p = Object.assign({}, p); for (const k of skip) delete p[k]; if (skip.includes('line')) delete p.lineRule; }
    const v = {};
    if (p.shd) v.bg = p.shd;
    if (p.color) v.color = p.color === 'auto' ? '#000000' : p.color;
    if (p.b !== undefined) v.fw = p.b ? 'bold' : 'normal';
    if (p.i !== undefined) v.fst = p.i ? 'italic' : 'normal';
    if (p.font && typeof DocxImport !== 'undefined') v.ff = DocxImport.cssFont(p.font);
    if (p.sz) v.fz = p.sz + 'pt';
    if (p.caps !== undefined) v.tt = p.caps ? 'uppercase' : 'none';
    if (p.jc && JC[p.jc]) v.ta = JC[p.jc];
    if (p.va) v.va = p.va === 'center' ? 'middle' : p.va;
    if (p.after != null) v.pa = p.after + 'pt';
    if (p.before != null) v.pb = p.before + 'pt';
    if (p.line != null) v.lh = (!p.lineRule || p.lineRule === 'auto') ? String(Math.round(p.line / 240 * 100) / 100) : (Math.round(p.line / 20 * 10) / 10) + 'pt';
    const B = p.borders || {};
    // côté sans bordure : repère pointillé d'édition, sauf sur une cellule colorée (aspect plus net)
    for (const [side, k] of [['top', 'bt'], ['bottom', 'bb'], ['left', 'bl'], ['right', 'br']]) { const c = borderCss(B[side]); if (c) v[k] = c; else if (p.shd) v[k] = '0 none'; }
    return v;
  }

  /* ---------- Registre (styles du document + galerie) ---------- */
  const docStyles = () => (typeof Ed !== 'undefined' && Ed.settings && Ed.settings.tableStyles) || {};
  function get(id) {
    if (!id) return null;
    return docStyles()[id] || GALLERY_BY_ID[id] || null;
  }
  const extraOf = T => {
    const e = {};
    if (T.dataset.tbdr) { try { e.borders = JSON.parse(T.dataset.tbdr); } catch { } }
    if (T.dataset.band) { const [r, c] = T.dataset.band.split(','); e.rowBand = +r || undefined; e.colBand = +c || undefined; }
    return e;
  };

  /** Pose (ou retire) la mise en forme déduite sur les cellules d'un tableau */
  function apply(T, def) {
    if (!T || T.tagName !== 'TABLE') return;
    def = def || get(T.dataset.tblstyle);
    const cellsOf = Array.from(T.rows).flatMap(r => Array.from(r.cells));
    for (const td of cellsOf) for (const k of VARS) td.style.removeProperty('--ts-' + k);
    if (!T.dataset.tblstyle || !def) return;
    const m = compute(T, def, T.dataset.look, extraOf(T));
    const skip = normalDefs();
    for (const [td, p] of m) {
      if (td.closest('table') !== T) continue;
      for (const [k, v] of Object.entries(cssVars(p, skip))) td.style.setProperty('--ts-' + k, v);
    }
  }
  function applyAll(root) {
    if (!root) return;
    root.querySelectorAll('table[data-tblstyle]').forEach(T => apply(T));
  }

  /* ---------- Aperçu (galerie du ruban) ---------- */
  function preview(def, lookStr) {
    const T = document.createElement('table');
    T.className = 'ts-prev';
    for (let r = 0; r < 5; r++) {
      const tr = T.insertRow();
      for (let c = 0; c < 5; c++) { const td = tr.insertCell(); td.innerHTML = '<i></i>'; }
    }
    if (!def) { T.classList.add('ts-none'); return T; }
    for (const [td, p] of compute(T, def, lookStr)) {
      const v = cssVars(p);
      if (v.bg) td.style.background = v.bg;
      td.style.color = v.color || '#404040';
      if (v.fw === 'bold') td.classList.add('b');
      for (const [k, s] of [['bt', 'Top'], ['bb', 'Bottom'], ['bl', 'Left'], ['br', 'Right']]) td.style['border' + s] = v[k] ? v[k].replace(/^[\d.]+pt/, m => (parseFloat(m) > 1.2 ? '2px' : '1px')).replace(/2px double|1px double/, '3px double') : '1px solid transparent';
    }
    return T;
  }

  /* ---------- Écriture d'une définition en w:style ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const hex = c => (!c || c === 'auto') ? 'auto' : String(c).replace('#', '').toUpperCase();
  const bXml = (tag, b) => !b ? '' : (!b.v || b.v === 'nil' || b.v === 'none') ? `<w:${tag} w:val="nil"/>` : `<w:${tag} w:val="${esc(b.v)}" w:sz="${+b.sz || 4}" w:space="0" w:color="${hex(b.c)}"/>`;
  const bordersXml = (wrap, B, inner = true) => {
    if (!B) return '';
    const x = SIDES.filter(s => inner || !s.startsWith('inside')).map(s => bXml(s, B[s])).join('');
    return x ? `<w:${wrap}>${x}</w:${wrap}>` : '';
  };
  function pPrXml(p) {
    const sp = [];
    if (p.before != null) sp.push(`w:before="${Math.round(p.before * 20)}"`);
    if (p.after != null) sp.push(`w:after="${Math.round(p.after * 20)}"`);
    if (p.line != null) sp.push(`w:line="${p.line}" w:lineRule="${p.lineRule || 'auto'}"`);
    const x = (sp.length ? `<w:spacing ${sp.join(' ')}/>` : '') + (p.jc ? `<w:jc w:val="${esc(p.jc)}"/>` : '');
    return x ? `<w:pPr>${x}</w:pPr>` : '';
  }
  function rPrXml(p) {
    let x = '';
    if (p.font) x += `<w:rFonts w:ascii="${esc(p.font)}" w:hAnsi="${esc(p.font)}" w:cs="${esc(p.font)}"/>`;
    if (p.b !== undefined) x += p.b ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>';
    if (p.i !== undefined) x += p.i ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>';
    if (p.caps !== undefined) x += p.caps ? '<w:caps/>' : '<w:caps w:val="0"/>';
    if (p.color) x += `<w:color w:val="${hex(p.color)}"/>`;
    if (p.sz) x += `<w:sz w:val="${Math.round(p.sz * 2)}"/><w:szCs w:val="${Math.round(p.sz * 2)}"/>`;
    return x ? `<w:rPr>${x}</w:rPr>` : '';
  }
  function tcPrXml(p) {
    const x = bordersXml('tcBorders', p.borders) + (p.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${hex(p.shd)}"/>` : '') + (p.va ? `<w:vAlign w:val="${esc(p.va)}"/>` : '');
    return x ? `<w:tcPr>${x}</w:tcPr>` : '';
  }
  function toXml(def) {
    if (!def) return '';
    const w = def.whole || {};
    let x = `<w:style w:type="table" w:styleId="${esc(def.id)}"><w:name w:val="${esc(def.name || def.id)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="${def.ui || 50}"/>`;
    x += pPrXml(w) + rPrXml(w);
    x += `<w:tblPr><w:tblStyleRowBandSize w:val="${def.rowBand || 1}"/><w:tblStyleColBandSize w:val="${def.colBand || 1}"/>${bordersXml('tblBorders', def.tblBorders)}<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
    x += tcPrXml(Object.assign({}, w, { borders: w.borders }));
    for (const t of CONDS) {
      const p = def.cond && def.cond[t];
      if (!p) continue;
      x += `<w:tblStylePr w:type="${t}">${pPrXml(p)}${rPrXml(p)}<w:tblPr/>${tcPrXml(p)}</w:tblStylePr>`;
    }
    return x + '</w:style>';
  }

  /* ---------- Galerie : styles originaux de Plume ---------- */
  const S = (sz, c, v = 'single') => ({ v, sz, c });
  const NIL = { v: 'nil' };
  /**
   * Fabrique un style à bandes : o = { head, headText, band, line, outer, verticals, headLine }
   */
  function banded(id, name, o) {
    const line = o.line, outer = o.outer || o.line;
    const tblBorders = { top: S(o.outerSz || 8, outer), bottom: S(o.outerSz || 8, outer), insideH: S(4, line) };
    if (o.verticals) Object.assign(tblBorders, { left: S(4, line), right: S(4, line), insideV: S(4, line) });
    const head = { b: true, borders: { bottom: S(o.headLine || 8, o.head || outer) } };
    if (o.head) { head.shd = o.head; head.color = o.headText || '#FFFFFF'; head.borders = { top: S(8, o.head), bottom: S(8, o.head), insideV: o.headVert ? S(4, o.headVert) : NIL, left: o.verticals ? S(4, o.head) : undefined, right: o.verticals ? S(4, o.head) : undefined }; }
    return {
      id, name, rowBand: 1, colBand: 1, tblBorders,
      whole: { after: 0, line: 240, lineRule: 'auto' },
      cond: {
        firstRow: head,
        lastRow: { b: true, borders: { top: S(6, o.outer || o.head || line, 'double') } },
        firstCol: { b: true },
        lastCol: { b: true },
        band1Vert: o.band ? { shd: o.band } : undefined,
        band1Horz: o.band ? { shd: o.band } : undefined
      }
    };
  }
  const GALLERY = [
    {
      id: 'TableGrid', name: 'Table Grid', label: 'Grille du tableau', ui: 39, rowBand: 1, colBand: 1,
      tblBorders: { top: S(4, 'auto'), left: S(4, 'auto'), bottom: S(4, 'auto'), right: S(4, 'auto'), insideH: S(4, 'auto'), insideV: S(4, 'auto') },
      whole: { after: 0, line: 240, lineRule: 'auto' }, cond: {}
    },
    Object.assign(banded('PlumeTurquoise', 'Plume Turquoise', { head: '#0B7A64', band: '#E3F8F2', line: '#8FDCCB', outer: '#0B7A64' }), { label: 'Plume Turquoise' }),
    Object.assign(banded('PlumeArdoise', 'Plume Ardoise', { head: '#2F3B47', band: '#EEF1F4', line: '#B7C0C9', outer: '#2F3B47', verticals: true, headVert: '#4A5866' }), { label: 'Ardoise' }),
    Object.assign(banded('PlumeOcean', 'Plume Ocean', { head: '#1F5F8B', band: '#E2EDF6', line: '#9DBEDB', outer: '#1F5F8B' }), { label: 'Océan' }),
    Object.assign(banded('PlumeCorail', 'Plume Corail', { head: '#C8553D', band: '#FBE8E3', line: '#E9A99A', outer: '#C8553D', verticals: true, headVert: '#D9765F' }), { label: 'Corail' }),
    Object.assign(banded('PlumeForet', 'Plume Foret', { head: '#2E6B30', band: '#E6F2E6', line: '#8BBF8C', outer: '#2E6B30' }), { label: 'Forêt' }),
    Object.assign(banded('PlumeLavande', 'Plume Lavande', { head: '#5E4B8B', band: '#EEEAF6', line: '#B9AED6', outer: '#5E4B8B', verticals: true, headVert: '#7A68A6' }), { label: 'Lavande' }),
    Object.assign(banded('PlumeAmbre', 'Plume Ambre', { head: '#F2B544', headText: '#3A2A00', band: '#FFF5DE', line: '#F2D28C', outer: '#C98A00' }), { label: 'Ambre' }),
    Object.assign(banded('PlumeLignes', 'Plume Lignes fines', { line: '#BFBFBF', outer: '#404040', headLine: 12 }), { label: 'Lignes fines' }),
    Object.assign(banded('PlumeMinimal', 'Plume Minimal', { band: '#F2F2F2', line: '#FFFFFF', outer: '#7F7F7F', outerSz: 4 }), { label: 'Minimal gris' }),
    Object.assign(banded('PlumeContraste', 'Plume Contraste', { head: '#111111', headText: '#26EFC5', band: '#F3F3F3', line: '#8C8C8C', outer: '#111111', verticals: true, headVert: '#333333' }), { label: 'Contraste ASBL' })
  ];
  // Minimal gris : pas de traits intérieurs (la couleur des bandes suffit)
  GALLERY[9].tblBorders.insideH = NIL;
  const GALLERY_BY_ID = Object.fromEntries(GALLERY.map(d => [d.id, d]));

  return { PLUME_NORMAL_DEFS, CONDS, SIDES, LOOK_KEYS, DEFAULT_LOOK, GALLERY, parseLook, lookString, lookFromXml, lookXml, mergePart, compute, cssVars, borderCss, get, apply, applyAll, preview, toXml, bordersXml };
})();
