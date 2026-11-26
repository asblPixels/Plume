/* =====================================================================
   Plume — moteur de l'éditeur
   Pages, pagination, en-têtes / pieds, historique (annuler / rétablir),
   commandes de mise en forme, recherche, tableaux, images.
   ===================================================================== */
'use strict';

const GAP = 26; // espace entre deux pages (px)

/**
 * Hauteur de ligne « naturelle » des polices, comme Word la calcule :
 * (usWinAscent + usWinDescent) / unitsPerEm (ou hhea avec interligne).
 * L'interligne « multiple » de Word (w:line auto) multiplie cette hauteur,
 * pas la taille de police : 11 pt × 1,08 × 1,22 (Calibri) ≈ 14,5 pt.
 * Mesures fontTools (polices installées / vendor/fonts) ou valeurs Word connues.
 */
const FONT_RATIO = {
  calibri: 1.22, carlito: 1.22, aptos: 1.2, arial: 1.149, 'liberation sans': 1.149, arimo: 1.149, helvetica: 1.149,
  'times new roman': 1.149, 'liberation serif': 1.149, tinos: 1.149, times: 1.149, cambria: 1.172, caladea: 1.172,
  georgia: 1.136, verdana: 1.215, 'segoe ui': 1.33, 'courier new': 1.133, 'liberation mono': 1.133, cousine: 1.133,
  'comic sans ms': 1.394, consolas: 1.17, 'cascadia code': 1.17, tahoma: 1.207, 'trebuchet ms': 1.16,
  'dejavu sans': 1.164, 'dejavu serif': 1.164, 'dejavu sans mono': 1.164, 'open sans': 1.362, 'noto sans': 1.362,
  roboto: 1.172, inter: 1.21, marelle: 2.88, borel: 2.304, 'playwrite fr moderne': 2.22, 'playwrite fr trad': 2.867,
  andika: 1.611, 'atkinson hyperlegible': 1.24, 'comic neue': 1.35, lexend: 1.59, opendyslexic: 1.82
};
/** Ratio de la première police d'une pile CSS (1,2 si inconnue) */
function fontRatio(css) {
  const f = String(css || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return FONT_RATIO[f] || 1.2;
}

const Ed = {
  editor: null, sheet: null, pagesLayer: null,
  page: null, settings: null,
  props: { title: '', author: '', created: null },
  zoom: 1, pageCount: 1,
  headerHTML: '', footerHTML: '',
  images: new Map(),          // url blob: -> Blob
  lastRange: null,
  onChange: null,             // rappel (autosauvegarde, statut)

  /* ---------- Valeurs par défaut ---------- */
  defaultPage() {
    const cm = U.cmToPx;
    return { w: cm(21), h: cm(29.7), mt: cm(2.5), mr: cm(2.5), mb: cm(2.5), ml: cm(2.5), mh: cm(1.25), mf: cm(1.25) };
  },
  defaultSettings() {
    return { fontCss: 'Calibri, Carlito, "Liberation Sans", Arial, sans-serif', size: 11, lineHeight: 1.15, after: 8, before: 0, color: '#000000', heading: '#0B5E4E', tableStyles: {}, normalDefs: TableStyles.PLUME_NORMAL_DEFS.slice() };
  },

  init() {
    this.editor = $('#editor');
    this.sheet = $('#sheet');
    this.pagesLayer = $('#pagesLayer');
    this.pushStyle = el('style', { id: 'pushStyle' });
    document.head.append(this.pushStyle);
    this.page = this.defaultPage();
    this.settings = this.defaultSettings();
    document.execCommand('defaultParagraphSeparator', false, 'p');

    const ed = this.editor;
    ed.classList.add('pl-wlh');
    ed.addEventListener('input', () => this.changed(true));
    // saisie composée (IME) : pas de recalcul pendant la composition
    ed.addEventListener('compositionstart', () => { this._composing = true; });
    ed.addEventListener('compositionend', () => { this._composing = false; this.relayout(); });
    // copier / couper / glisser : jamais d'artefact de pagination dans le presse-papiers
    const clipClean = () => {
      const r = this.range();
      if (r && [...ed.querySelectorAll('[data-pl-artifact]')].some(a => r.intersectsNode(a))) { this.stripArtifacts(); this.relayout(); }
    };
    ed.addEventListener('copy', clipClean, true);
    ed.addEventListener('cut', clipClean, true);
    ed.addEventListener('dragstart', clipClean, true);
    ed.addEventListener('keydown', e => this.onKeyDown(e));
    ed.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo') { e.preventDefault(); this.undo(); }
      if (e.inputType === 'historyRedo') { e.preventDefault(); this.redo(); }
    });
    ed.addEventListener('paste', e => this.onPaste(e));
    ed.addEventListener('drop', e => this.onDrop(e));
    ed.addEventListener('click', e => this.onClick(e));
    ed.addEventListener('load', e => { if (e.target.tagName === 'IMG') this.relayout(); }, true);
    document.addEventListener('selectionchange', () => {
      const r = this.range();
      if (r && (this.editor.contains(r.commonAncestorContainer) || this.inHF(r.commonAncestorContainer))) {
        this.lastRange = r.cloneRange();
        this.onSelection && this.onSelection();
      }
    });
    new ResizeObserver(() => this.relayout()).observe(this.editor);
    if (document.fonts) document.fonts.ready.then(() => this.relayout());
    this.initImageHandle();
  },

  /* =====================================================================
     Document : charger / sérialiser
     ===================================================================== */
  applySettings() {
    const s = this.settings, st = this.editor.style;
    st.setProperty('--doc-font', s.fontCss);
    st.setProperty('--doc-size', s.size + 'pt');
    st.setProperty('--doc-lh', s.lineHeight);
    st.setProperty('--doc-pafter', s.after + 'pt');
    st.setProperty('--doc-pbefore', s.before + 'pt');
    st.setProperty('--doc-color', s.color || '#000');
    st.setProperty('--doc-heading', s.heading || '#0B5E4E');
    st.setProperty('--doc-fr', fontRatio(s.fontCss));
    // les en-têtes/pieds héritent de la police du document
    this.pagesLayer.style.setProperty('--doc-font', s.fontCss);
    this.pagesLayer.style.setProperty('--doc-pafter', '0pt');
    this.pagesLayer.style.setProperty('--doc-pbefore', '0pt');
  },

  load({ html, header = '', footer = '', page, settings, props }) {
    this.page = Object.assign(this.defaultPage(), page || {});
    this.settings = Object.assign(this.defaultSettings(), settings || {});
    this.props = Object.assign({ title: '', author: '', created: null }, props || {});
    this.editor.innerHTML = this.sanitizeStored(html || '<p><br></p>');
    if (!this.editor.firstChild) this.editor.innerHTML = '<p><br></p>';
    this.applySettingsTables();
    this.headerHTML = header || '';
    this.footerHTML = footer || '';
    this.applySettings();
    this.history = []; this.hIndex = -1;
    this.pages = null; this._laidOut = false;
    this.renderPages(true);
    this._layout();
    this.relayout();
    this.commit();
    this.placeCaretStart();
  },

  /** Styles de tableau : recalcul de la mise en forme déduite (registre du document + galerie) */
  applySettingsTables() {
    if (!this.settings.tableStyles) this.settings.tableStyles = {};
    TableStyles.applyAll(this.editor);
  },

  /** Contenu stocké : on retire les éventuels résidus d'interface */
  sanitizeStored(html) {
    return this.cleanString(html.replace(/\sclass="sel-img"/g, ''));
  },

  placeCaretStart() {
    const first = this.editor.firstElementChild || this.editor;
    const r = document.createRange();
    r.setStart(first, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    this.lastRange = r;
  },

  /** État complet pour l'enregistrement local (images en data: URL) */
  async getState() {
    const toData = async html => {
      const urls = [...new Set((html.match(/blob:[^"')\s]+/g) || []))];
      for (const u of urls) {
        try {
          const b = this.images.get(u) || await (await fetch(u)).blob();
          const d = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
          html = html.split(u).join(d);
        } catch { /* image perdue */ }
      }
      return html;
    };
    return {
      html: await toData(this.cleanHTML()),
      header: await toData(this.headerHTML), footer: await toData(this.footerHTML),
      page: this.page, settings: this.settings, props: this.props
    };
  },
  /** Convertit les data: URL en blob: (historique léger) */
  async hydrateImages(html) {
    const urls = [...new Set((html.match(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/g) || []))];
    for (const u of urls) {
      const b = await (await fetch(u)).blob();
      html = html.split(u).join(this.registerImage(b));
    }
    return html;
  },
  registerImage(blob) {
    const url = URL.createObjectURL(blob);
    this.images.set(url, blob);
    return url;
  },

  /* =====================================================================
     Sections, pages et pagination
     ---------------------------------------------------------------------
     Le document reste un flux unique (contenteditable). Les pages sont des
     cartes dessinées derrière lui ; la pagination ne modifie jamais le
     modèle : elle pose des règles CSS (#pushStyle : marges, décalages de
     colonnes) et des « artefacts » (sauts de ligne de page, rangées vides de
     tableau) marqués data-pl-artifact, retirés avant chaque recalcul et
     exclus de tout enregistrement / export / copie / historique.
     Sections : <hr class="pl-section" data-sect='{…}'> termine une section
     et porte SES propriétés (comme le w:sectPr de Word) ; la dernière
     section est Ed.page.
     ===================================================================== */
  pages: null,      // [{y, x, w, h, mt, mb, ml, mr, mh, mf, si, seps}]
  sheetW: 0,        // largeur de la feuille (page la plus large)

  /** Marqueurs de fin de section (premier niveau) */
  sectMarkers() { return Array.from(this.editor.children).filter(e => e.tagName === 'HR' && e.classList.contains('pl-section')); },
  /** Propriétés d'un marqueur (mises en cache tant que l'attribut ne change pas) */
  sectOf(m) {
    const raw = m.dataset.sect || '{}';
    if (m._sc && m._sc.raw === raw) return m._sc.v;
    let v = {};
    try { v = JSON.parse(raw); } catch { v = {}; }
    v = Object.assign(this.defaultPage(), v);
    m._sc = { raw, v };
    return v;
  },
  /** Toutes les sections, dans l'ordre ; la dernière est Ed.page */
  sections() { return [...this.sectMarkers().map(m => this.sectOf(m)), this.page]; },
  /** Index de la section contenant un nœud */
  sectIndexOf(node) {
    const ms = this.sectMarkers();
    if (!ms.length || !node) return 0;
    let n = node.nodeType === 1 ? node : node.parentElement;
    while (n && n.parentElement !== this.editor) n = n.parentElement;
    if (!n) return ms.length;
    let i = 0;
    for (const m of ms) { if (m !== n && (m.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) i++; else break; }
    // le marqueur lui-même appartient à la section qu'il termine
    return ms.includes(n) ? ms.indexOf(n) : i;
  },
  curSectIndex() { const r = this.lastRange; return r && this.editor.contains(r.startContainer) ? this.sectIndexOf(r.startContainer) : this.sections().length - 1; },
  curSect() { return this.sections()[this.curSectIndex()]; },
  /** Modifie les propriétés d'une section (fn reçoit l'objet modifiable) */
  updateSect(i, fn) {
    const ms = this.sectMarkers();
    if (i >= ms.length) { fn(this.page); return; }
    const v = JSON.parse(JSON.stringify(this.sectOf(ms[i])));
    fn(v);
    ms[i].dataset.sect = JSON.stringify(v);
  },
  /** Géométrie des colonnes d'une section : [{x, w}] relatifs au bord gauche de la zone de texte */
  colsOf(s) {
    const cw = s.w - s.ml - s.mr;
    const c = s.cols || {};
    const n = Math.max(1, Math.min(12, c.n | 0 || 1));
    if (n === 1) return [{ x: 0, w: cw }];
    const out = [];
    if (c.eq === false && Array.isArray(c.list) && c.list.length >= n) {
      const tot = c.list.slice(0, n).reduce((a, k, j) => a + k.w + (j < n - 1 ? (k.space || 0) : 0), 0) || cw;
      const k = cw / tot; let x = 0;
      for (let j = 0; j < n; j++) { const w = c.list[j].w * k; out.push({ x, w }); x += w + (c.list[j].space || 0) * k; }
      return out;
    }
    const sp = c.space != null ? c.space : U.cmToPx(1.25);
    const w = Math.max(20, (cw - sp * (n - 1)) / n);
    for (let j = 0; j < n; j++) out.push({ x: j * (w + sp), w });
    return out;
  },
  /** Page par défaut (avant la première mise en page) */
  defaultPages() {
    const s = this.sections()[0];
    return [{ y: 0, x: 0, w: s.w, h: s.h, mt: s.mt, mb: s.mb, ml: s.ml, mr: s.mr, mh: s.mh, mf: s.mf, si: 0, seps: [] }];
  },

  renderPages(force) {
    if (!this.pages || !this._laidOut) this.pages = this.defaultPages();
    const pgs = this.pages;
    const n = pgs.length;
    this.pageCount = n;
    const W = this.sheetW = Math.max(...this.sections().map(s => s.w));
    const layer = this.pagesLayer;
    if (force) layer.innerHTML = '';
    while (layer.children.length > n) layer.lastChild.remove();
    while (layer.children.length < n) {
      const card = el('div', { class: 'page-card' }, [
        el('div', { class: 'hf header', contenteditable: 'true', 'data-ph': 'En-tête (double-clic pour modifier)', spellcheck: 'true' }),
        el('div', { class: 'hf footer', contenteditable: 'true', 'data-ph': 'Pied de page', spellcheck: 'true' }),
        el('div', { class: 'pnotes', style: 'position:absolute' }),
        el('span', { class: 'page-num-badge' })
      ]);
      card.querySelectorAll('.hf').forEach(h => {
        h.addEventListener('input', () => this.onHFInput(h));
        h.addEventListener('focus', () => { this.activeHF = h; });
      });
      layer.append(card);
      this.fillHF(card, layer.children.length - 1);
    }
    Array.from(layer.children).forEach((card, i) => {
      const p = pgs[i];
      Object.assign(card.style, { top: p.y + 'px', left: p.x + 'px', width: p.w + 'px', height: p.h + 'px' });
      const hd = card.querySelector('.header'), ft = card.querySelector('.footer');
      Object.assign(hd.style, { top: p.mh + 'px', left: p.ml + 'px', right: p.mr + 'px' });
      Object.assign(ft.style, { bottom: p.mf + 'px', left: p.ml + 'px', right: p.mr + 'px', top: 'auto' });
      card.querySelector('.page-num-badge').textContent = i + 1;
      // traits de séparation des colonnes
      const key = JSON.stringify(p.seps || []);
      if (card._seps !== key) {
        card._seps = key;
        card.querySelectorAll('.pl-colsep').forEach(x => x.remove());
        for (const s of p.seps || []) card.append(el('div', { class: 'pl-colsep', style: `left:${s.x.toFixed(1)}px;top:${s.y1.toFixed(1)}px;height:${Math.max(0, s.y2 - s.y1).toFixed(1)}px` }));
      }
      if (force) this.fillHF(card, i);
      else this.updateFields(card, i);
    });
    const ed = this.editor, s0 = this.sections()[0];
    const x0 = (W - s0.w) / 2;
    Object.assign(ed.style, {
      width: W + 'px',
      paddingTop: s0.mt + 'px', paddingLeft: (x0 + s0.ml) + 'px',
      paddingRight: (x0 + s0.mr) + 'px', paddingBottom: s0.mb + 'px'
    });
    const last = pgs[n - 1];
    const H = last.y + last.h;
    this.sheet.style.width = W + 'px';
    this.sheet.style.height = H + 'px';
    ed.style.minHeight = H + 'px';
  },
  fillHF(card, i) {
    const hd = card.querySelector('.header'), ft = card.querySelector('.footer');
    // Première page différente (document Word d'origine) : affichée, conservée telle quelle
    const s0 = this.sections()[0];
    const first = i === 0 && s0.titlePg && this.page.first;
    for (const [elx, html, firstHtml] of [[hd, this.headerHTML, first && this.page.first.header], [ft, this.footerHTML, first && this.page.first.footer]]) {
      elx.toggleAttribute('data-pl-first-page', !!first);
      if (first) {
        elx.contentEditable = 'false';
        elx.title = 'En-tête/pied de la première page — conservé tel quel depuis le document d’origine';
        elx.innerHTML = firstHtml || '';
      } else {
        if (elx.contentEditable === 'false' && !document.body.classList.contains('reading')) { elx.contentEditable = 'true'; elx.removeAttribute('title'); }
        if (document.activeElement !== elx) elx.innerHTML = html;
      }
    }
    this.updateFields(card, i);
  },
  updateFields(card, i) {
    card.querySelectorAll('.pl-field[data-field]').forEach(f => {
      const v = f.dataset.field === 'page' ? String(i + 1) : String(this.pageCount);
      if (f.textContent !== v) f.textContent = v;
    });
  },
  onHFInput(h) {
    const isHeader = h.classList.contains('header');
    const html = h.innerHTML;
    if (isHeader) this.headerHTML = html; else this.footerHTML = html;
    Array.from(this.pagesLayer.children).forEach((card, i) => {
      const t = card.querySelector(isHeader ? '.header' : '.footer');
      if (t !== h && t.contentEditable !== 'false') { t.innerHTML = html; this.updateFields(card, i); }
    });
    this.changed(true);
  },
  inHF(n) { return !!(n && (n.nodeType === 1 ? n : n.parentElement)?.closest('.hf')); },
  headerEl() { return this.pagesLayer.querySelector('.header:not([data-pl-first-page])'); },
  footerEl() { return this.pagesLayer.querySelector('.footer:not([data-pl-first-page])'); },

  /** Unités de pagination : blocs de premier niveau, et éléments de liste */
  units() {
    const out = [];
    let si = 0;
    Array.from(this.editor.children).forEach((b, k) => {
      if (b.tagName === 'STYLE' || b.hasAttribute('data-pl-artifact')) return;
      const isSect = b.tagName === 'HR' && b.classList.contains('pl-section');
      if ((b.tagName === 'UL' || b.tagName === 'OL') && b.children.length) {
        Array.from(b.children).forEach((li, j) => out.push({ el: li, top: b, si, sel: `#editor > :nth-child(${k + 1}) > :nth-child(${j + 1})`, tsel: `#editor > :nth-child(${k + 1})` }));
      } else out.push({ el: b, top: b, si, sel: `#editor > :nth-child(${k + 1})`, tsel: `#editor > :nth-child(${k + 1})` });
      if (isSect) si++;
    });
    return out;
  },

  /* ---------- Artefacts de pagination ---------- */
  /** Retire les artefacts (et recolle les nœuds texte coupés) en conservant la sélection */
  stripArtifacts(root = this.editor) {
    const arts = root.querySelectorAll('[data-pl-artifact]');
    if (!arts.length) return false;
    const sel = getSelection();
    const pts = sel.rangeCount && root.contains(sel.anchorNode) ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
    const lr = this.lastRange && root.contains(this.lastRange.startContainer) ? [this.lastRange.startContainer, this.lastRange.startOffset, this.lastRange.endContainer, this.lastRange.endOffset] : null;
    const moved = new Map();  // nœud texte fusionné -> {into, add}
    for (const a of arts) {
      const prev = a.previousSibling, next = a.nextSibling;
      a.remove();
      if (prev && next && prev.nodeType === 3 && next.nodeType === 3) {
        moved.set(next, { into: prev, add: prev.length });
        prev.appendData(next.data);
        next.remove();
      }
    }
    const map = (n, o) => { while (moved.has(n)) { const m = moved.get(n); o += m.add; n = m.into; } return [n, o]; };
    const fix = p => { if (!p) return null; const [a, ao] = map(p[0], p[1]); const [b, bo] = map(p[2], p[3]); return [a, ao, b, bo]; };
    const ok = n => n && n.isConnected;
    const sp = fix(pts);
    if (sp && (sp[0] !== pts[0] || sp[2] !== pts[2]) && ok(sp[0]) && ok(sp[2])) { try { sel.setBaseAndExtent(sp[0], sp[1], sp[2], sp[3]); } catch { } }
    const lp = fix(lr);
    if (lp && ok(lp[0]) && ok(lp[2])) { try { const r = document.createRange(); r.setStart(lp[0], lp[1]); r.setEnd(lp[2], lp[3]); this.lastRange = r; } catch { } }
    return true;
  },
  /** HTML du document sans artefacts ni variables d'affichage */
  cleanHTML(html = this.editor.innerHTML) {
    return Ed.cleanString(html);
  },
  cleanString(html) {
    if (!html.includes('data-pl-artifact') && !html.includes('--pl-')) return html;
    return html
      .replace(/<tr\b[^>]*\bdata-pl-artifact\b[^>]*>[\s\S]*?<\/tr>/g, '')
      .replace(/<span\b[^>]*\bdata-pl-artifact\b[^>]*>\s*<\/span>/g, '')
      .replace(/\s*--pl-(?:lhx|lh|fr):[^;"]*;?/g, '')
      .replace(/ style="\s*"/g, '');
  },
  /** Exécute fn sur un document « propre » (exports) puis rétablit la pagination */
  async withCleanDom(fn) {
    if (this._clean) return fn();
    this._clean = 1;
    const ed = this.editor;
    this.stripArtifacts();
    const push = this.pushStyle.textContent;
    this.pushStyle.textContent = '';
    ed.classList.remove('pl-wlh');
    try { return await fn(); }
    finally {
      this._clean = 0;
      ed.classList.add('pl-wlh');
      this.pushStyle.textContent = push;
      this._layout();
    }
  },

  /* ---------- Interligne façon Word ---------- */
  /** Pose --pl-lh / --pl-lhx / --pl-fr (affichage uniquement : retirés à l'enregistrement) */
  syncLineVars() {
    const set = (s, k, v) => { if (s.getPropertyValue(k) !== v) { if (v) s.setProperty(k, v); else s.removeProperty(k); } };
    for (const e of this.editor.querySelectorAll('[style*="line-height"],[style*="font-family"],[style*="--pl-"]')) {
      const s = e.style, lh = s.lineHeight, ff = s.fontFamily;
      let n = '', x = '';
      if (lh && lh !== 'normal') {
        if (/^[\d.]+$/.test(lh)) { n = lh; x = 'initial'; }
        else if (/%$/.test(lh)) { n = String(parseFloat(lh) / 100); x = 'initial'; }
        else x = lh;            // interligne exact / au moins : valeur conservée
      }
      set(s, '--pl-lh', n); set(s, '--pl-lhx', x); set(s, '--pl-fr', ff ? String(fontRatio(ff)) : '');
    }
  },

  relayout: null, // défini plus bas (débouncé)
  _layout() {
    if (this.editor.dataset.exporting || this._clean || this._composing) return;
    const t0 = performance.now();
    const ed = this.editor;
    this.stripArtifacts();
    this.syncLineVars();
    this.pushStyle.textContent = '';
    const secs = this.sections();
    const W = Math.max(...secs.map(s => s.w));
    this.sheetW = W;
    const s0 = secs[0];
    const padL = (W - s0.w) / 2 + s0.ml, padR = (W - s0.w) / 2 + s0.mr;
    Object.assign(ed.style, { width: W + 'px', paddingTop: s0.mt + 'px', paddingLeft: padL + 'px', paddingRight: padR + 'px', paddingBottom: s0.mb + 'px' });
    const cols = secs.map(s => this.colsOf(s));
    const offL = s => (W - s.w) / 2 + s.ml;
    const units = this.units();
    const multi = cols.some(c => c.length > 1);

    // --- 1. Géométrie horizontale (sections, largeur de colonne) ---
    const hRules = [];
    const tops = new Map();   // bloc de premier niveau -> {dL, dR, ml, mr}
    const needH = [];
    for (const u of units) {
      if (tops.has(u.top)) continue;
      const s = secs[u.si], c0 = cols[u.si][0];
      const x0 = offL(s) + c0.x, right = W - (x0 + c0.w);
      const dL = x0 - padL, dR = right - padR;
      const t = { dL, dR, sel: u.tsel };
      tops.set(u.top, t);
      if (Math.abs(dL) > 0.01 || Math.abs(dR) > 0.01 || multi) needH.push([u.top, t]);
    }
    for (const [e, t] of needH) { const cs = getComputedStyle(e); t.ml = parseFloat(cs.marginLeft) || 0; t.mr = parseFloat(cs.marginRight) || 0; }
    const hRule = (t, dx = 0, dw = 0) => `${t.sel}{margin-left:${(t.ml + t.dL + dx).toFixed(2)}px !important;margin-right:${(t.mr + t.dR - dx - dw).toFixed(2)}px !important}`;
    for (const [, t] of needH) if (Math.abs(t.dL) > 0.01 || Math.abs(t.dR) > 0.01) hRules.push(hRule(t));
    // largeurs particulières (colonnes de largeurs inégales), affinées en 2e passe
    let widthFix = new Map();   // unité -> index de colonne
    let place, pages, regions, iter = 0, er;
    const z = this.zoom || 1;
    for (; ;) {
      const wRules = [];
      for (const [i, c] of widthFix) {
        const u = units[i], cg = cols[u.si];
        const dw = cg[c].w - cg[0].w;
        if (u.el === u.top) wRules.push(hRule(tops.get(u.top), 0, dw));
      }
      this.pushStyle.textContent = hRules.concat(wRules).join('\n');
      // --- 2. Mesures (une seule mise en page) ---
      er = ed.getBoundingClientRect();
      const Y = r => (r - er.top) / z;
      const M = units.map(u => {
        const r = u.el.getBoundingClientRect();
        const e = u.el, tag = e.tagName;
        return {
          top: Y(r.top), bot: Y(r.bottom),
          kind: tag === 'HR' ? (e.classList.contains('pl-section') ? 'sect' : e.classList.contains('pl-colbreak') ? 'cb' : e.classList.contains('pl-pagebreak') ? 'pb' : 'blk') : tag === 'TABLE' ? 'table' : 'blk'
        };
      });
      ({ place, pages, regions } = this._place(units, M, secs, cols, W, er, z));
      if (!multi || ++iter > 2) { this._M = M; break; }
      // colonnes inégales : la hauteur dépend de la colonne attribuée
      const nf = new Map();
      place.forEach((p, i) => { if (p && p.c > 0 && Math.abs(cols[units[i].si][p.c].w - cols[units[i].si][0].w) > 0.5) nf.set(i, p.c); });
      const same = nf.size === widthFix.size && [...nf].every(([k, v]) => widthFix.get(k) === v);
      if (same) { this._M = M; break; }
      widthFix = nf;
    }
    const M = this._M;

    // --- 3. Règles verticales et décalages de colonnes (lectures d'abord) ---
    const rules = [];
    let prevPB = null, prevMB = null;
    const jumps = [];
    units.forEach((u, i) => {
      const p = place[i], m = M[i];
      const natural = i === 0 ? m.top : prevPB + (m.top - prevMB);
      const delta = p.t - natural;
      if (Math.abs(delta) > 0.3) rules.push(`${u.sel}{margin-top:${this._marginFor(u.el, delta, m.top, er, z).toFixed(2)}px !important}`);
      const cg = cols[u.si];
      if (p.c > 0 || widthFix.has(i)) {
        const dx = cg[p.c].x - cg[0].x, dw = cg[p.c].w - cg[0].w;
        if (u.el === u.top) rules.push(hRule(tops.get(u.top), dx, dw));
        else if (dx || dw) { const cs = getComputedStyle(u.el); rules.push(`${u.sel}{margin-left:${((parseFloat(cs.marginLeft) || 0) + dx).toFixed(2)}px !important;margin-right:${((parseFloat(cs.marginRight) || 0) - dx - dw).toFixed(2)}px !important}`); }
      }
      let extra = 0;
      for (const j of p.jumps || []) { extra += j.h; jumps.push(j); }
      prevPB = p.t + (m.bot - m.top) + extra; prevMB = m.bot;
    });
    // libellé des marqueurs de section (type de la section suivante)
    const LBL = { nextPage: 'page suivante', continuous: 'continu', evenPage: 'page paire', oddPage: 'page impaire' };
    units.forEach((u, i) => { if (M[i].kind === 'sect') rules.push(`${u.sel}::after{content:"Saut de section (${LBL[(secs[u.si + 1] || {}).type || 'nextPage'] || 'page suivante'})"}`); });
    // --- 4. Écritures ---
    for (let k = jumps.length - 1; k >= 0; k--) this._insertJump(jumps[k]);   // à rebours : offsets intacts
    this.pushStyle.textContent = hRules.concat(rules).join('\n');
    // séparateurs de colonnes
    for (const pg of pages) pg.seps = [];
    for (const r of regions) {
      if (!r.sep || r.cols.length < 2 || !r.units.length) continue;
      let y2 = r.top;
      for (const i of r.units) { const p = place[i]; y2 = Math.max(y2, p.t + (M[i].bot - M[i].top)); }
      const pg = pages[r.p], s = secs[r.si];
      for (let c = 1; c < r.cols.length; c++) {
        const x = s.ml + (r.cols[c - 1].x + r.cols[c - 1].w + r.cols[c].x) / 2;
        pg.seps.push({ x, y1: r.top - pg.y, y2: Math.min(y2, pg.y + pg.h - pg.mb) - pg.y });
      }
    }
    this.pages = pages;
    this._laidOut = true;
    const changedCount = pages.length !== this.pageCount;
    this.pageCount = pages.length;
    this.renderPages(false);
    if (changedCount) Array.from(this.pagesLayer.children).forEach((c, i) => this.updateFields(c, i));
    this.renderNotes();
    this.updateTocPages();
    this.layoutMs = performance.now() - t0;
    this.onLayout && this.onLayout();
  },

  /** Placement des unités : pages, colonnes, coupes à la ligne, solidarités */
  _place(units, M, secs, cols, W, er, z) {
    const pages = [], regions = [];
    const newPage = si => {
      const s = secs[si], prev = pages[pages.length - 1];
      pages.push({ y: prev ? prev.y + prev.h + GAP : 0, x: (W - s.w) / 2, w: s.w, h: s.h, mt: s.mt, mb: s.mb, ml: s.ml, mr: s.mr, mh: s.mh, mf: s.mf, si, seps: [] });
      return pages.length - 1;
    };
    const cTop = p => pages[p].y + pages[p].mt, cBot = p => pages[p].y + pages[p].h - pages[p].mb;
    const newRegion = (p, si, top) => { const r = { p, si, top, bot: cBot(p), cols: cols[si], sep: !!(secs[si].cols && secs[si].cols.sep), units: [] }; regions.push(r); return r; };
    const place = new Array(units.length);
    const keepNext = e => e.dataset.keepnext === '1' || (/^H[1-6]$/.test(e.tagName) && e.dataset.keepnext !== '0');
    const lineCache = new Map();
    const linesOf = i => { if (!lineCache.has(i)) lineCache.set(i, this._lines(units[i].el, er, z)); return lineCache.get(i); };

    let p = newPage(0), reg = newRegion(p, 0, cTop(p)), c = 0;
    let y = null;          // bas de la dernière unité de la colonne courante (null : haut de colonne)
    let prevBot = null;    // bas mesuré de l'unité précédente
    let force = null;      // 'page' | 'col' : saut imposé avant l'unité suivante
    let curSi = 0, guard = 0;
    const snaps = [];
    const goNextPage = si => { p = newPage(si); reg = newRegion(p, si, cTop(p)); c = 0; y = null; };
    const goNextCol = si => { if (c + 1 < reg.cols.length) { c++; y = null; } else goNextPage(si); };
    const balance = r => {
      // colonnes équilibrées en fin de section continue (comme Word)
      const U = r.units.filter(i => M[i].kind !== 'sect');
      if (r.cols.length < 2 || U.length < 2 || r.units.some(i => M[i].kind === 'cb')) return;
      const H = i => M[i].bot - M[i].top;
      const fits = lim => {
        let col = 0, yy = null, res = [];
        for (const i of r.units) {
          let t = yy === null ? r.top : yy + (M[i].top - prevOf(i));
          if (yy !== null && t + H(i) > r.top + lim + 0.5 && M[i].kind !== 'sect') { col++; t = r.top; }
          res.push([i, t, col]); yy = t + H(i);
        }
        return col < r.cols.length ? res : null;
      };
      const prevOf = i => (i > 0 ? M[i - 1].bot : M[i].top);
      let lo = Math.max(...U.map(H)), hi = r.bot - r.top;
      if (!fits(hi)) return;
      for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
      const res = fits(hi);
      let maxB = r.top;
      for (const [i, t, col] of res) { place[i] = { ...place[i], t, c: col }; maxB = Math.max(maxB, t + H(i)); }
      return maxB;
    };

    for (let i = 0; i < units.length; i++) {
      if (++guard > units.length * 6 + 100) break;   // sécurité
      const u = units[i], m = M[i], h = m.bot - m.top, e = u.el;
      snaps[i] = { p, c, y, prevBot, force, curSi, pages: pages.length, regs: regions.length, reg, regUnits: reg.units.length };
      // --- changement de section ---
      if (u.si !== curSi) {
        const s = secs[u.si], old = pages[p];
        const type = s.type || 'nextPage';
        const sameSize = Math.abs(s.w - old.w) < 1 && Math.abs(s.h - old.h) < 1;
        let endY = y === null ? reg.top : y;
        if (reg.cols.length > 1) { const b = balance(reg); if (b != null) endY = b; }
        if (type === 'continuous' && sameSize && force !== 'page') {
          const startY = (y === null && reg.units.length === 0) ? reg.top : endY + (m.top - prevBot);
          if (startY >= cBot(p) - 1) goNextPage(u.si);
          else { reg = newRegion(p, u.si, startY); c = 0; y = startY - (m.top - prevBot); if (reg.top <= cTop(p) + 0.5) y = null; }
        } else {
          goNextPage(u.si);
          const num = pages.length; // numéro (1-based) de la nouvelle page
          if ((type === 'evenPage' && num % 2 === 1) || (type === 'oddPage' && num % 2 === 0)) goNextPage(u.si);
        }
        force = null;
        curSi = u.si;
      }
      // --- sauts imposés ---
      if (force === 'page') { goNextPage(u.si); force = null; }
      else if (force === 'col') { goNextCol(u.si); force = null; }
      if (e.dataset && e.dataset.pbb === '1' && i > 0 && !(y === null && c === 0)) goNextPage(u.si);
      if (place[i] && place[i].moved && !(y === null && c === 0)) goNextPage(u.si);   // ramené par « paragraphes solidaires »

      const isBreak = m.kind === 'sect' || m.kind === 'pb' || m.kind === 'cb';
      const colTop = () => reg.top;
      let t = (i === 0) ? m.top : (y === null ? colTop() : y + (m.top - prevBot));
      if (i === 0 && y === null) t = Math.max(m.top, reg.top);
      let jumps = null;
      if (!isBreak) {
        let tries = 0;
        for (; ;) {
          if (++tries > 400) break;
          const bot = reg.bot, atTop = y === null;
          if (!atTop && t >= bot - 1) { goNextCol(u.si); t = colTop(); continue; }
          if (t + h <= bot + 1) break;           // tient dans la colonne
          // --- ne tient pas ---
          const single = reg.cols.length === 1;
          const keepL = e.dataset.keeplines === '1' && h <= (bot - colTop()) + 1;
          if (single && m.kind === 'blk' && !keepL) {
            const r = this._splitLines(linesOf(i), t - m.top, m, atTop, e.dataset.widow !== '0', () => { const before = pages.length; goNextPage(u.si); return { top: colTop(), bot: reg.bot, created: pages.length > before }; }, bot);
            if (r) { jumps = r; break; }
          } else if (single && m.kind === 'table') {
            const r = this._splitRows(e, er, z, t - m.top, atTop, () => { goNextPage(u.si); return { top: colTop(), bot: reg.bot }; }, bot);
            if (r) { jumps = r; break; }
          }
          if (atTop) break;                      // plus grand qu'une page : on le laisse dépasser
          // solidaire avec le suivant : on emmène les paragraphes « keepNext » précédents
          if (reg.cols.length === 1 && i > 0 && c === 0) {
            let j = i - 1;
            while (j >= 0 && place[j] && place[j].p === p && keepNext(units[j].el) && !['sect', 'pb', 'cb'].includes(M[j].kind) && units[j].si === u.si) j--;
            const s = j + 1;
            if (s < i && snaps[s] && !place[s].moved && place[s].t > cTop(p) + 2 && (M[i - 1].bot - M[s].top) + Math.min(h, 40) < (cBot(p) - cTop(p))) {
              // retour en arrière : la chaîne commence la page suivante
              const sn = snaps[s];
              pages.length = sn.pages; regions.length = sn.regs;
              ({ p, c, y, prevBot, force, curSi } = sn); reg = sn.reg; reg.units.length = sn.regUnits;
              for (let k = s; k < i; k++) place[k] = null;
              place[s] = { moved: true };
              i = s - 1;
              t = NaN;
              break;
            }
          }
          goNextCol(u.si); t = colTop();
        }
        if (Number.isNaN(t)) continue;
      }
      let extra = 0;
      if (jumps) for (const j of jumps) extra += j.h;
      place[i] = { t, c, p, jumps, moved: !!(place[i] && place[i].moved) };
      reg.units.push(i);
      y = t + h + extra; prevBot = m.bot;
      if (m.kind === 'pb') force = 'page';
      if (m.kind === 'cb') force = reg.cols.length > 1 ? 'col' : 'page';
    }
    // fin du document : saut final, section vide
    if (force === 'page') goNextPage(curSi);
    return { place, pages, regions };
  },

  /** Lignes d'un bloc (coordonnées mesurées) : [{top, bot, node, off, blk}] */
  _lines(el, er, z) {
    const Y = v => (v - er.top) / z;
    const frags = [];
    const BLK = /^(P|H[1-6]|LI|DIV|BLOCKQUOTE|PRE|TD|TH|UL|OL)$/;
    const blkOf = n => { let x = n.nodeType === 1 ? n : n.parentElement; while (x && x !== el && !BLK.test(x.tagName)) x = x.parentElement; return x || el; };
    const w = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        if (n.nodeType === 3) return NodeFilter.FILTER_ACCEPT;
        if (n.tagName === 'TABLE') return NodeFilter.FILTER_REJECT;
        if (n.tagName === 'IMG' || n.tagName === 'BR' || (n.isContentEditable === false && n.getAttribute('contenteditable') === 'false') || n.classList.contains('pl-island')) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    const rg = document.createRange();
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) {
        if (n.tagName === 'IMG' && getComputedStyle(n).float !== 'none') continue;
        const rs = Array.from(n.getClientRects()).filter(r => r.height > 0);
        if (!rs.length) continue;
        rs.forEach((r, k) => frags.push({ top: Y(r.top), bot: Y(r.bottom), node: k ? null : n, off: -1, blk: blkOf(n) }));
        // éléments non éditables : pas de descente dans le contenu
        if (n.firstChild) { let k = n; while (k.lastChild) k = k.lastChild; w.currentNode = k; }
        continue;
      }
      if (!n.data.length) continue;
      rg.selectNodeContents(n);
      const rs = Array.from(rg.getClientRects()).filter(r => r.height > 0);
      if (!rs.length) continue;
      const blk = blkOf(n);
      let lastTop = -1e9, lastBot = -1e9;
      for (const r of rs) {
        const top = Y(r.top), bot = Y(r.bottom);
        if (frags.length && (top + bot) / 2 <= lastBot && top >= lastTop - 0.5) { lastBot = Math.max(lastBot, bot); continue; }
        // début de ligne dans ce nœud : recherche dichotomique du premier caractère
        let off = 0;
        if (lastTop > -1e9) {
          let lo = 0, hi = n.data.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            rg.setStart(n, mid); rg.setEnd(n, mid + 1);
            const cr = Array.from(rg.getClientRects()).filter(q => q.height > 0);
            const ct = cr.length ? Y(cr[cr.length - 1].top) : lastTop;
            if (ct >= top - 1) hi = mid; else lo = mid + 1;
          }
          off = lo;
        }
        frags.push({ top, bot, node: n, off, blk });
        lastTop = top; lastBot = bot;
      }
    }
    // regroupement en lignes
    const lines = [];
    for (const f of frags) {
      const L = lines[lines.length - 1];
      if (L && L.blk === f.blk && (f.top + f.bot) / 2 <= L.bot + 0.5) { L.top = Math.min(L.top, f.top); L.bot = Math.max(L.bot, f.bot); continue; }
      lines.push({ top: f.top, bot: f.bot, node: f.node, off: f.off, blk: f.blk });
    }
    // limites des boîtes de ligne (interligne compris)
    const box = new Map();
    const contentBox = b => {
      if (!box.has(b)) { const r = b.getBoundingClientRect(), cs = getComputedStyle(b); box.set(b, { top: Y(r.top) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0), bot: Y(r.bottom) - (parseFloat(cs.borderBottomWidth) || 0) - (parseFloat(cs.paddingBottom) || 0) }); }
      return box.get(b);
    };
    lines.forEach((L, k) => {
      const prev = lines[k - 1], next = lines[k + 1];
      L.boxTop = !prev || prev.blk !== L.blk ? Math.min(L.top, contentBox(L.blk).top) : (prev.bot + L.top) / 2;
      L.boxBot = !next ? Math.max(L.bot, Math.min(contentBox(L.blk).bot, L.bot + (L.bot - L.top))) : next.blk !== L.blk ? Math.max(L.bot, Math.min(contentBox(L.blk).bot, next.top)) : (L.bot + next.top) / 2;
    });
    for (let k = 1; k < lines.length; k++) if (lines[k].blk !== lines[k - 1].blk && lines[k].boxTop < lines[k - 1].boxBot) lines[k].boxTop = lines[k - 1].boxBot;
    return lines;
  },

  /** Coupe un paragraphe à la ligne : renvoie [{node, off, h}] ou null (à déplacer en entier) */
  _splitLines(lines, off0, m, atTop, widow, nextPage, bot) {
    const L = lines.length;
    if (L < 2) return null;
    const out = [];
    let off = off0, start = 0, b = bot;
    const minL = widow ? 2 : 1;
    for (let guard = 0; guard < 500; guard++) {
      if (m.bot + off <= b + 1) return out;
      // nombre de lignes qui tiennent
      let k = start;
      while (k < L && lines[k].boxBot + off <= b + 1) k++;
      let fit = k - start;
      const rest = L - k;
      const first = out.length === 0;
      if (fit >= L - start) return out;                         // seul le bas (marges internes) dépasse
      if (rest < minL) fit -= (minL - rest);                    // veuve
      while (fit > 0 && !lines[start + fit].node) fit--;       // ligne sans point de coupe sûr
      if (fit < (first && !atTop ? minL : 1)) {
        if (first && !atTop) return null;                       // orpheline : paragraphe entier à la page suivante
        fit = Math.max(1, k - start);                           // en tête de page : coupe forcée
        while (fit < L - start && !lines[start + fit].node) fit++;
        if (fit >= L - start) return out;
      }
      const ln = lines[start + fit];
      const np = nextPage();
      const h = np.top - (ln.boxTop + off);
      if (h < 0) return out.length ? out : null;
      out.push({ node: ln.node, off: ln.off, h, kind: 'line' });
      off += h; start += fit; b = np.bot;
    }
    return out;
  },

  /** Coupe un tableau entre deux lignes : [{row, h, cols}] ou null */
  _splitRows(T, er, z, off0, atTop, nextPage, bot) {
    const rows = Array.from(T.rows).filter(r => !r.hasAttribute('data-pl-artifact'));
    if (rows.length < 2) return null;
    const Y = v => (v - er.top) / z;
    const R = rows.map(r => { const b = r.getBoundingClientRect(); return { top: Y(b.top), bot: Y(b.bottom) }; });
    // lignes interdites : traversées par une fusion verticale, ou en-têtes
    const blocked = new Set();
    rows.forEach((r, k) => { for (const c of r.cells) for (let s = 1; s < (c.rowSpan || 1); s++) blocked.add(k + s); });
    let nHead = 0; while (nHead < rows.length && rows[nHead].dataset.header) nHead++;
    let nCols = 1; for (const r of rows) { let n = 0; for (const c of r.cells) n += c.colSpan || 1; nCols = Math.max(nCols, n); }
    const out = [];
    let off = off0, start = 0, b = bot;
    for (let guard = 0; guard < 500; guard++) {
      if (R[R.length - 1].bot + off <= b + 1) return out.length ? out : null;
      let k = start;
      while (k < R.length && R[k].bot + off <= b + 1) k++;
      while (k > start && (blocked.has(k) || k <= nHead - 1)) k--;
      if (k <= start || (out.length === 0 && k <= nHead)) {
        if (out.length === 0 && !atTop) return null;
        k = start + 1; while (k < R.length && blocked.has(k)) k++;
        if (k >= R.length) return out.length ? out : null;
      }
      const np = nextPage();
      const h = np.top - (R[k].top + off);
      if (h < 0) return out.length ? out : null;
      out.push({ row: rows[k], h, cols: nCols, kind: 'row' });
      off += h; start = k; b = np.bot;
    }
    return out;
  },

  /** Insère un artefact de saut (ligne de paragraphe ou rangée de tableau) */
  _insertJump(j) {
    if (j.kind === 'row') {
      const tr = document.createElement('tr');
      tr.className = 'pl-pgjump'; tr.setAttribute('data-pl-artifact', ''); tr.setAttribute('contenteditable', 'false');
      const td = document.createElement('td');
      td.colSpan = j.cols; td.style.cssText = `height:${j.h.toFixed(2)}px;padding:0;border:0;background:transparent`;
      tr.append(td);
      j.row.before(tr);
      return;
    }
    const sp = document.createElement('span');
    sp.className = 'pl-pgjump'; sp.setAttribute('contenteditable', 'false'); sp.setAttribute('data-pl-artifact', '');
    sp.style.height = j.h.toFixed(2) + 'px';
    let n = j.node;
    if (!n.isConnected) return;
    if (n.nodeType === 3 && j.off > 0) { if (j.off >= n.length) return; n = n.splitText(j.off); }
    n.parentNode.insertBefore(sp, n);
  },

  /** Marge haute à poser pour déplacer un bloc de delta (fusion des marges comprise) */
  _marginFor(e, delta, top, er, z) {
    const cs = getComputedStyle(e);
    const own = parseFloat(cs.marginTop) || 0;
    // marges adjacentes (sœur précédente, parents dont e est le premier enfant)
    let pos = 0, n = e, prevBottom = null;
    for (; ;) {
      let prev = n.previousElementSibling;
      while (prev && (prev.tagName === 'STYLE' || getComputedStyle(prev).display === 'none' || getComputedStyle(prev).position === 'absolute')) prev = prev.previousElementSibling;
      if (prev) { pos = Math.max(pos, parseFloat(getComputedStyle(prev).marginBottom) || 0); prevBottom = (prev.getBoundingClientRect().bottom - er.top) / z; break; }
      const par = n.parentElement;
      if (!par || par === this.editor) { const ecs = getComputedStyle(this.editor); prevBottom = parseFloat(ecs.paddingTop) || 0; break; }
      const pcs = getComputedStyle(par);
      if ((parseFloat(pcs.paddingTop) || 0) > 0 || (parseFloat(pcs.borderTopWidth) || 0) > 0 || pcs.display === 'flow-root' || pcs.overflow !== 'visible') { prevBottom = (par.getBoundingClientRect().top - er.top) / z + (parseFloat(pcs.borderTopWidth) || 0) + (parseFloat(pcs.paddingTop) || 0); break; }
      pos = Math.max(pos, parseFloat(pcs.marginTop) || 0);
      n = par;
    }
    const g0 = top - prevBottom;
    const g1 = g0 + delta;
    return g1 >= pos ? g1 : g1 - pos;
  },

  /** Page (0-based) d'une ordonnée de la feuille */
  pageOfY(y) {
    const pg = this.pages || this.defaultPages();
    let lo = 0, hi = pg.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pg[mid].y - GAP / 2 <= y) lo = mid; else hi = mid - 1; }
    return lo;
  },
  yInSheet(node) {
    const r = (node.nodeType === 1 ? node : node.parentElement).getBoundingClientRect();
    const s = this.sheet.getBoundingClientRect();
    return (r.top - s.top) / this.zoom;
  },
  caretPage() {
    const r = this.lastRange;
    if (!r) return 0;
    let rect = r.getClientRects()[0] || (r.startContainer.nodeType === 1 ? r.startContainer.getBoundingClientRect() : r.startContainer.parentElement.getBoundingClientRect());
    const s = this.sheet.getBoundingClientRect();
    return this.pageOfY((rect.top - s.top) / this.zoom);
  },
  /** Géométrie de la page du curseur (règle, insertion) */
  caretGeom() {
    const pg = (this.pages || this.defaultPages())[this.caretPage()] || this.defaultPages()[0];
    const s = this.curSect();
    const c = this.colsOf(s);
    return { x: pg.x, w: pg.w, ml: s.ml, mr: s.mr, cols: c };
  },

  /** Notes de bas de page : numérotation + affichage en bas de chaque page */
  renderNotes() {
    const fns = $$('.pl-fn', this.editor);
    const per = {};
    fns.forEach((f, i) => {
      const n = String(i + 1);
      if (f.textContent !== n) f.textContent = n;
      const p = this.pageOfY(this.yInSheet(f));
      (per[p] = per[p] || []).push({ n, f });
    });
    const pgs = this.pages || this.defaultPages();
    Array.from(this.pagesLayer.children).forEach((card, i) => {
      const box = card.querySelector('.pnotes');
      const list = per[i] || [];
      const pg = pgs[i] || pgs[0];
      Object.assign(box.style, { left: pg.ml + 'px', right: pg.mr + 'px', top: (pg.h - pg.mb + 4) + 'px', fontSize: '9pt', fontFamily: 'var(--doc-font)', zIndex: 3, color: '#222', lineHeight: 1.25 });
      box.innerHTML = '';
      if (!list.length) return;
      box.append(el('div', { style: 'width:4cm;border-top:1px solid #555;margin-bottom:3px' }));
      for (const { n, f } of list) {
        box.append(el('div', { style: 'cursor:pointer', title: 'Cliquer pour modifier la note', onclick: () => this.editFootnote(f) }, [el('sup', {}, [n]), ' ', f.dataset.note || '']));
      }
    });
  },

  updateTocPages() {
    for (const toc of $$('.pl-toc', this.editor)) {
      for (const line of $$('.toc-line', toc)) {
        const h = document.getElementById(line.dataset.target);
        const pg = line.querySelector('.pg');
        if (h && pg) { const v = String(this.pageOfY(this.yInSheet(h)) + 1); if (pg.textContent !== v) pg.textContent = v; }
      }
    }
  },

  /* =====================================================================
     Historique (annuler / rétablir) par instantanés
     ===================================================================== */
  history: [], hIndex: -1,
  snapshot() {
    return { html: this.cleanHTML(), header: this.headerHTML, footer: this.footerHTML, sel: this.saveSel() };
  },
  commit() {
    clearTimeout(this._typingTimer); this._typingTimer = null;
    const s = this.snapshot();
    const cur = this.history[this.hIndex];
    if (cur && cur.html === s.html && cur.header === s.header && cur.footer === s.footer) { cur.sel = s.sel; return; }
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push(s);
    if (this.history.length > 300) this.history.shift();
    this.hIndex = this.history.length - 1;
    this.onHistory && this.onHistory();
  },
  changed(typing) {
    if (typing) {
      clearTimeout(this._typingTimer);
      this._typingTimer = setTimeout(() => this.commit(), 450);
    } else this.commit();
    this.relayout();
    this.onChange && this.onChange();
  },
  undo() {
    if (this._typingTimer) this.commit();
    if (this.hIndex <= 0) return;
    this.hIndex--; this.applySnap(this.history[this.hIndex]);
  },
  redo() {
    if (this.hIndex >= this.history.length - 1) return;
    this.hIndex++; this.applySnap(this.history[this.hIndex]);
  },
  applySnap(s) {
    this.editor.innerHTML = s.html;
    this.headerHTML = s.header; this.footerHTML = s.footer;
    Array.from(this.pagesLayer.children).forEach((c, i) => this.fillHF(c, i));
    this.restoreSel(s.sel);
    this.relayout();
    this.onChange && this.onChange();
    this.onHistory && this.onHistory();
  },
  canUndo() { return this.hIndex > 0 || !!this._typingTimer; },
  canRedo() { return this.hIndex < this.history.length - 1; },

  /* ---------- Sélection : chemins de nœuds ---------- */
  range() { const s = getSelection(); return s.rangeCount ? s.getRangeAt(0) : null; },
  /** Chemin « propre » d'un nœud : sans artefacts, nœuds texte adjacents fusionnés (comme après innerHTML) */
  pathOf(node) {
    const p = [];
    while (node && node !== this.editor) {
      const par = node.parentNode;
      if (!par) return null;
      p.unshift(this._cleanCount(par, node, Infinity));
      node = par;
    }
    return node === this.editor ? p : null;
  },
  /** Index propre de « node » dans par (ou nombre d'enfants propres avant la position lim) */
  _cleanCount(par, node, lim) {
    let i = -1, prevText = false, j = 0;
    for (const c of par.childNodes) {
      if (j++ >= lim) break;
      const skip = (c.nodeType === 1 && c.hasAttribute('data-pl-artifact')) || (c.nodeType === 3 && !c.length);
      if (!skip) { const t = c.nodeType === 3; if (!(t && prevText)) i++; prevText = t; }
      if (c === node) return Math.max(0, i);
    }
    return node ? Math.max(0, i) : i + 1;
  },
  _cleanPoint(n, o) {
    if (n.nodeType === 3) {
      for (let x = n.previousSibling; x && ((x.nodeType === 1 && x.hasAttribute('data-pl-artifact')) || x.nodeType === 3); x = x.previousSibling) if (x.nodeType === 3) o += x.length;
      return [this.pathOf(n), o];
    }
    return [this.pathOf(n), this._cleanCount(n, null, o)];
  },
  nodeAt(path) {
    let n = this.editor;
    for (const i of path) { if (!n.childNodes[i]) return null; n = n.childNodes[i]; }
    return n;
  },
  saveSel() {
    const r = this.lastRange;
    if (!r || !this.editor.contains(r.startContainer)) return null;
    const [a, ao] = this._cleanPoint(r.startContainer, r.startOffset), [b, bo] = this._cleanPoint(r.endContainer, r.endOffset);
    return a && b ? { a, ao, b, bo } : null;
  },
  restoreSel(s) {
    if (!s) return;
    const a = this.nodeAt(s.a), b = this.nodeAt(s.b);
    if (!a || !b) return;
    try {
      const r = document.createRange();
      r.setStart(a, Math.min(s.ao, a.nodeType === 3 ? a.length : a.childNodes.length));
      r.setEnd(b, Math.min(s.bo, b.nodeType === 3 ? b.length : b.childNodes.length));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      this.lastRange = r;
    } catch { /* ignore */ }
  },
  /** Remet la sélection mémorisée (après un clic dans le ruban) */
  /** Met à jour lastRange avec la sélection réelle si elle est dans le document */
  syncSel() {
    const cur = this.range();
    if (cur && (this.editor.contains(cur.commonAncestorContainer) || this.inHF(cur.commonAncestorContainer))) this.lastRange = cur.cloneRange();
  },
  focus() {
    this.syncSel();
    const r = this.lastRange;
    const target = r && this.inHF(r.commonAncestorContainer) ? (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest('.hf') : this.editor;
    if (document.activeElement !== target) target.focus({ preventScroll: true });
    if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  },
  /** Conteneur éditable actif (corps ou en-tête/pied) */
  activeRoot() {
    const r = this.lastRange;
    if (r && this.inHF(r.commonAncestorContainer)) return (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest('.hf');
    return this.editor;
  },

  /* =====================================================================
     Commandes de mise en forme
     ===================================================================== */
  exec(cmd, val = null) {
    this.focus();
    // suivi des modifications : l'ancienne mise en forme est mémorisée (w:rPrChange)
    const tracked = typeof Track !== 'undefined' && Track.on && /^(bold|italic|underline|strikeThrough)$/.test(cmd) ? Track.beforeFormat() : null;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
    if (tracked) Track.afterFormat(tracked);
    this.afterCmd();
  },
  afterCmd() {
    const r = this.range(); if (r) this.lastRange = r.cloneRange();
    if (this.inHF(this.lastRange && this.lastRange.commonAncestorContainer)) { const h = this.activeRoot(); this.onHFInput(h); }
    this.changed(false);
    this.onSelection && this.onSelection();
  },
  /** Applique une taille en points à la sélection */
  fontSize(pt) {
    pt = Math.max(1, Math.min(1638, parseFloat(pt) || 11));
    this.focus();
    const r = this.range();
    if (!r) return;
    if (r.collapsed) { this.wrapCaret({ fontSize: pt + 'pt' }); return; }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    const root = this.activeRoot();
    $$('font[size="7"]', root).forEach(f => { const s = el('span', { style: `font-size:${pt}pt` }); s.append(...f.childNodes); f.replaceWith(s); });
    $$('[style*="xxx-large"]', root).forEach(s => { s.style.fontSize = pt + 'pt'; });
    this.cleanupSpans(root);
    this.afterCmd();
  },
  fontName(stack) {
    this.focus();
    const r = this.range();
    if (r && r.collapsed) { this.wrapCaret({ fontFamily: stack }); return; }
    this.exec('fontName', stack);
  },
  /** Curseur sans sélection : prépare un span vide pour la saisie suivante */
  wrapCaret(style) {
    const r = this.range();
    const s = el('span', { style });
    s.append(document.createTextNode('​'));
    r.insertNode(s);
    const nr = document.createRange();
    nr.setStart(s.firstChild, 1); nr.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(nr);
    this.lastRange = nr;
    const clean = () => { if (s.firstChild && s.firstChild.nodeType === 3 && s.textContent.length > 1) s.firstChild.textContent = s.firstChild.textContent.replace('​', ''); this.editor.removeEventListener('input', clean); };
    this.editor.addEventListener('input', clean);
    this.onSelection && this.onSelection();
  },
  cleanupSpans(root = this.editor) {
    $$('span[style=""], span:not([style]):not([class]):not([id])', root).forEach(s => s.replaceWith(...s.childNodes));
  },
  growFont(dir) {
    const steps = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
    const cur = this.currentFontPt();
    let next = dir > 0 ? steps.find(s => s > cur + 0.01) || cur + 10 : [...steps].reverse().find(s => s < cur - 0.01) || Math.max(1, cur - 1);
    this.fontSize(next);
  },
  currentFontPt() {
    const n = this.anchorEl();
    return n ? Math.round(parseFloat(getComputedStyle(n).fontSize) * 0.75 * 2) / 2 : 11;
  },
  anchorEl() {
    const r = this.lastRange;
    if (!r) return null;
    let n = r.startContainer;
    if (n.nodeType === 1 && n.childNodes[r.startOffset] && n.childNodes[r.startOffset].nodeType === 1 && !r.collapsed) n = n.childNodes[r.startOffset];
    return n.nodeType === 1 ? n : n.parentElement;
  },

  /** Blocs (paragraphes, titres, éléments de liste) touchés par la sélection */
  selectedBlocks() {
    if (document.activeElement === this.editor || (document.activeElement && document.activeElement.classList.contains('hf'))) this.syncSel();
    const r = this.lastRange;
    const root = this.activeRoot();
    if (!r) return [];
    const isB = n => n.nodeType === 1 && /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV)$/.test(n.tagName) && n !== root && !n.classList.contains('hf') && !n.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div:not(.pl-anchor)');
    const blockOf = n => { n = n.nodeType === 1 ? n : n.parentElement; while (n && n !== root && !isB(n)) n = n.parentElement; return n && n !== root ? n : null; };
    const out = [];
    const a = blockOf(r.startContainer.nodeType === 1 && r.startContainer.childNodes[r.startOffset] ? r.startContainer.childNodes[r.startOffset] : r.startContainer);
    if (r.collapsed) return a ? [a] : [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: n => isB(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
    let n;
    while ((n = w.nextNode())) if (r.intersectsNode(n)) out.push(n);
    if (!out.length && a) out.push(a);
    return out;
  },
  /** Applique un style CSS aux blocs sélectionnés */
  blockStyle(fn) {
    this.focus();
    const bl = this.selectedBlocks();
    if (!bl.length) {
      // texte directement dans la racine : on crée un paragraphe
      document.execCommand('formatBlock', false, 'p');
      bl.push(...this.selectedBlocks());
    }
    bl.forEach(fn);
    this.afterCmd();
  },
  align(a) {
    this.blockStyle(b => { b.style.textAlign = a === 'left' ? '' : a; if (!b.getAttribute('style')) b.removeAttribute('style'); });
  },
  lineSpacing(v) { this.blockStyle(b => { b.style.lineHeight = v; }); },
  paraSpace(which, pt) { this.blockStyle(b => { b.style[which === 'before' ? 'marginTop' : 'marginBottom'] = pt == null ? '' : pt + 'pt'; }); },
  indent(dir) {
    const bl = this.selectedBlocks();
    if (bl.some(b => b.tagName === 'LI')) { this.exec(dir > 0 ? 'indent' : 'outdent'); return; }
    this.blockStyle(b => {
      const cur = U.cssToPx(b.style.marginLeft) || 0;
      const step = U.cmToPx(1.25);
      const v = Math.max(0, cur + dir * step);
      b.style.marginLeft = v ? U.pxToPt(v).toFixed(1) + 'pt' : '';
    });
  },
  setStyle(tag, cls = '') {
    this.focus();
    const bl = this.selectedBlocks();
    const inList = bl.length && bl.every(b => b.tagName === 'LI');
    if (inList && tag === 'p') { this.afterCmd(); return; }
    document.execCommand('formatBlock', false, tag);
    for (const b of this.selectedBlocks()) {
      if (b.tagName.toLowerCase() !== tag) continue;
      b.classList.remove('title', 'subtitle');
      if (cls) b.classList.add(cls);
      if (!b.className) b.removeAttribute('class');
      // un style de titre remplace la mise en forme de bloc importée
      if (tag !== 'p') ['fontSize', 'color', 'fontFamily', 'fontWeight', 'fontStyle', 'marginTop', 'marginBottom', 'lineHeight'].forEach(k => b.style[k] = '');
      if (b.getAttribute('style') === '') b.removeAttribute('style');
    }
    this.afterCmd();
  },
  currentStyleKey() {
    const b = this.selectedBlocks()[0];
    if (!b) return 'p';
    const t = b.tagName.toLowerCase();
    if (t === 'h1' && b.classList.contains('title')) return 'h1.title';
    if (t === 'p' && b.classList.contains('subtitle')) return 'p.subtitle';
    return t === 'li' ? 'p' : t;
  },
  list(type, styleType) {
    const bl = this.selectedBlocks();
    const cur = bl[0] && bl[0].closest('ul,ol');
    const want = type === 'ol' ? 'insertOrderedList' : 'insertUnorderedList';
    if (cur && cur.tagName.toLowerCase() === type && styleType) {
      cur.style.listStyleType = ['disc', 'decimal'].includes(styleType) ? '' : styleType;
      if (!cur.getAttribute('style')) cur.removeAttribute('style');
      this.afterCmd(); return;
    }
    this.exec(want);
    if (styleType) {
      const b = this.selectedBlocks()[0];
      const L = b && b.closest('ul,ol');
      if (L) { L.style.listStyleType = ['disc', 'decimal'].includes(styleType) ? '' : styleType; if (!L.getAttribute('style')) L.removeAttribute('style'); this.changed(false); }
    }
  },
  clearFormatting() {
    this.focus();
    document.execCommand('removeFormat');
    const r = this.range();
    if (r && !r.collapsed) {
      // retire aussi les styles de caractère des spans entièrement sélectionnés
      $$('span[style]', this.activeRoot()).forEach(s => {
        if (r.intersectsNode(s)) ['fontFamily', 'fontSize', 'color', 'backgroundColor', 'fontWeight', 'fontStyle', 'textDecoration', 'letterSpacing', 'textTransform', 'fontVariant'].forEach(k => s.style[k] = '');
      });
      this.cleanupSpans(this.activeRoot());
    }
    this.afterCmd();
  },
  changeCase(mode) {
    this.focus();
    const r = this.range();
    if (!r || r.collapsed) return;
    const nodes = [];
    const w = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    let n; while ((n = w.nextNode())) if (r.intersectsNode(n)) nodes.push(n);
    let sentenceStart = true;
    for (const t of nodes) {
      const s = t === r.startContainer ? r.startOffset : 0;
      const e = t === r.endContainer ? r.endOffset : t.length;
      const part = t.data.slice(s, e);
      let res = part;
      if (mode === 'lower') res = part.toLocaleLowerCase('fr');
      else if (mode === 'upper') res = part.toLocaleUpperCase('fr');
      else if (mode === 'title') res = part.toLocaleLowerCase('fr').replace(/(^|[\s\-'’(«])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('fr'));
      else if (mode === 'sentence') {
        res = ''; for (const ch of part.toLocaleLowerCase('fr')) {
          if (sentenceStart && /\p{L}/u.test(ch)) { res += ch.toLocaleUpperCase('fr'); sentenceStart = false; } else res += ch;
          if (/[.!?]/.test(ch)) sentenceStart = true;
        }
      } else if (mode === 'toggle') res = [...part].map(c => c === c.toLocaleUpperCase('fr') ? c.toLocaleLowerCase('fr') : c.toLocaleUpperCase('fr')).join('');
      t.data = t.data.slice(0, s) + res + t.data.slice(e);
    }
    try { r.setStart(nodes[0], r.startOffset); } catch { }
    this.afterCmd();
  },

  /* ---------- Insertion ---------- */
  insertHTML(html) { this.exec('insertHTML', html); },
  insertText(t) { this.exec('insertText', t); },
  pageBreak() {
    this.focus();
    document.execCommand('insertHTML', false, '<hr class="pl-pagebreak" contenteditable="false"><p><br></p>');
    this.afterCmd();
  },
  columnBreak() {
    this.focus();
    document.execCommand('insertHTML', false, '<hr class="pl-colbreak" contenteditable="false"><p><br></p>');
    this.afterCmd();
  },
  /** Saut de section au curseur : type = 'nextPage' | 'continuous' | 'evenPage' | 'oddPage' */
  sectionBreak(type = 'nextPage') {
    this.focus();
    const i = this.curSectIndex();
    const data = JSON.parse(JSON.stringify(this.sections()[i]));
    delete data.first;
    const id = 'sb' + uid();
    document.execCommand('insertHTML', false, `<hr class="pl-section" contenteditable="false" data-new="${id}" data-sect="${htmlEsc(JSON.stringify(data))}"><p><br></p>`);
    const hr = this.editor.querySelector(`hr[data-new="${id}"]`);
    if (hr) {
      hr.removeAttribute('data-new');
      // un marqueur de section est toujours au premier niveau
      if (hr.parentElement !== this.editor) { let t = hr; while (t.parentElement !== this.editor) t = t.parentElement; t.after(hr); if (!hr.nextElementSibling) hr.after(el('p', { html: '<br>' })); }
      this.updateSect(this.sectIndexOf(hr) + 1, s => { s.type = type; });
    }
    this.afterCmd();
  },
  /** Colonnes de la section du curseur : '1' | '2' | '3' | 'left' | 'right' */
  setColumns(kind) {
    const i = this.curSectIndex();
    this.updateSect(i, s => {
      const sp = U.cmToPx(1.25), cw = s.w - s.ml - s.mr, sep = !!(s.cols && s.cols.sep);
      if (kind === '1') s.cols = { n: 1 };
      else if (kind === '2' || kind === '3') s.cols = { n: +kind, space: sp, eq: true, sep };
      else {
        const a = (cw - sp) / 3, b = cw - sp - a;
        s.cols = { n: 2, space: sp, eq: false, sep, list: kind === 'left' ? [{ w: a, space: sp }, { w: b }] : [{ w: b, space: sp }, { w: a }] };
      }
    });
    this.changed(false);
  },
  toggleColSep() { this.updateSect(this.curSectIndex(), s => { s.cols = Object.assign({ n: 1 }, s.cols, { sep: !(s.cols && s.cols.sep) }); }); this.changed(false); },
  contentWidth() { const s = this.curSect(); return this.colsOf(s)[0].w; },
  insertTable(rows, cols) {
    const w = Math.floor(this.contentWidth() / cols);
    let h = `<table data-borders="all" style="width:${w * cols}px"><colgroup>${`<col style="width:${w}px">`.repeat(cols)}</colgroup><tbody>`;
    for (let r = 0; r < rows; r++) h += '<tr>' + '<td><p><br></p></td>'.repeat(cols) + '</tr>';
    h += '</tbody></table><p><br></p>';
    const id = 'tbl' + uid();
    this.insertHTML(h.replace('<table ', `<table data-new="${id}" `));
    // curseur dans la première cellule, comme dans les traitements de texte habituels
    const t = this.editor.querySelector(`table[data-new="${id}"]`);
    if (t) {
      t.removeAttribute('data-new');
      const r = document.createRange(); r.selectNodeContents(t.querySelector('td p') || t.querySelector('td')); r.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); this.lastRange = r;
      this.commit();
    }
  },
  async insertImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = this.registerImage(file);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { });
    const max = this.contentWidth();
    const w = Math.min(img.naturalWidth || 300, max);
    const h = Math.round(w * (img.naturalHeight || 200) / (img.naturalWidth || 300));
    this.insertHTML(`<img src="${url}" alt="${htmlEsc(file.name.replace(/\.[^.]+$/, ''))}" style="width:${w}px;height:${h}px">`);
  },
  insertField(kind) {
    this.focus();
    document.execCommand('insertHTML', false, `<span class="pl-field" contenteditable="false" data-field="${kind}">1</span>&#8203;`);
    this.afterCmd();
    this.relayout();
  },
  /** Élément Office conservé : explication + suppression possible */
  async islandInfo(isl) {
    const names = { chart: 'Graphique', smartart: 'SmartArt', textbox: 'Zone de texte', float: 'Image flottante', image: 'Image', ole: 'Objet incorporé', shape: 'Forme', math: 'Équation' };
    const name = names[isl.dataset.kind] || 'Élément Office';
    const r = await dialog({
      title: name, body: `<p style="line-height:1.5">Cet élément vient du document Word d’origine. Plume l’affiche en aperçu et le <b>réenregistre à l’identique</b> dans le fichier .docx : il restera modifiable dans Word.</p><p style="color:var(--ui-fg-2)">Vous pouvez le déplacer en coupant/collant le paragraphe qui le contient, ou le supprimer.</p>`,
      buttons: [{ label: 'Supprimer l’élément', value: 'del' }, { label: 'Fermer', primary: true, value: null }]
    });
    if (r === 'del') { isl.remove(); this.changed(false); }
  },
  async editFootnote(span) {
    const ta = el('textarea', { rows: 4, style: 'width:100%' });
    ta.value = span.dataset.note || '';
    const title = span.dataset.noteKind === 'endnote' ? 'Note de fin' : 'Note de bas de page';
    const r = await dialog({ title, body: ta, buttons: [{ label: 'Supprimer la note', value: 'del' }, { label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r === 'ok') { span.dataset.note = ta.value; this.changed(false); }
    if (r === 'del') { span.remove(); this.changed(false); }
  },
  async insertFootnote() {
    const ta = el('textarea', { rows: 4, style: 'width:100%', placeholder: 'Texte de la note' });
    const r = await dialog({ title: 'Insérer une note de bas de page', body: ta, buttons: [{ label: 'Annuler', value: null }, { label: 'Insérer', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    this.focus();
    document.execCommand('insertHTML', false, `<span class="pl-fn" contenteditable="false" data-note="${htmlEsc(ta.value)}">*</span>&#8203;`);
    this.afterCmd();
  },
  /** Table des matières à partir des titres */
  buildToc() {
    const hs = $$('h1:not(.title),h2,h3', this.editor).filter(h => !h.closest('.pl-toc') && h.textContent.trim());
    hs.forEach((h, i) => { if (!h.id) h.id = '_Toc' + uid(); });
    const lines = hs.map(h => `<div class="toc-line toc-l${h.tagName[1]}" data-target="${h.id}"><span class="txt">${htmlEsc(h.textContent.trim())}</span><span class="dots"></span><span class="pg">1</span></div>`).join('');
    return `<div class="pl-toc" contenteditable="false"><button class="toc-upd" type="button">⟳ Mettre à jour la table</button><div class="toc-title">Table des matières</div>${lines || '<div class="toc-line"><span class="txt">Aucun titre : utilisez les styles Titre 1, 2 ou 3.</span></div>'}</div>`;
  },
  insertToc() {
    const existing = $('.pl-toc', this.editor);
    if (existing) { existing.outerHTML = this.buildToc(); this.changed(false); toast('Table des matières <b>mise à jour</b>'); return; }
    this.insertHTML(this.buildToc() + '<p><br></p>');
  },

  /* ---------- Tableaux ---------- */
  cellCtx() {
    const r = this.lastRange;
    if (!r) return null;
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const td = n.closest('td,th');
    if (!td || !this.editor.contains(td)) return null;
    const tr = td.parentElement, table = td.closest('table');
    return { td, tr, table, ci: Array.from(tr.cells).indexOf(td), ri: Array.from(table.rows).indexOf(tr) };
  },
  tableOp(op) {
    const c = this.cellCtx();
    if (!c) return;
    const { td, tr, table, ci } = c;
    const newCell = () => el('td', { html: '<p><br></p>' });
    switch (op) {
      case 'rowAbove': case 'rowBelow': {
        const nr = el('tr');
        let cols = 0; for (const cell of tr.cells) cols += cell.colSpan || 1;
        for (let i = 0; i < cols; i++) nr.append(newCell());
        op === 'rowAbove' ? tr.before(nr) : tr.after(nr);
        break;
      }
      case 'colLeft': case 'colRight': {
        for (const row of table.rows) {
          const ref = row.cells[Math.min(ci, row.cells.length - 1)];
          if (!ref) { row.append(newCell()); continue; }
          op === 'colLeft' ? ref.before(newCell()) : ref.after(newCell());
        }
        this.redistribute(table);
        break;
      }
      case 'delRow': tr.remove(); if (!table.rows.length) table.remove(); break;
      case 'delCol':
        for (const row of Array.from(table.rows)) { const cell = row.cells[Math.min(ci, row.cells.length - 1)]; if (cell) cell.remove(); if (!row.cells.length) row.remove(); }
        if (!table.rows.length) table.remove(); else this.redistribute(table);
        break;
      case 'delTable': table.remove(); break;
      case 'mergeRight': {
        const next = tr.cells[ci + 1];
        if (next) { td.colSpan = (td.colSpan || 1) + (next.colSpan || 1); td.append(...next.childNodes); next.remove(); }
        break;
      }
      case 'split': {
        if ((td.colSpan || 1) > 1) { const n = td.colSpan; td.colSpan = 1; for (let i = 1; i < n; i++) td.after(newCell()); }
        break;
      }
      case 'borders': table.dataset.borders = table.dataset.borders === 'none' ? (table.dataset.tblstyle ? 'style' : 'all') : 'none'; delete table.dataset.tbdr; break;
      case 'header': tr.dataset.header ? delete tr.dataset.header : (tr.dataset.header = '1'); break;
      case 'distribute': this.redistribute(table, true); break;
      case 'vtop': case 'vmiddle': case 'vbottom': td.style.verticalAlign = op.slice(1) === 'top' ? '' : op.slice(1); break;
    }
    if (table.isConnected) TableStyles.apply(table);   // bandes, ligne des totaux… suivent la nouvelle structure
    this.changed(false);
    this.onSelection && this.onSelection();
  },
  redistribute(table) {
    let cols = 0; for (const cell of table.rows[0].cells) cols += cell.colSpan || 1;
    const total = Math.min(this.contentWidth(), table.getBoundingClientRect().width / this.zoom || this.contentWidth());
    const w = Math.floor(total / cols);
    let cg = table.querySelector('colgroup');
    if (!cg) { cg = el('colgroup'); table.prepend(cg); }
    cg.innerHTML = `<col style="width:${w}px">`.repeat(cols);
    table.style.width = w * cols + 'px';
  },
  /** Applique un style de tableau de la galerie ('' : aucun style) */
  setTableStyle(id) {
    const c = this.cellCtx();
    if (!c) return;
    const T = c.table;
    if (id) {
      T.dataset.tblstyle = id;
      if (T.dataset.look == null) T.dataset.look = TableStyles.DEFAULT_LOOK;
      T.dataset.borders = 'style';
      delete T.dataset.tbdr;
    } else {
      delete T.dataset.tblstyle;
      T.dataset.borders = 'all';
      delete T.dataset.tbdr;
    }
    TableStyles.apply(T);
    this.changed(false);
    this.onSelection && this.onSelection();
  },
  /** Coche / décoche une option de style (ligne d'en-tête, bandes…) */
  setTableLook(key, on) {
    const c = this.cellCtx();
    if (!c) return;
    const T = c.table;
    const look = TableStyles.parseLook(T.dataset.look);
    look[key] = on === undefined ? !look[key] : !!on;
    T.dataset.look = TableStyles.lookString(look);
    TableStyles.apply(T);
    this.changed(false);
    this.onSelection && this.onSelection();
  },
  cellShade(color) {
    const c = this.cellCtx();
    if (!c) return;
    c.td.style.backgroundColor = color || '';
    this.changed(false);
  },

  /* ---------- Images : sélection et redimensionnement ---------- */
  initImageHandle() {
    const hd = $('#imgHandle');
    let img = null, start = null;
    this.selectImage = (i) => {
      $$('img.sel-img', this.editor).forEach(x => x.classList.remove('sel-img'));
      img = i;
      if (!i) { hd.style.display = 'none'; return; }
      i.classList.add('sel-img');
      this.placeHandle();
    };
    this.placeHandle = () => {
      if (!img || !img.isConnected) { hd.style.display = 'none'; return; }
      const r = img.getBoundingClientRect(), s = this.sheet.getBoundingClientRect();
      Object.assign(hd.style, { display: 'block', left: ((r.right - s.left) / this.zoom - 6) + 'px', top: ((r.bottom - s.top) / this.zoom - 6) + 'px' });
    };
    hd.addEventListener('pointerdown', e => {
      if (!img) return;
      e.preventDefault(); hd.setPointerCapture(e.pointerId);
      start = { x: e.clientX, w: img.offsetWidth, ratio: img.offsetHeight / img.offsetWidth };
    });
    hd.addEventListener('pointermove', e => {
      if (!start) return;
      const w = Math.max(16, Math.min(this.contentWidth(), start.w + (e.clientX - start.x) / this.zoom));
      img.style.width = Math.round(w) + 'px';
      img.style.height = Math.round(w * start.ratio) + 'px';
      this.placeHandle();
    });
    hd.addEventListener('pointerup', () => { if (start) { start = null; this.changed(false); } });
    this.editor.addEventListener('keydown', () => this.selectImage(null));
  },

  onClick(e) {
    if (e.target.tagName === 'IMG') { this.selectImage(e.target); const r = document.createRange(); r.selectNode(e.target); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.lastRange = r; }
    else this.selectImage(null);
    const isl = e.target.closest('.pl-island');
    if (isl) { if (typeof Ilots !== 'undefined') Ilots.click(isl, e); else this.islandInfo(isl); return; }
    const cref = e.target.closest('.pl-cref');
    if (cref) { App.openNav('comments'); Comments.goto(cref.dataset.cid); return; }
    const fn = e.target.closest('.pl-fn');
    if (fn) this.editFootnote(fn);
    if (e.target.classList.contains('toc-upd')) { e.preventDefault(); this.insertToc(); }
    const a = e.target.closest('a[href]');
    if (a && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const h = a.getAttribute('href');
      if (h.startsWith('#')) { const t = document.getElementById(h.slice(1)); if (t) t.scrollIntoView({ block: 'center' }); }
      else window.open(h, '_blank', 'noopener');
    }
    const tl = e.target.closest('.toc-line');
    if (tl && tl.dataset.target && (e.ctrlKey || e.metaKey)) { const t = document.getElementById(tl.dataset.target); t && t.scrollIntoView({ block: 'center' }); }
  },

  /* ---------- Clavier ---------- */
  onKeyDown(e) {
    // Effacement près d'un saut de page en milieu de paragraphe : on retire d'abord les artefacts
    if ((e.key === 'Backspace' || e.key === 'Delete') && this.editor.querySelector('span[data-pl-artifact]')) {
      const r = this.range();
      const b = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,td');
      if (!r || !r.collapsed || (b && b.querySelector('span[data-pl-artifact]'))) { this.stripArtifacts(); this.relayout(); }
    }
    // Tabulation : insère une tabulation (ou change de niveau dans une liste / cellule suivante)
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      const c = this.cellCtx();
      const bl = this.selectedBlocks();
      e.preventDefault();
      if (bl.length && bl[0].tagName === 'LI') { this.exec(e.shiftKey ? 'outdent' : 'indent'); return; }
      if (c) {
        const cells = $$('td,th', c.table);
        let i = cells.indexOf(c.td) + (e.shiftKey ? -1 : 1);
        if (i >= cells.length) { this.tableOp('rowBelow'); i = cells.indexOf(c.td) + 1; }
        const t = $$('td,th', c.table)[Math.max(0, i)];
        if (t) { const r = document.createRange(); r.selectNodeContents(t); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.lastRange = r; }
        return;
      }
      if (!e.shiftKey) { document.execCommand('insertHTML', false, '<span class="pl-tab">\t</span>&#8203;'); this.afterCmd(); }
      return;
    }
    // Supprimer une image sélectionnée
    if ((e.key === 'Delete' || e.key === 'Backspace') && $('img.sel-img', this.editor)) {
      e.preventDefault(); $('img.sel-img', this.editor).remove(); this.selectImage(null); this.changed(false);
    }
  },

  /* ---------- Coller / déposer ---------- */
  onPaste(e) {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach(f => this.insertImageFile(f)); return; }
    const html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      const clean = Sanitize.html(html);
      document.execCommand('insertHTML', false, clean);
      if (/data-tblstyle/.test(clean)) TableStyles.applyAll(this.editor);
      this.afterCmd();
    }
  },
  onDrop(e) {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    const docx = files.find(f => !f.type.startsWith('image/') || /\.(pdf)$/i.test(f.name));
    if (docx && this.onOpenFile) { this.onOpenFile(docx); return; }
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (pos) { const s = getSelection(); s.removeAllRanges(); s.addRange(pos); this.lastRange = pos; }
    files.filter(f => f.type.startsWith('image/')).forEach(f => this.insertImageFile(f));
  },

  /* =====================================================================
     Rechercher / remplacer (API Highlight si disponible)
     ===================================================================== */
  find(query, { matchCase = false, wholeWord = false } = {}) {
    const ranges = [];
    if (!query) { this.showMatches([]); return ranges; }
    const nodes = [];
    const w = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let n, full = '', prevBlock = null;
    const map = [];
    const blockOf = t => t.parentElement.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,pre,div');
    while ((n = w.nextNode())) {
      const b = blockOf(n);
      if (prevBlock && b !== prevBlock) full += '\n';
      prevBlock = b;
      map.push({ node: n, start: full.length });
      full += n.data;
    }
    const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, 'gu' + (matchCase ? '' : 'i'));
    const locate = pos => {
      let lo = 0, hi = map.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (map[mid].start <= pos) lo = mid; else hi = mid - 1; }
      return { node: map[lo].node, off: pos - map[lo].start };
    };
    let m;
    while ((m = re.exec(full))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const a = locate(m.index), b = locate(m.index + m[0].length - 1);
      const r = document.createRange();
      r.setStart(a.node, a.off); r.setEnd(b.node, b.off + 1);
      ranges.push(r);
    }
    this.showMatches(ranges);
    return ranges;
  },
  showMatches(ranges, cur = -1) {
    if (!window.CSS || !CSS.highlights) return;
    CSS.highlights.delete('plume-find'); CSS.highlights.delete('plume-find-cur');
    if (!ranges.length) return;
    CSS.highlights.set('plume-find', new Highlight(...ranges));
    if (cur >= 0 && ranges[cur]) CSS.highlights.set('plume-find-cur', new Highlight(ranges[cur]));
  },
  selectRange(r) {
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); this.lastRange = r.cloneRange();
    const rect = r.getBoundingClientRect(), c = $('#canvas').getBoundingClientRect();
    if (rect.top < c.top + 40 || rect.bottom > c.bottom - 40) $('#canvas').scrollTop += rect.top - c.top - c.height / 3;
  },
  replaceAll(query, repl, opts) {
    const ranges = this.find(query, opts);
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i];
      r.deleteContents();
      if (repl) r.insertNode(document.createTextNode(repl));
    }
    this.editor.normalize();
    this.showMatches([]);
    this.changed(false);
    return ranges.length;
  },

  /* ---------- Statistiques ---------- */
  stats() {
    const text = this.editor.innerText || '';
    const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
    return {
      words, chars: text.replace(/\n/g, '').length, charsNoSpace: text.replace(/\s/g, '').length,
      paras: $$('p,h1,h2,h3,h4,h5,h6,li', this.editor).filter(p => p.textContent.trim()).length,
      lines: Math.max(0, text.split('\n').filter(l => l.trim()).length - this.editor.querySelectorAll('span[data-pl-artifact]').length), pages: this.pageCount
    };
  },
  selectionWords() {
    const r = this.lastRange;
    if (!r || r.collapsed) return null;
    return (r.toString().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) || []).length;
  }
};
Ed.relayout = debounce(() => Ed._layout(), 40);

/* =====================================================================
   Nettoyage du HTML collé ou ouvert (liste blanche)
   ===================================================================== */
const Sanitize = {
  TAGS: new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL', 'A', 'IMG', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'SPAN', 'BR', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'DIV', 'FONT', 'MARK']),
  STYLES: ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'background-color', 'text-align', 'margin-left', 'text-indent', 'line-height', 'vertical-align', 'width', 'height', 'list-style-type', 'text-transform', 'letter-spacing', 'font-variant'],
  html(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    this.clean(doc.body);
    return doc.body.innerHTML;
  },
  clean(root) {
    // Word met les listes dans des paragraphes "MsoListParagraph" : on les garde comme paragraphes
    const walk = node => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 8) { c.remove(); continue; }
        if (c.nodeType !== 1) continue;
        if (c.hasAttribute('data-pl-artifact')) { c.remove(); continue; }
        const tag = c.tagName;
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'XML', 'O:P', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH'].includes(tag) || tag.includes(':')) {
          if (tag === 'O:P' || tag.includes(':')) {
            walk(c);
            c.replaceWith(...c.childNodes);
          } else c.remove();
          continue;
        }
        walk(c);
        if (!this.TAGS.has(tag)) { c.replaceWith(...c.childNodes); continue; }
        // attributs
        for (const a of Array.from(c.attributes)) {
          const n = a.name.toLowerCase();
          if (n === 'style') {
            const keep = [];
            for (const prop of this.STYLES) { const v = c.style.getPropertyValue(prop); if (v && !/mso-|expression|url\(/i.test(v)) keep.push(`${prop}:${v}`); }
            if (keep.length) c.setAttribute('style', keep.join(';')); else c.removeAttribute('style');
          } else if (n === 'href' && tag === 'A') {
            if (/^\s*javascript:/i.test(a.value)) c.removeAttribute('href');
          } else if (n === 'src' && tag === 'IMG') {
            if (!/^(data:image\/|blob:|https?:)/i.test(a.value)) c.remove();
          } else if (['colspan', 'rowspan', 'start', 'alt', 'width', 'height'].includes(n)) { /* conservé */ }
          else if (n === 'class' && /^(pl-|title$|subtitle$)/.test(a.value)) { /* classes Plume */ }
          else if (/^data-(borders|field|note|x|own|kind|part|cid|author|date|text|initials|pstyle|numid|tblstyle|look|tbdr|band|sect|keepnext|keeplines|widow|pbb)$/.test(n) || n === 'contenteditable' || n === 'id') { /* conservé */ }
          else c.removeAttribute(a.name);
        }
        if (tag === 'FONT') {
          const s = doc.createElement('span');
          if (c.getAttribute('color')) s.style.color = c.getAttribute('color');
          if (c.getAttribute('face')) s.style.fontFamily = c.getAttribute('face');
          s.append(...c.childNodes); c.replaceWith(s);
        }
        if (tag === 'TABLE' && !c.dataset.borders) c.dataset.borders = 'all';
      }
    };
    walk(root);
  }
};
