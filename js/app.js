/* =====================================================================
   Plume — application : fichiers, enregistrement, affichage, raccourcis
   ===================================================================== */
'use strict';

const App = {
  VERSION: '1.3.0',
  docId: null, fileHandle: null, dirty: false,

  async init() {
    hydrateIcons();
    Ed.init();
    Ribbon.build();
    Mini.init();
    Track.init();
    Native.init();
    CustomFonts.init();
    AutoCorrect.init();
    this.initTheme();
    this.initStatus();
    this.initCmdSearch();
    this.initNav();
    this.initKeys();
    this.initRuler();
    Ed.onSelection = debounce(() => { Ribbon.refresh(); this.updateStatus(); }, 60);
    Ed.onChange = () => { this.dirty = true; this.setSaveState('Modifié'); this.autosave(); this.navRefresh(); };
    Ed.onHistory = () => Ribbon.refresh();
    Ed.onLayout = () => { Watermark.render(); Captions.renumber(); this.updateStatus(); Ed.placeHandle && Ed.placeHandle(); this.drawRuler(); Comments.highlight(); };
    Ed.onOpenFile = f => this.openFile(f);
    $('#docTitle').addEventListener('change', () => { this.dirty = true; this.autosave(); document.title = this.name() + ' — Plume'; });
    $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.fileInputCb(f); });
    $('#exitReading').addEventListener('click', () => this.setReading(false));
    $('#themeBtn').addEventListener('click', () => this.toggleTheme());

    // Restaurer le dernier document ou démarrer à vide
    let restored = false;
    try {
      const last = await Store.getKV('lastDoc');
      if (last) restored = await this.openStored(last, true);
    } catch { /* stockage indisponible */ }
    if (!restored || new URLSearchParams(location.search).has('new')) this.newDoc('blank', true);

    // Ouverture depuis le système (application installée)
    // Application de bureau (Electron) : fichiers ouverts depuis l'Explorateur / le Finder
    if (window.plumeDesktop) {
      document.documentElement.classList.add('desktop');
      window.plumeDesktop.onOpenFile(f => this.openFile(new File([f.data], f.name), null, f.path));
    }
    if ('launchQueue' in window) {
      launchQueue.setConsumer(async p => { if (p.files && p.files.length) { const h = p.files[0]; this.openFile(await h.getFile(), h); } });
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
    window.addEventListener('beforeunload', e => { if (this.dirty && !this.savedLocally) { e.preventDefault(); e.returnValue = ''; } });
    Ed.editor.focus();
    if (!localStorage.getItem('plume-guide-vu') && !navigator.webdriver) { localStorage.setItem('plume-guide-vu', '1'); setTimeout(() => Guide.open(), 600); }
    // petits écrans : la page s'adapte à la largeur
    if ($('#canvas').clientWidth < Ed.page.w + 40) this.fitWidth();
  },

  name() { return ($('#docTitle').value || 'Document').trim(); },

  /* ---------- Documents ---------- */
  async newDoc(tpl = 'blank', silent) {
    if (!silent && this.dirty) await this.flushAutosave();
    const t = TEMPLATES[tpl] || TEMPLATES.blank;
    this.docId = uid(); this.fileHandle = null; this.desktopPath = null; this.format = 'docx'; Ed.source = null;
    $('#docTitle').value = tpl === 'blank' ? this.nextDocName() : t.name;
    Ed.load({ html: t.html, props: { author: await this.user(), created: new Date().toISOString() } });
    this.afterOpen();
    this.dirty = false;
    this.setSaveState('');
  },
  nextDocName() { this._n = (this._n || 0) + 1; return 'Document' + this._n; },
  afterOpen() {
    document.title = this.name() + ' — Plume';
    $('#canvas').scrollTop = 0;
    this.navRefresh(); this.drawRuler(); Ribbon.refresh(); this.updateStatus();
    Store.setKV('lastDoc', this.docId).catch(() => { });
  },
  async openStored(id, silent) {
    const d = await Store.getDoc(id).catch(() => null);
    if (!d) return false;
    this.docId = d.id; this.fileHandle = null; this.desktopPath = null; this.format = d.format || 'docx';
    Ed.source = d.source ? { zip: await JSZip.loadAsync(d.source), bytes: d.source } : null;
    $('#docTitle').value = d.name;
    Ed.load({ html: await Ed.hydrateImages(d.html), header: await Ed.hydrateImages(d.header || ''), footer: await Ed.hydrateImages(d.footer || ''), page: d.page, settings: d.settings, props: d.props });
    this.afterOpen();
    this.dirty = false; this.savedLocally = true;
    this.setSaveState('Enregistré sur cet appareil');
    if (!silent) toast(`<b>${htmlEsc(d.name)}</b> ouvert`);
    return true;
  },
  openPicker() {
    // un sélecteur unique accepte tous les formats (Word, OpenDocument, RTF, PDF, texte…)
    const fi = $('#fileInput');
    fi.accept = Formats.ACCEPT;
    this.fileInputCb = f => this.openFile(f);
    if (window.showOpenFilePicker && !window.plumeDesktop) {
      showOpenFilePicker({ excludeAcceptAllOption: false, types: [{ description: 'Tous les documents', accept: { 'application/octet-stream': Formats.ALL_EXT.map(e => '.' + e) } }] })
        .then(async ([h]) => this.openFile(await h.getFile(), h)).catch(e => { if (e.name !== 'AbortError') fi.click(); });
      return;
    }
    fi.click();
  },
  async openFile(file, handle = null, desktopPath = null) {
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      if (this.dirty) await this.flushAutosave();
      this.setSaveState('Ouverture…');
      const r = await Formats.open(file, { registerImage: b => Ed.registerImage(b) });
      Ed.source = r.source ? { zip: r.source, bytes: r.bytes || null } : null;
      this.docId = uid();
      this.format = r.format || 'docx';
      // Ctrl+S réécrit le fichier d'origine seulement si son format est réinscriptible sans perte
      const writable = Formats.SAVABLE.has(this.format) || (this.format === 'doc' && window.plumeDesktop);
      this.fileHandle = writable ? handle : null;
      this.desktopPath = writable ? desktopPath : null;
      $('#docTitle').value = base;
      const s = r.settings || {};
      Ed.load({
        html: r.html, header: r.header || '', footer: r.footer || '', page: r.page, props: r.props,
        settings: { fontCss: s.fontCss, size: s.size, lineHeight: s.lineHeight, after: s.after, before: s.before, color: s.color, heading: '#0B5E4E' }
      });
      this.afterOpen();
      this.dirty = false;
      await this.flushAutosave(true);
      toast(`<b>${htmlEsc(file.name)}</b> ouvert`);
      if (r.notice) setTimeout(() => toast(r.notice, 7000), 2700);
    } catch (e) {
      console.error(e);
      this.setSaveState('');
      dialog({ title: 'Impossible d’ouvrir le fichier', body: e.userMessage ? `<p style="line-height:1.55">${e.userMessage}</p>` : `<p>${htmlEsc(file.name)} n’a pas pu être lu.</p><p style="color:var(--ui-fg-2)">${htmlEsc(e.message || String(e))}</p>`, buttons: [{ label: 'OK', primary: true }] });
    }
  },

  /* ---------- Enregistrement et export ---------- */
  exportCtx() {
    Ed.props.title = Ed.props.title || this.name();
    return { editor: Ed.editor, headerEl: Ed.headerEl(), footerEl: Ed.footerEl(), page: Ed.page, props: Ed.props, settings: Ed.settings, source: Ed.source ? Ed.source.zip : null };
  },
  async buildDocx() { return DocxExport.exportDocx(this.exportCtx()); },
  fileName(ext) { return this.name().replace(/[\\/:*?"<>|]/g, '_') + '.' + ext; },
  /** Ctrl+S : même format que le fichier ouvert s'il est réinscriptible, sinon .docx */
  async save(asNew = false) {
    const fmt = (!asNew && (Formats.SAVABLE.has(this.format) || (this.format === 'doc' && window.plumeDesktop))) ? this.format : 'docx';
    return this.saveAs(fmt, asNew);
  },
  async saveAs(fmt = 'docx', asNew = true) {
    const info = Formats.EXPORT[fmt];
    try {
      this.setSaveState('Enregistrement…');
      if (fmt === 'pdf' && !(window.plumeDesktop && window.plumeDesktop.printToPdf)) { this.setSaveState(''); this.print(); return; }
      if (fmt === 'pdf') this.preparePrint();
      const blob = await Formats.build(fmt, this.exportCtx());
      if (fmt === 'pdf') this.endPrint();
      const fname = this.fileName(fmt);
      if (this.desktopPath && window.plumeDesktop && !asNew) {
        await window.plumeDesktop.writeFile(this.desktopPath, await blob.arrayBuffer());
      } else if (this.fileHandle && !asNew) {
        const w = await this.fileHandle.createWritable(); await w.write(blob); await w.close();
      } else if (window.plumeDesktop && window.plumeDesktop.saveDialog) {
        const path = await window.plumeDesktop.saveDialog(fname, fmt, info.label);
        if (!path) { this.setSaveState('Modifié'); return; }
        await window.plumeDesktop.writeFile(path, await blob.arrayBuffer());
        if (Formats.SAVABLE.has(fmt) || fmt === 'doc') { this.desktopPath = path; this.format = fmt; $('#docTitle').value = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); }
      } else if (window.showSaveFilePicker) {
        try {
          const h = await showSaveFilePicker({ suggestedName: fname, types: [{ description: info.label, accept: { [info.mime]: ['.' + fmt] } }] });
          const w = await h.createWritable(); await w.write(blob); await w.close();
          if (Formats.SAVABLE.has(fmt)) { this.fileHandle = h; this.desktopPath = null; this.format = fmt; $('#docTitle').value = h.name.replace(/\.[^.]+$/, ''); }
        } catch (e) { if (e.name === 'AbortError') { this.setSaveState('Modifié'); return; } throw e; }
      } else downloadBlob(blob, fname);
      await this.flushAutosave(true);
      this.dirty = false;
      this.setSaveState('Enregistré');
      toast(`<b>${htmlEsc(fname)}</b> enregistré`);
    } catch (e) {
      console.error(e);
      this.endPrint && this.endPrint();
      this.setSaveState('Erreur');
      if (e.userMessage) dialog({ title: 'Export impossible', body: `<p style="line-height:1.55">${e.userMessage}</p>`, buttons: [{ label: 'OK', primary: true }] });
      else toast('Erreur à l’enregistrement : ' + htmlEsc(e.message || e), 6000);
    }
  },
  autosave: debounce(function () { App.flushAutosave(); }, 1500),
  async flushAutosave(force) {
    if (!this.docId) return;
    try {
      const st = await Ed.getState();
      await Store.putDoc({ id: this.docId, name: this.name(), ...st, format: this.format || 'docx', source: Ed.source ? Ed.source.bytes : null, updated: Date.now() });
      this.savedLocally = true;
      if (!force) this.setSaveState('Enregistré sur cet appareil');
    } catch (e) { console.warn('Autosauvegarde impossible', e); this.savedLocally = false; }
  },
  setSaveState(t) { $('#saveState').textContent = t ? '• ' + t : ''; },

  /** Prépare la page pour l'impression / le PDF (marges, en-têtes, sans décalages d'écran) */
  preparePrint() {
    const ph = $('#printHeader'), pf = $('#printFooter');
    ph.innerHTML = Ed.headerHTML; pf.innerHTML = Ed.footerHTML;
    ph.style.top = '0'; pf.style.bottom = '0';
    let st = $('#printPage');
    if (!st) { st = el('style', { id: 'printPage' }); document.head.append(st); }
    const p = Ed.page, cm = v => U.pxToCm(v).toFixed(2) + 'cm';
    st.textContent = `@page { size: ${cm(p.w)} ${cm(p.h)}; margin: ${cm(p.mt)} ${cm(p.mr)} ${cm(p.mb)} ${cm(p.ml)}; }
      @media print { .print-hf .pl-field[data-field="page"]{display:none} }`;
    this._push = $('#pushStyle').textContent; $('#pushStyle').textContent = '';
  },
  endPrint() { if (this._push !== undefined) { $('#pushStyle').textContent = this._push; this._push = undefined; } },
  print() {
    if (Native.on) { dialog({ title: 'Imprimer ou créer un PDF', body: '<p style="line-height:1.55">Sur téléphone, exportez le document en <b>Word (.docx)</b> ou <b>OpenDocument (.odt)</b> (menu Fichier → Exporter), puis ouvrez-le avec l’application d’impression ou de PDF de votre téléphone grâce au bouton <b>Partager</b>.</p>', buttons: [{ label: 'Exporter en Word', primary: true, onClick: () => { App.saveAs('docx'); } }, { label: 'Fermer' }] }); return; }
    this.preparePrint();
    setTimeout(() => { window.print(); this.endPrint(); }, 50);
  },
  async htmlDocument() {
    const st = await Ed.getState();
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Plume"><title>${htmlEsc(this.name())}</title><style>body{font-family:${Ed.settings.fontCss};font-size:${Ed.settings.size}pt;line-height:${Ed.settings.lineHeight};max-width:${Math.round(Ed.contentWidth())}px;margin:40px auto;padding:0 20px}p{margin:0 0 ${Ed.settings.after}pt}table{border-collapse:collapse}td,th{border:1px solid #000;padding:2px 7px;vertical-align:top}table[data-borders=none] td{border:0}img{max-width:100%;height:auto}h1,h2,h3{color:${Ed.settings.heading}}.pl-pagebreak{border:0;page-break-after:always}.pl-toc .toc-upd{display:none}.toc-line{display:flex}.toc-line .dots{flex:1;border-bottom:1px dotted #777;margin:0 4px 4px}.pl-del{text-decoration:line-through;color:#B42318}.pl-ins{text-decoration:underline;color:#1F6F43}.pl-island-box{display:inline-block;border:1px solid #ddd}</style></head><body>${st.header ? `<header>${st.header}</header>` : ''}${st.html}${st.footer ? `<footer>${st.footer}</footer>` : ''}</body></html>`;
  },
  exportHtml() { return this.saveAs('html'); },
  exportTxt() { return this.saveAs('txt'); },

  /* ---------- Insertion ---------- */
  pickImage() {
    const fi = $('#fileInput');
    fi.accept = 'image/*';
    this.fileInputCb = f => Ed.insertImageFile(f);
    fi.click();
  },
  insertCover() {
    const html = `<h1 class="title" style="margin-top:180pt">Titre du document</h1><p class="subtitle">Sous-titre</p><p><br></p><p style="margin-top:220pt">${htmlEsc(Ed.props.author || 'Auteur')}<br>${new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })}</p><hr class="pl-pagebreak" contenteditable="false">`;
    Ed.editor.insertAdjacentHTML('afterbegin', html);
    Ed.changed(false);
    $('#canvas').scrollTop = 0;
  },
  editHF(which) {
    const card = Ed.pagesLayer.children[Ed.caretPage()] || Ed.pagesLayer.firstElementChild;
    const h = card.querySelector('.' + which);
    h.focus();
    const r = document.createRange(); r.selectNodeContents(h); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    Ed.lastRange = r;
    card.scrollIntoView({ block: which === 'header' ? 'start' : 'end' });
    toast(which === 'header' ? 'Tapez votre <b>en-tête</b> : il se répète sur toutes les pages' : 'Tapez votre <b>pied de page</b> : il se répète sur toutes les pages');
  },
  async pageNumber() {
    const r = await dialog({ title: 'Numéro de page', body: '<p>Où placer le numéro de page ?</p>', buttons: [{ label: 'Haut de page', value: 'header' }, { label: 'Bas de page — centré', value: 'fc', primary: true }, { label: 'Bas — « Page X sur Y »', value: 'fxy' }] });
    if (!r) return;
    const f = k => `<span class="pl-field" contenteditable="false" data-field="${k}">1</span>`;
    if (r === 'header') Ed.headerHTML += `<p style="text-align:right">${f('page')}</p>`;
    if (r === 'fc') Ed.footerHTML += `<p style="text-align:center">${f('page')}</p>`;
    if (r === 'fxy') Ed.footerHTML += `<p style="text-align:center">Page ${f('page')} sur ${f('numpages')}</p>`;
    Array.from(Ed.pagesLayer.children).forEach((c, i) => Ed.fillHF(c, i));
    Ed.changed(false);
  },

  /* ---------- Mise en page ---------- */
  setMargins([t, r, b, l]) { Object.assign(Ed.page, { mt: U.cmToPx(t), mr: U.cmToPx(r), mb: U.cmToPx(b), ml: U.cmToPx(l) }); this.pageChanged(); },
  setOrientation(o) {
    const p = Ed.page;
    const land = p.w > p.h;
    if ((o === 'landscape') !== land) { [p.w, p.h] = [p.h, p.w]; }
    this.pageChanged();
  },
  setSize(k) {
    const [w, h] = PAGE_SIZES[k];
    const land = Ed.page.w > Ed.page.h;
    Ed.page.w = U.cmToPx(land ? h : w); Ed.page.h = U.cmToPx(land ? w : h);
    this.pageChanged();
  },
  pageChanged() { Ed.renderPages(false); Ed.relayout(); Ed.changed(false); this.drawRuler(); },
  setLang(code, label) {
    Ed.editor.lang = code;
    $('#sbLang').textContent = label || code;
    toast('Langue de vérification : <b>' + htmlEsc(label || code) + '</b>');
  },

  /* ---------- Affichage ---------- */
  initTheme() {
    const saved = localStorage.getItem('plume-theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    this.applyTheme(dark ? 'dark' : 'light');
  },
  applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const b = $('#themeBtn'); b.innerHTML = ''; b.append(icon(t === 'dark' ? 'sun' : 'moon'));
    Ribbon.refresh && $('#fontName') && Ribbon.refresh();
  },
  toggleTheme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('plume-theme', t); this.applyTheme(t);
  },
  setZoom(z) {
    z = Math.max(0.25, Math.min(3, Math.round(z * 100) / 100));
    Ed.zoom = z;
    $('#zoomBox').style.zoom = z;
    $('#zoomRange').value = Math.round(z * 100);
    $('#zoomPct').textContent = Math.round(z * 100) + ' %';
    Ed.placeHandle && Ed.placeHandle();
    this.drawRuler();
  },
  fitWidth() { this.setZoom(($('#canvas').clientWidth - 40) / Ed.page.w); },
  fitPage() { this.setZoom(Math.min(($('#canvas').clientHeight - 50) / Ed.page.h, ($('#canvas').clientWidth - 40) / Ed.page.w)); },
  setReading(on) {
    document.body.classList.toggle('reading', on);
    Ed.editor.contentEditable = on ? 'false' : 'true';
    $$('.hf').forEach(h => h.contentEditable = on ? 'false' : 'true');
    $('#sbRead').classList.toggle('on', on); $('#sbPrint').classList.toggle('on', !on);
    if (on) this.fitWidth(); else this.setZoom(1);
  },
  speak() {
    if (!('speechSynthesis' in window)) { toast('La lecture à voix haute n’est pas disponible sur cet appareil.'); return; }
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); toast('Lecture arrêtée'); return; }
    const r = Ed.lastRange;
    const text = r && !r.collapsed ? r.toString() : Ed.editor.innerText;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = Ed.editor.lang || 'fr-BE';
    speechSynthesis.speak(u);
    toast('Lecture en cours — cliquez à nouveau sur <b>Lecture à voix haute</b> pour arrêter');
  },

  /* ---------- Barre d'état ---------- */
  initStatus() {
    $('#zoomRange').addEventListener('input', e => this.setZoom(e.target.value / 100));
    $('#zoomIn').addEventListener('click', () => this.setZoom(Ed.zoom + 0.1));
    $('#zoomOut').addEventListener('click', () => this.setZoom(Ed.zoom - 0.1));
    $('#zoomPct').addEventListener('click', () => this.setZoom(1));
    $('#sbWords').addEventListener('click', () => Dialogs.stats());
    $('#sbLang').addEventListener('click', e => Menus.open('langs', e.currentTarget));
    $('#sbRead').addEventListener('click', () => this.setReading(true));
    $('#sbPrint').addEventListener('click', () => this.setReading(false));
    $('#sbPage').addEventListener('click', async () => {
      const inp = el('input', { type: 'number', min: 1, max: Ed.pageCount, value: Ed.caretPage() + 1 });
      const r = await dialog({ title: 'Atteindre la page', body: el('div', { class: 'fld' }, [el('label', {}, ['Numéro de page']), inp]), buttons: [{ label: 'Annuler', value: null }, { label: 'Atteindre', primary: true, value: 'ok' }] });
      if (r === 'ok') { const c = Ed.pagesLayer.children[Math.max(0, Math.min(Ed.pageCount, +inp.value) - 1)]; c && c.scrollIntoView({ block: 'start' }); }
    });
    // pincer / Ctrl+molette pour zoomer
    $('#canvas').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); this.setZoom(Ed.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
  },
  updateStatus: debounce(function () {
    $('#sbPage').textContent = `Page ${Ed.caretPage() + 1} sur ${Ed.pageCount}`;
    const sw = Ed.selectionWords();
    const w = Ed.stats().words;
    $('#sbWords').textContent = sw != null ? `${sw} sur ${w} mots` : `${w} mot${w > 1 ? 's' : ''}`;
  }, 120),

  /* ---------- Règle ---------- */
  initRuler() {
    $('#canvas').addEventListener('scroll', () => this.drawRuler());
    window.addEventListener('resize', () => this.drawRuler());
  },
  drawRuler() {
    const ruler = $('#ruler'); if (!ruler || document.body.classList.contains('no-ruler')) return;
    const s = Ed.sheet.getBoundingClientRect(), w = $('#rulerWrap').getBoundingClientRect();
    const z = Ed.zoom, p = Ed.page;
    ruler.style.left = (s.left - w.left) + 'px';
    ruler.style.width = p.w * z + 'px';
    ruler.innerHTML = '';
    ruler.append(el('div', { class: 'rm', style: `left:0;width:${p.ml * z}px` }), el('div', { class: 'rm', style: `right:0;width:${p.mr * z}px` }));
    const cmPx = U.PX_PER_CM * z;
    for (let i = -Math.floor(p.ml / U.PX_PER_CM * 4); i <= (p.w - p.ml) / U.PX_PER_CM * 4; i++) {
      const x = p.ml * z + i * cmPx / 4;
      if (x < 0 || x > p.w * z) continue;
      if (i % 4 === 0 && i !== 0) ruler.append(el('span', { class: 'num', style: `left:${x}px` }, [String(Math.abs(i / 4))]));
      else ruler.append(el('span', { class: 'tick', style: `left:${x}px;height:${i % 2 === 0 ? 6 : 3}px` }));
    }
    const handle = side => {
      const h = el('div', { class: 'handle', title: side === 'l' ? 'Marge gauche' : 'Marge droite', style: `left:${side === 'l' ? p.ml * z : (p.w - p.mr) * z}px` });
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); h.setPointerCapture(e.pointerId);
        const startX = e.clientX, start = side === 'l' ? p.ml : p.mr;
        const move = ev => {
          const d = (ev.clientX - startX) / z * (side === 'l' ? 1 : -1);
          const v = Math.max(U.cmToPx(0.5), Math.min(p.w / 2 - 20, start + d));
          if (side === 'l') p.ml = v; else p.mr = v;
          h.style.left = (side === 'l' ? p.ml * z : (p.w - p.mr) * z) + 'px';
          Ed.renderPages(false);
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); this.pageChanged(); };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
      });
      return h;
    };
    ruler.append(handle('l'), handle('r'));
  },

  /* ---------- Volet de navigation ---------- */
  initNav() {
    $('#npClose').addEventListener('click', () => this.toggleNav(false));
    $$('.np-tabs button').forEach(b => b.addEventListener('click', () => { this.navTab = b.dataset.np; this.navRefresh(); }));
    $('#npFind').addEventListener('input', debounce(() => { this.navTab = 'results'; this.navRefresh(); }, 200));
    $('#npFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.findNext(); } if (e.key === 'Escape') { Ed.showMatches([]); Ed.focus(); } });
    this.navTab = 'titles';
  },
  toggleNav(force) {
    const on = force !== undefined ? force : !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', on);
    if (!on) Ed.showMatches([]);
    this.navRefresh(); Ribbon.refresh(); setTimeout(() => this.drawRuler(), 0);
  },
  openNav(tab) {
    this.toggleNav(true);
    this.navTab = tab;
    const r = Ed.lastRange;
    if (tab === 'results' && r && !r.collapsed && r.toString().length < 80) $('#npFind').value = r.toString();
    $('#npFind').focus(); $('#npFind').select();
    this.navRefresh();
  },
  findNext() {
    const ranges = this.navMatches || [];
    if (!ranges.length) return;
    this.navIdx = ((this.navIdx ?? -1) + 1) % ranges.length;
    Ed.showMatches(ranges, this.navIdx); Ed.selectRange(ranges[this.navIdx]);
  },
  navRefresh: debounce(function () {
    if (!document.body.classList.contains('nav-open')) return;
    const body = $('#npBody'); body.innerHTML = '';
    $$('.np-tabs button').forEach(b => b.classList.toggle('on', b.dataset.np === App.navTab));
    if (App.navTab === 'titles') {
      const hs = $$('h1,h2,h3,h4,h5,h6', Ed.editor).filter(h => h.textContent.trim() && !h.closest('.pl-toc'));
      if (!hs.length) body.append(el('div', { class: 'np-empty' }, ['Aucun titre. Appliquez les styles « Titre 1 », « Titre 2 »… pour structurer votre document : ils apparaîtront ici.']));
      hs.forEach(h => body.append(el('button', { class: 'np-item l' + h.tagName[1], onclick: () => { h.scrollIntoView({ block: 'start' }); const r = document.createRange(); r.selectNodeContents(h); r.collapse(true); Ed.selectRange(r); } }, [h.textContent.trim()])));
    } else if (App.navTab === 'comments') {
      const list = Comments.list();
      if (!list.length) body.append(el('div', { class: 'np-empty' }, ['Aucun commentaire. Sélectionnez du texte puis Révision → Nouveau commentaire.']));
      for (const c of list) {
        const card = el('div', { class: 'np-comment', onclick: e => { if (!e.target.closest('button')) Comments.goto(c.cid); } }, [
          el('div', { class: 'who' }, [c.author || 'Anonyme', el('span', { class: 'when' }, [c.date ? fmtDate(Date.parse(c.date)) : ''])]),
          el('div', { class: 'txt' }, [c.text]),
          el('div', { class: 'acts' }, [el('button', { onclick: () => Comments.edit(c.cid) }, ['Modifier']), el('button', { onclick: () => Comments.remove(c.cid) }, ['Supprimer'])])]);
        body.append(card);
      }
    } else {
      const q = $('#npFind').value;
      const ranges = Ed.find(q);
      App.navMatches = ranges; App.navIdx = -1;
      if (!q) { body.append(el('div', { class: 'np-empty' }, ['Tapez un mot à rechercher. Entrée = résultat suivant.'])); return; }
      body.append(el('div', { class: 'np-empty', style: 'padding:4px 8px' }, [`${ranges.length} résultat${ranges.length > 1 ? 's' : ''}`]));
      ranges.slice(0, 200).forEach((r, i) => {
        const t = r.startContainer.textContent;
        const a = Math.max(0, r.startOffset - 30);
        const snippet = el('span');
        snippet.append((a > 0 ? '…' : '') + t.slice(a, r.startOffset), el('mark', {}, [r.toString()]), r.endContainer === r.startContainer ? t.slice(r.endOffset, r.endOffset + 40) + '…' : '…');
        body.append(el('button', { class: 'np-item', style: 'white-space:normal', onclick: () => { App.navIdx = i; Ed.showMatches(ranges, i); Ed.selectRange(r); } }, [snippet]));
      });
    }
  }, 150),

  /* ---------- Recherche de commandes (Alt+Q) ---------- */
  initCmdSearch() {
    const inp = $('#cmdSearch'), res = $('#cmdResults');
    let sel = 0, items = [];
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const render = () => {
      const q = norm(inp.value.trim());
      items = Object.values(CMD).filter(c => c.icon && (!q || norm(c.label).includes(q))).slice(0, 12);
      res.innerHTML = '';
      items.forEach((c, i) => res.append(el('button', { class: i === sel ? 'sel' : '', onmousedown: e => e.preventDefault(), onclick: () => run(c) }, [icon(c.icon), c.label, c.kbd ? el('span', { class: 'kbd' }, [c.kbd]) : null])));
      res.classList.toggle('open', items.length > 0);
    };
    const run = c => { res.classList.remove('open'); inp.value = ''; inp.blur(); Ed.focus(); c.run(); };
    inp.addEventListener('input', () => { sel = 0; render(); });
    inp.addEventListener('focus', () => { sel = 0; render(); });
    inp.addEventListener('blur', () => setTimeout(() => res.classList.remove('open'), 150));
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); render(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      if (e.key === 'Enter' && items[sel]) { e.preventDefault(); run(items[sel]); }
      if (e.key === 'Escape') { inp.blur(); Ed.focus(); }
    });
  },

  /* ---------- Raccourcis clavier ---------- */
  initKeys() {
    document.addEventListener('keydown', e => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const inField = e.target.closest && e.target.closest('input,textarea,select') && !e.target.closest('#editor');
      const run = id => { e.preventDefault(); CMD[id].run(); };
      if (e.altKey && k === 'q') { e.preventDefault(); $('#cmdSearch').focus(); return; }
      if (e.key === 'F12') return run('saveAs');
      if (e.key === 'F11') return run('fullscreen');
      if (e.key === 'F7') return run('spell');
      if (mod && e.key === 'F1') { e.preventDefault(); document.body.classList.toggle('ribbon-collapsed'); return; }
      if (!mod) return;
      if (k === 's') return run('save');
      if (k === 'o') return run('open');
      if (k === 'n' && !e.shiftKey) return run('new');
      if (k === 'p') return run('print');
      if (inField) return;
      if (k === 'z' && !e.shiftKey) return run('undo');
      if (k === 'y' || (k === 'z' && e.shiftKey)) return run('redo');
      if (k === 'f' && !e.altKey) return run('find');
      if (k === 'h') return run('replace');
      if (k === 'k') return run('link');
      if (k === 'b') return run('bold');
      if (k === 'i') return run('italic');
      if (k === 'u') return run('underline');
      if (k === 'e') return run('center');
      if (k === 'l') return run('left');
      if (k === 'r') return run('right');
      if (k === 'j') return run('justify');
      if (k === 'd') return run('fontDlg');
      if (k === 'enter') return run('pageBreak');
      if (k === ' ') return run('clear');
      if (e.key === '>' || (e.shiftKey && e.key === '.')) return run('grow');
      if (e.key === '<' || (e.shiftKey && e.key === ',')) return run('shrink');
      if (e.key === '=' || e.key === '+') return run(e.shiftKey ? 'sup' : 'sub');
      if (e.key === '*') return run('marks');
      if (e.altKey && k === 'f') return run('footnote');
      if (e.altKey && k === 'm') return run('comment');
      if (e.shiftKey && k === 'e') return run('track');
      if (e.altKey && ['1', '2', '3'].includes(e.key)) return run('style:h' + e.key);
      if (e.shiftKey && k === 'n') return run('style:p');
      if (e.shiftKey && k === 'l') return run('bullets');
    });
  },

  async user() { return localStorage.getItem('plume-user') || ''; },
  setUser(n) { localStorage.setItem('plume-user', n || ''); }
};

/** Markdown minimal → HTML (titres, listes, gras, italique, liens) */
function mdToHtml(md) {
  const inline = s => htmlEsc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<span style="font-family:monospace">$1</span>').replace(/\[(.+?)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  let out = '', list = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^(#{1,6})\s+(.*)/), ul = line.match(/^\s*[-*+]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    const want = ul ? 'ul' : ol ? 'ol' : null;
    if (list && want !== list) { out += `</${list}>`; list = null; }
    if (want && !list) { out += `<${want}>`; list = want; }
    if (h) out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
    else if (want) out += `<li>${inline((ul || ol)[1])}</li>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  if (list) out += `</${list}>`;
  return out || '<p><br></p>';
}

window.addEventListener('DOMContentLoaded', () => App.init());
App.openBackstage = s => Backstage.open(s);

/* =====================================================================
   Commentaires et suivi des modifications
   ===================================================================== */
const Comments = {
  refs() { return $$('.pl-cref', Ed.editor); },
  list() { return this.refs().map(r => ({ cid: r.dataset.cid, author: r.dataset.author, date: r.dataset.date, text: r.dataset.text || '' })); },
  range(cid) {
    const a = Ed.editor.querySelector(`.pl-cstart[data-cid="${CSS.escape(cid)}"]`);
    const b = Ed.editor.querySelector(`.pl-cend[data-cid="${CSS.escape(cid)}"]`);
    if (!a || !b) return null;
    const r = document.createRange(); r.setStartAfter(a); r.setEndBefore(b); return r;
  },
  highlight() {
    if (!window.CSS || !CSS.highlights) return;
    const rs = this.list().map(c => this.range(c.cid)).filter(Boolean);
    if (rs.length) CSS.highlights.set('plume-comment', new Highlight(...rs)); else CSS.highlights.delete('plume-comment');
  },
  async add() {
    Ed.syncSel();
    const r = Ed.lastRange;
    if (!r || r.collapsed || !Ed.editor.contains(r.commonAncestorContainer)) { toast('Sélectionnez d’abord le texte à commenter'); return; }
    const ta = el('textarea', { rows: 4, style: 'width:100%', placeholder: 'Votre commentaire' });
    const res = await dialog({ title: 'Nouveau commentaire', body: ta, buttons: [{ label: 'Annuler', value: null }, { label: 'Publier', primary: true, value: 'ok' }] });
    if (res !== 'ok' || !ta.value.trim()) return;
    const cid = 'c' + uid();
    const author = localStorage.getItem('plume-user') || Ed.props.author || 'Utilisateur Plume';
    const initials = author.split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase();
    const end = r.cloneRange(); end.collapse(false);
    const ref = el('span', { class: 'pl-cref', contenteditable: 'false', 'data-cid': cid, 'data-author': author, 'data-initials': initials, 'data-date': new Date().toISOString().replace(/\.\d+Z$/, 'Z'), 'data-text': ta.value.trim() });
    end.insertNode(ref);
    end.insertNode(el('span', { class: 'pl-cend', 'data-cid': cid }));
    const start = r.cloneRange(); start.collapse(true);
    start.insertNode(el('span', { class: 'pl-cstart', 'data-cid': cid }));
    Ed.changed(false);
    App.openNav('comments');
  },
  goto(cid) {
    const r = this.range(cid) || (() => { const x = document.createRange(); const ref = Ed.editor.querySelector(`.pl-cref[data-cid="${CSS.escape(cid)}"]`); if (!ref) return null; x.selectNode(ref); return x; })();
    if (r) Ed.selectRange(r);
  },
  async edit(cid) {
    const ref = Ed.editor.querySelector(`.pl-cref[data-cid="${CSS.escape(cid)}"]`);
    if (!ref) return;
    const ta = el('textarea', { rows: 4, style: 'width:100%' }); ta.value = ref.dataset.text || '';
    const res = await dialog({ title: 'Modifier le commentaire', body: ta, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (res === 'ok') { ref.dataset.text = ta.value; Ed.changed(false); App.navRefresh(); }
  },
  remove(cid) {
    $$(`[data-cid="${CSS.escape(cid)}"]`, Ed.editor).forEach(n => n.remove());
    Ed.changed(false); App.navRefresh();
  },
  removeAll() { $$('.pl-cref,.pl-cstart,.pl-cend', Ed.editor).forEach(n => n.remove()); Ed.changed(false); App.navRefresh(); toast('Tous les commentaires ont été supprimés'); }
};
const Revisions = {
  count() { return $$('.pl-ins,.pl-del', Ed.editor).length + $$('.pl-ins,.pl-del', Ed.pagesLayer).length; },
  apply(accept) {
    const roots = [Ed.editor, ...$$('.hf', Ed.pagesLayer)];
    let n = 0;
    for (const root of roots) {
      $$(accept ? '.pl-del' : '.pl-ins', root).forEach(x => { x.remove(); n++; });
      $$(accept ? '.pl-ins' : '.pl-del', root).forEach(x => { x.replaceWith(...x.childNodes); n++; });
    }
    const h = Ed.headerEl(), f = Ed.footerEl();
    if (h) Ed.headerHTML = h.innerHTML; if (f) Ed.footerHTML = f.innerHTML;
    Ed.changed(false);
    toast(n ? `${n} modification(s) ${accept ? 'acceptée(s)' : 'refusée(s)'}` : 'Aucune modification suivie dans ce document');
  }
};
