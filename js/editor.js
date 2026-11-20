/* =====================================================================
   Plume — moteur de l'éditeur
   Pages, pagination, en-têtes / pieds, historique (annuler / rétablir),
   commandes de mise en forme, recherche, tableaux, images.
   ===================================================================== */
'use strict';

const GAP = 26; // espace entre deux pages (px)

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
    return { fontCss: 'Calibri, Carlito, "Liberation Sans", Arial, sans-serif', size: 11, lineHeight: 1.15, after: 8, before: 0, color: '#000000', heading: '#0B5E4E' };
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
    ed.addEventListener('input', () => this.changed(true));
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
    this.headerHTML = header || '';
    this.footerHTML = footer || '';
    this.applySettings();
    this.history = []; this.hIndex = -1;
    this.renderPages(true);
    this.relayout();
    this.commit();
    this.placeCaretStart();
  },

  /** Contenu stocké : on retire les éventuels résidus d'interface */
  sanitizeStored(html) {
    return html.replace(/\sclass="sel-img"/g, '');
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
      html: await toData(this.editor.innerHTML),
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
     Pages et pagination
     ===================================================================== */
  renderPages(force) {
    const n = this.pageCount;
    const P = this.page.h + GAP;
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
      Object.assign(card.style, { top: i * P + 'px', width: this.page.w + 'px', height: this.page.h + 'px' });
      const hd = card.querySelector('.header'), ft = card.querySelector('.footer');
      Object.assign(hd.style, { top: this.page.mh + 'px', left: this.page.ml + 'px', right: this.page.mr + 'px' });
      Object.assign(ft.style, { bottom: this.page.mf + 'px', left: this.page.ml + 'px', right: this.page.mr + 'px', top: 'auto' });
      card.querySelector('.page-num-badge').textContent = i + 1;
      if (force) this.fillHF(card, i);
      else this.updateFields(card, i);
    });
    const ed = this.editor;
    Object.assign(ed.style, {
      width: this.page.w + 'px',
      paddingTop: this.page.mt + 'px', paddingLeft: this.page.ml + 'px',
      paddingRight: this.page.mr + 'px', paddingBottom: this.page.mb + 'px'
    });
    this.sheet.style.width = this.page.w + 'px';
    this.sheet.style.height = (n * P - GAP) + 'px';
    ed.style.minHeight = (n * P - GAP) + 'px';
  },
  fillHF(card, i) {
    const hd = card.querySelector('.header'), ft = card.querySelector('.footer');
    // Première page différente (document Word d'origine) : affichée, conservée telle quelle
    const first = i === 0 && this.page.titlePg && this.page.first;
    for (const [elx, html, firstHtml] of [[hd, this.headerHTML, first && this.page.first.header], [ft, this.footerHTML, first && this.page.first.footer]]) {
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
      if (t !== h && !(i === 0 && this.page.titlePg)) { t.innerHTML = html; this.updateFields(card, i); }
    });
    this.changed(true);
  },
  inHF(n) { return !!(n && (n.nodeType === 1 ? n : n.parentElement)?.closest('.hf')); },
  headerEl() { return this.pagesLayer.querySelector('.header'); },
  footerEl() { return this.pagesLayer.querySelector('.footer'); },

  /** Unités de pagination : blocs de premier niveau, et éléments de liste */
  units() {
    const out = [];
    Array.from(this.editor.children).forEach((b, k) => {
      if (b.tagName === 'STYLE') return;
      if ((b.tagName === 'UL' || b.tagName === 'OL') && b.children.length) {
        Array.from(b.children).forEach((li, j) => out.push({ el: li, sel: `#editor > :nth-child(${k + 1}) > :nth-child(${j + 1})` }));
      } else out.push({ el: b, sel: `#editor > :nth-child(${k + 1})` });
    });
    return out;
  },

  relayout: null, // défini plus bas (débouncé)
  _layout() {
    if (this.editor.dataset.exporting) return;
    const pg = this.page;
    const P = pg.h + GAP;
    const contentH = pg.h - pg.mt - pg.mb;
    const cTop = i => i * P + pg.mt;
    const cBot = i => i * P + pg.h - pg.mb;
    this.pushStyle.textContent = '';
    const units = this.units();
    const metrics = units.map(u => {
      const cs = getComputedStyle(u.el);
      const prev = u.el.previousElementSibling;
      return {
        top: u.el.offsetTop, h: u.el.offsetHeight, mt: parseFloat(cs.marginTop) || 0,
        prevMB: prev ? parseFloat(getComputedStyle(prev).marginBottom) || 0 : 0,
        pb: u.el.classList && u.el.classList.contains('pl-pagebreak')
      };
    });
    // ajuster le top des li (offsetParent = editor) — déjà relatif à l'éditeur
    let shift = 0, forceNext = false, lastBottom = pg.mt;
    const rules = [];
    units.forEach((u, idx) => {
      const m = metrics[idx];
      let top = m.top + shift;
      const p = Math.max(0, Math.floor(top / P));
      let push = 0;
      if (forceNext) {
        const target = cTop(Math.floor((top - 1) / P) + 1);
        const pbPage = Math.floor((metrics[idx - 1].top + shift - 1) / P);
        push = Math.max(0, cTop(pbPage + 1) - top);
        if (target < 0) push = 0;
        forceNext = false;
      } else if (top >= cBot(p) - 1 && top > cTop(p)) {
        push = cTop(p + 1) - top;
      } else if (top + m.h > cBot(p) + 1 && m.h <= contentH && top > cTop(p) + 2) {
        push = cTop(p + 1) - top;
      }
      if (push > 0.5) {
        const newMT = Math.max(m.prevMB, m.mt) + push;
        rules.push(`${u.sel}{margin-top:${newMT.toFixed(2)}px !important}`);
        shift += push; top += push;
      }
      if (m.pb) forceNext = true;
      lastBottom = Math.max(lastBottom, top + m.h);
    });
    this.pushStyle.textContent = rules.join('\n');
    // un saut de page en toute fin de document ouvre une nouvelle page
    let n = Math.max(1, Math.floor((lastBottom - 1) / P) + 1);
    if (forceNext) n = Math.max(n, Math.floor((lastBottom - 1) / P) + 2);
    const changedCount = n !== this.pageCount;
    this.pageCount = n;
    this.renderPages(false);
    if (changedCount) Array.from(this.pagesLayer.children).forEach((c, i) => this.updateFields(c, i));
    this.renderNotes();
    this.updateTocPages();
    this.onLayout && this.onLayout();
  },

  /** Page (0-based) d'un élément ou d'un rectangle */
  pageOfY(y) { return Math.max(0, Math.min(this.pageCount - 1, Math.floor(y / (this.page.h + GAP)))); },
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
    Array.from(this.pagesLayer.children).forEach((card, i) => {
      const box = card.querySelector('.pnotes');
      const list = per[i] || [];
      Object.assign(box.style, { left: this.page.ml + 'px', right: this.page.mr + 'px', top: (this.page.h - this.page.mb + 4) + 'px', fontSize: '9pt', fontFamily: 'var(--doc-font)', zIndex: 3, color: '#222', lineHeight: 1.25 });
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
    return { html: this.editor.innerHTML, header: this.headerHTML, footer: this.footerHTML, sel: this.saveSel() };
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
  pathOf(node) {
    const p = [];
    while (node && node !== this.editor) {
      const par = node.parentNode;
      if (!par) return null;
      p.unshift(Array.prototype.indexOf.call(par.childNodes, node));
      node = par;
    }
    return node === this.editor ? p : null;
  },
  nodeAt(path) {
    let n = this.editor;
    for (const i of path) { if (!n.childNodes[i]) return null; n = n.childNodes[i]; }
    return n;
  },
  saveSel() {
    const r = this.lastRange;
    if (!r || !this.editor.contains(r.startContainer)) return null;
    const a = this.pathOf(r.startContainer), b = this.pathOf(r.endContainer);
    return a && b ? { a, ao: r.startOffset, b, bo: r.endOffset } : null;
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
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, val);
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
  contentWidth() { return this.page.w - this.page.ml - this.page.mr; },
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
    const r = await dialog({ title: 'Note de bas de page', body: ta, buttons: [{ label: 'Supprimer la note', value: 'del' }, { label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
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
      case 'borders': table.dataset.borders = table.dataset.borders === 'none' ? 'all' : 'none'; break;
      case 'header': tr.dataset.header ? delete tr.dataset.header : (tr.dataset.header = '1'); break;
      case 'distribute': this.redistribute(table, true); break;
      case 'vtop': case 'vmiddle': case 'vbottom': td.style.verticalAlign = op.slice(1) === 'top' ? '' : op.slice(1); break;
    }
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
    if (isl) { this.islandInfo(isl); return; }
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
      lines: text.split('\n').filter(l => l.trim()).length, pages: this.pageCount
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
    const body = doc.body;
    // Word met les listes dans des paragraphes "MsoListParagraph" : on les garde comme paragraphes
    const walk = node => {
      for (const c of Array.from(node.childNodes)) {
        if (c.nodeType === 8) { c.remove(); continue; }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName;
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'XML', 'O:P', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'MATH'].includes(tag) || tag.includes(':')) {
          if (tag === 'O:P' || tag.includes(':')) c.replaceWith(...c.childNodes); else c.remove();
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
          else if (/^data-(borders|field|note|x|kind|part|cid|author|date|text|initials|pstyle|numid)$/.test(n) || n === 'contenteditable' || n === 'id') { /* conservé */ }
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
    walk(body);
    return body.innerHTML;
  }
};
