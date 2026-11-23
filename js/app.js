/* =====================================================================
   Plume — application : fichiers, enregistrement, affichage, raccourcis
   ===================================================================== */
'use strict';

const App = {
  VERSION: '1.4.0',
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
    Ed.onLayout = () => { this.fitWide(); Watermark.render(); Captions.renumber(); this.updateStatus(); Ed.placeHandle && Ed.placeHandle(); this.drawRuler(); Comments.highlight(); Revisions.colorize(); };
    Ed.onOpenFile = f => this.openFile(f);
    $('#docTitle').addEventListener('change', () => { this.dirty = true; this.autosave(); document.title = this.name() + ' — Plume'; });
    $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.fileInputCb(f); });
    $('#exitReading').addEventListener('click', () => this.setReading(false));
    $('#themeBtn').addEventListener('click', () => this.toggleTheme());

    // Démarrage : toujours une page blanche, jamais le dernier document (ordinateurs partagés, écoles).
    // L'écran d'accueil propose un document vierge ou l'ouverture d'un fichier (ordinateur, clé USB…).
    this.newDoc('blank', true);
    try { await Store.setKV('lastDoc', null); } catch { /* stockage indisponible */ }
    const quiet = new URLSearchParams(location.search).has('new') || navigator.webdriver;
    if (!quiet) setTimeout(() => { if (!this._launched) Backstage.open('home'); }, 50);

    // Ouverture depuis le système (application installée)
    // Application de bureau (Electron) : fichiers ouverts depuis l'Explorateur / le Finder
    if (window.plumeDesktop) {
      document.documentElement.classList.add('desktop');
      window.plumeDesktop.onOpenFile(f => this.openFile(new File([f.data], f.name), null, f.path));
      window.plumeDesktop.onQuitRequested(() => this.requestQuit());
    }
    if ('launchQueue' in window) {
      launchQueue.setConsumer(async p => { if (p.files && p.files.length) { this._launched = true; const h = p.files[0]; this.openFile(await h.getFile(), h); } });
    }
    if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.plumeDesktop && !(window.Native && Native.on)) navigator.serviceWorker.register('sw.js').catch(() => { });
    this.initUpdates();
    window.addEventListener('beforeunload', e => { if (!this._quitAllowed && this.dirty && !(this.savedLocally && this.keepLocal())) { e.preventDefault(); e.returnValue = ''; } });
    Ed.editor.focus();
    if (!localStorage.getItem('plume-guide-vu') && !navigator.webdriver) { localStorage.setItem('plume-guide-vu', '1'); setTimeout(() => Guide.open(), 600); }
    // petits écrans : la page s'adapte à la largeur
    if ($('#canvas').clientWidth < (Ed.sheetW || Ed.page.w) + 40) this.fitWidth();
  },

  /** Tableaux plus larges que la page : réduits à l'affichage seulement (le fichier garde ses largeurs) */
  fitWide() {
    // documents à plusieurs sections : chaque page a sa propre largeur, gérée par la mise en page
    if (Ed.sections && Ed.sections().length > 1) { $$('table[style*="zoom"]', Ed.editor).forEach(t => t.style.zoom = ''); return; }
    const cs = getComputedStyle(Ed.editor), er = Ed.editor.getBoundingClientRect();
    const right = er.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
    let changed = false;
    for (const t of Ed.editor.querySelectorAll('table')) {
      if (t.parentElement.closest('table')) continue;
      const z0 = parseFloat(t.style.zoom) || 1;
      const r = t.getBoundingClientRect();
      const natural = r.width / z0, avail = right - r.left;
      const z = natural > avail + 1 && avail > 50 ? Math.max(0.3, Math.floor(avail / natural * 1000) / 1000) : 1;
      if (Math.abs(z - z0) > 0.002) { t.style.zoom = z === 1 ? '' : String(z); changed = true; }
    }
    if (changed && Ed.relayout) Ed.relayout();
  },

  /* ---------- Mises à jour : toutes les versions de Plume restent à jour ---------- */
  RELEASES: 'https://github.com/asblPixels/Plume/releases/latest',
  ONLINE: 'https://asblpixels.github.io/Plume/',
  updateBar(html, actions) {
    $('#updateBar') && $('#updateBar').remove();
    const bar = el('div', { id: 'updateBar', role: 'status' }, [el('span', { html })]);
    for (const [label, fn, primary] of actions) bar.append(el('button', { class: primary ? 'primary' : '', onclick: fn }, [label]));
    bar.append(el('button', { class: 'x', title: 'Plus tard', onclick: () => bar.remove() }, ['×']));
    document.body.append(bar);
  },
  initUpdates() {
    const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    // application de bureau : la mise à jour est téléchargée en arrière-plan, appliquée au redémarrage
    if (window.plumeDesktop && window.plumeDesktop.update) {
      const ready = v => this.updateBar(`<b>Plume ${htmlEsc(v)}</b> est prêt : redémarrez pour profiter des nouveautés.`, [['Redémarrer', async () => { if (this.dirty) { const ok = await new Promise(r => dialog({ title: 'Redémarrer Plume', body: '<p>Le document n’est pas enregistré. Redémarrer quand même ?</p>', buttons: [{ label: 'Annuler', onClick: () => r(false) }, { label: 'Redémarrer', primary: true, onClick: () => r(true) }] })); if (!ok) return; } this.dirty = false; window.plumeDesktop.update.restart(); }, true]]);
      window.plumeDesktop.update.onReady(ready);
      window.plumeDesktop.update.state().then(st => { if (st && st.ready) ready(st.available); }).catch(() => { });
      return;
    }
    // téléphone / tablette (APK, iPhone) : la version en ligne est toujours la plus récente
    if (window.Native && Native.on) {
      fetch(this.ONLINE + 'version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => {
        if (v && newer(v.version, this.VERSION)) this.updateBar(`Nouvelle version <b>Plume ${htmlEsc(v.version)}</b> disponible.`, [['Télécharger', () => window.open(this.RELEASES, '_blank'), true]]);
      }).catch(() => { });
      return;
    }
    // navigateur / application installée depuis le navigateur : le service worker se met à jour seul
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      let shown = false, had = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!had) { had = true; return; }   // première installation : rien de nouveau
        if (shown) return; shown = true;
        if (!this.dirty && $('#backstage').classList.contains('open')) { location.reload(); return; }
        this.updateBar('Une nouvelle version de <b>Plume</b> est disponible.', [['Recharger', () => { if (this.dirty) { dialog({ title: 'Recharger Plume', body: '<p>Enregistrez d’abord votre document : il serait perdu au rechargement.</p>', buttons: [{ label: 'OK', primary: true }] }); return; } location.reload(); }, true]]);
      });
      navigator.serviceWorker.getRegistration().then(r => r && setInterval(() => r.update().catch(() => { }), 30 * 60 * 1000)).catch(() => { });
    }
  },

  name() { return ($('#docTitle').value || 'Document').trim(); },

  /* ---------- Fermeture partagée : Windows, Linux, macOS et mobile ---------- */
  async requestQuit() {
    if (this._closing) return;
    this._closing = true;
    try {
      if (this.dirty) {
        const action = await dialog({
          title: 'Quitter Plume',
          body: '<p>Ce document contient des modifications non enregistrées.</p><p>Que souhaitez-vous faire ?</p>',
          buttons: [
            { label: 'Annuler', value: 'cancel' },
            { label: 'Quitter sans enregistrer', value: 'discard' },
            { label: 'Enregistrer et quitter', value: 'save', primary: true }
          ]
        });
        if (!action || action === 'cancel') return;
        if (action === 'save') {
          await this.save();
          // L'enregistrement peut être annulé ou échouer. Ne jamais quitter
          // tant que le document comporte des modifications non enregistrées.
          if (this.dirty) return;
        }
      }
      if (window.plumeDesktop && window.plumeDesktop.quit) {
        this._quitAllowed = true;
        try {
          const approved = await window.plumeDesktop.quit();
          if (!approved) this._quitAllowed = false;
        } catch (error) {
          this._quitAllowed = false;
          throw error;
        }
      } else if (window.Native && Native.on) {
        const appPlugin = Native.plugin('App');
        if (appPlugin && appPlugin.exitApp) await appPlugin.exitApp();
        else if (appPlugin && appPlugin.minimizeApp) await appPlugin.minimizeApp();
      } else {
        // Les navigateurs interdisent généralement window.close() sur un
        // onglet ouvert par l'utilisateur. Proposer une instruction fiable.
        await dialog({ title: 'Fermer Plume',
          body: '<p>Vous pouvez fermer cet onglet ou cette fenêtre dans votre navigateur.</p>',
          buttons: [{ label: 'OK', primary: true }]
        });
      }
    } finally {
      this._closing = false;
    }
  },

  /* ---------- Documents ---------- */
  async newDoc(tpl = 'blank', silent) {
    if (!silent && this.dirty && typeof PdfEditor !== 'undefined' && PdfEditor.active) {
      const answer = await dialog({ title: 'PDF non enregistré',
        body: '<p>Des modifications du PDF ne sont pas encore enregistrées. Ouvrir un nouveau document les abandonnera.</p>',
        buttons: [{ label: 'Continuer le PDF', value:false }, { label: 'Abandonner les modifications', value:true, primary:true }] });
      if (!answer) return;
    }
    if (!silent && this.dirty) await this.flushAutosave();
    if (typeof PdfEditor !== 'undefined' && PdfEditor.active) PdfEditor.close();
    const t = TEMPLATES[tpl] || TEMPLATES.blank;
    this.docId = uid(); this.fileHandle = null; this.desktopPath = null; this.format = 'docx'; Ed.source = null;
    this.infoBar(null);
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
  },
  async openStored(id, silent) {
    if (typeof PdfEditor !== 'undefined' && PdfEditor.active) PdfEditor.close();
    const d = await Store.getDoc(id).catch(() => null);
    if (!d) return false;
    this.docId = d.id; this.fileHandle = null; this.desktopPath = null; this.format = d.format || 'docx';
    Ed.source = d.source ? { zip: await JSZip.loadAsync(d.source), bytes: d.source } : null;
    this.macroBar();
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
    this._launched = true;
    if ($('#backstage').classList.contains('open')) Backstage.close();
    const base = file.name.replace(/\.[^.]+$/, '');
    try {
      if (this.dirty && typeof PdfEditor !== 'undefined' && PdfEditor.active) {
        const answer = await dialog({ title: 'PDF non enregistré',
          body: '<p>Ce PDF contient des modifications non enregistrées. Ouvrir un autre fichier les abandonnera.</p>',
          buttons: [{ label:'Annuler', value:false }, { label:'Abandonner les modifications', value:true, primary:true }] });
        if (!answer) return;
      }
      if (this.dirty) await this.flushAutosave();
      this.setSaveState('Ouverture…');
      const r = await Formats.open(file, { registerImage: b => Ed.registerImage(b) });
      if (r.pdfBytes) {
        await PdfEditor.open(r.pdfBytes);
        this.docId = uid(); this.format = 'pdf'; Ed.source = null;
        this.fileHandle = handle; this.desktopPath = desktopPath;
        $('#docTitle').value = base;
        document.title = this.name() + ' — Plume PDF';
        this.dirty = false; this.savedLocally = false;
        this.setSaveState('PDF original');
        this.infoBar({ icon: 'info', html: 'PDF affiché sans conversion. Les annotations conservent les pages originales. Modifier ou supprimer un texte aplatit uniquement sa page lors de l’export ; signatures numériques et éléments interactifs peuvent être affectés.' });
        return;
      }
      if (typeof PdfEditor !== 'undefined' && PdfEditor.active) PdfEditor.close();
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
        settings: { fontCss: s.fontCss, size: s.size, lineHeight: s.lineHeight, after: s.after, before: s.before, color: s.color, heading: '#0B5E4E', tableStyles: s.tableStyles || {}, normalDefs: s.normalDefs || TableStyles.PLUME_NORMAL_DEFS.slice() }
      });
      this.afterOpen();
      this.dirty = false;
      await this.flushAutosave(true);
      toast(`<b>${htmlEsc(file.name)}</b> ouvert`);
      // bandeau d'information permanent (macros, contenu partiel d'un ancien .doc…)
      if (!this.macroBar()) this.infoBar(r.partial ? { icon: 'info', html: r.notice } : null);
      if (r.notice && !r.partial) setTimeout(() => toast(r.notice, 7000), 2700);
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
  async buildDocx() { return Ed.withCleanDom(() => DocxExport.exportDocx(this.exportCtx())); },
  fileName(ext) { return this.name().replace(/[\\/:*?"<>|]/g, '_') + '.' + ext; },
  /** Le document ouvert contient-il des macros VBA (conservées, jamais exécutées) ? */
  hasMacros() { return !!(Ed.source && DocxExport.hasMacros(Ed.source.zip)); },
  /** Bandeau d'information sous le ruban (null : masqué) */
  infoBar(info) {
    const bar = $('#infoBar');
    if (!bar) return;
    if (!info) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.innerHTML = '';
    bar.append(icon(info.icon || 'info'), el('span', { class: 'ib-text', html: info.html }), el('button', { class: 'ib-close', title: 'Fermer', onclick: () => this.infoBar(null) }, [icon('x')]));
    bar.hidden = false;
  },
  macroBar() {
    const on = this.hasMacros();
    if (on) this.infoBar({ icon: 'lock', html: '<b>Macros</b> — Ce document contient des macros : elles sont conservées mais jamais exécutées. Enregistrez-le en <b>.docm</b> (ou <b>.dotm</b> pour un modèle) pour les garder.' });
    else this.infoBar(null);
    return on;
  },
  /** Ctrl+S : même format que le fichier ouvert s'il est réinscriptible, sinon .docx */
  async save(asNew = false) {
    const fmt = typeof PdfEditor !== 'undefined' && PdfEditor.active ? 'pdf' :
      (!asNew && (Formats.SAVABLE.has(this.format) || (this.format === 'doc' && window.plumeDesktop))) ? this.format : 'docx';
    return this.saveAs(fmt, asNew);
  },
  async saveAs(fmt = 'docx', asNew = true) {
    if (typeof PdfEditor !== 'undefined' && PdfEditor.active && fmt !== 'pdf') {
      dialog({ title: 'Document PDF', body: '<p>Ce document PDF conserve sa structure originale. Seul l’enregistrement au format PDF est disponible dans ce mode.</p>', buttons: [{ label: 'OK', primary: true }] });
      return;
    }
    // macros : un .docx ou .dotx ne peut pas les contenir → avertissement et choix
    if ((fmt === 'docx' || fmt === 'dotx') && this.hasMacros()) {
      const keep = fmt === 'dotx' ? 'dotm' : 'docm';
      const r = await dialog({
        title: 'Ce document contient des macros',
        body: `<p style="line-height:1.55">Le format <b>.${fmt}</b> ne peut pas contenir de macros : elles seront <b>retirées</b> du fichier enregistré (le document d’origine n’est pas modifié).</p><p style="line-height:1.55;color:var(--ui-fg-2)">Pour les conserver, enregistrez en <b>.${keep}</b>. Plume n’exécute jamais les macros.</p>`,
        buttons: [{ label: 'Annuler', value: null }, { label: `Enregistrer en .${keep}`, value: keep }, { label: `Enregistrer en .${fmt} sans macros`, primary: true, value: fmt }]
      });
      if (!r) return;
      if (r !== fmt) { fmt = r; asNew = true; }
    }
    const info = Formats.EXPORT[fmt];
    try {
      this.setSaveState('Enregistrement…');
      if (fmt === 'pdf' && !(window.plumeDesktop && window.plumeDesktop.printToPdf)) this.setSaveState('Création du PDF…');
      // PDF vectoriel (application de bureau) : rendu d'impression ; PDF direct : pages affichées telles quelles
      const vector = fmt === 'pdf' && !(typeof PdfEditor !== 'undefined' && PdfEditor.active) && window.plumeDesktop && window.plumeDesktop.printToPdf;
      if (vector) this.preparePrint();
      const blob = typeof PdfEditor !== 'undefined' && PdfEditor.active ? await PdfEditor.exportPdf() : await Formats.build(fmt, this.exportCtx());
      if (vector) this.endPrint();
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
    // En mode PDF, la source et ses modifications restent en mémoire : aucune
    // copie de secours simplifiée susceptible de détruire la mise en page.
    if (typeof PdfEditor !== 'undefined' && PdfEditor.active) { this.savedLocally = false; return; }
    // mode confidentiel (par défaut) : rien n'est écrit sur l'appareil
    if (!this.keepLocal()) { this.savedLocally = false; return; }
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
    const cm = v => U.pxToCm(v).toFixed(2) + 'cm';
    const page = p => `size: ${cm(p.w)} ${cm(p.h)}; margin: ${cm(p.mt)} ${cm(p.mr)} ${cm(p.mb)} ${cm(p.ml)};`;
    // une page nommée par section : tailles et orientations différentes à l'impression
    const secs = Ed.sections();
    let css = `@page { ${page(secs[0])} }\n`;
    if (secs.length > 1) {
      secs.forEach((s, i) => { css += `@page plsec${i} { ${page(s)} }\n`; });
      let si = 0;
      Array.from(Ed.editor.children).forEach((b, k) => { css += `#editor > :nth-child(${k + 1}){page:plsec${si}}\n`; if (b.matches('hr.pl-section')) si++; });
    }
    st.textContent = css + '@media print { .print-hf .pl-field[data-field="page"]{display:none} }';
    Ed.stripArtifacts();
    Ed._clean = 1;
    this._push = $('#pushStyle').textContent; $('#pushStyle').textContent = '';
    this.preparePrintComments();
  },
  /** Impression avec les commentaires (numérotés, listés en fin de document) ou sans (document final) */
  preparePrintComments() {
    let box = $('#printComments');
    if (!box) { box = el('div', { id: 'printComments' }); document.body.append(box); }
    box.innerHTML = '';
    document.body.classList.toggle('print-markup', !!this.printMarkup);
    document.body.classList.toggle('print-clean', !this.printMarkup);
    if (!this.printMarkup) { if (window.CSS && CSS.highlights) { CSS.highlights.delete('plume-comment'); CSS.highlights.delete('plume-comment-done'); } return; }
    const list = Comments.list();
    if (!list.length) return;
    box.append(el('h2', {}, ['Commentaires']));
    list.forEach((c, i) => {
      const ref = Comments.ref(c.cid); if (ref) ref.dataset.n = i + 1;
      const line = (x, reply, n) => el('div', { class: 'pc' + (reply ? ' reply' : '') }, [el('b', {}, [n]), el('b', {}, [(x.author || 'Anonyme') + ' :']), x.text, ' ', el('span', { class: 'st' }, [x.date && !isNaN(Date.parse(x.date)) ? '(' + fmtDate(Date.parse(x.date)) + ')' : ''])]);
      box.append(line(c, false, `[${i + 1}]${c.done ? ' (résolu)' : ''}`));
      c.replies.forEach(r => box.append(line(r, true, '↳')));
    });
  },
  endPrint() {
    if (this._push !== undefined) { $('#pushStyle').textContent = this._push; this._push = undefined; Ed._clean = 0; Ed._layout(); }
    document.body.classList.remove('print-markup', 'print-clean');
    $$('.pl-cref[data-n]', Ed.editor).forEach(r => r.removeAttribute('data-n'));
    Comments.highlight();
  },
  print() {
    if (typeof PdfEditor !== 'undefined' && PdfEditor.active) { window.print(); return; }
    if (Native.on) { dialog({ title: 'Imprimer', body: '<p style="line-height:1.55">Sur téléphone ou tablette, créez un <b>PDF</b> puis utilisez le bouton <b>Partager</b> pour l’envoyer à une imprimante ou à une autre application.</p>', buttons: [{ label: 'Créer le PDF', primary: true, onClick: () => { App.saveAs('pdf'); } }, { label: 'Fermer' }] }); return; }
    this.preparePrint();
    setTimeout(() => { window.print(); this.endPrint(); }, 50);
  },
  async htmlDocument() {
    const st = await Ed.getState();
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="Plume"><title>${htmlEsc(this.name())}</title><style>body{font-family:${Ed.settings.fontCss};font-size:${Ed.settings.size}pt;line-height:${Ed.settings.lineHeight};max-width:${Math.round(Ed.contentWidth())}px;margin:40px auto;padding:0 20px}p{margin:0 0 ${Ed.settings.after}pt}table{border-collapse:collapse}td,th{border:1px solid #000;padding:2px 7px;vertical-align:top}table[data-borders=none] td{border:0}img{max-width:100%;height:auto}h1,h2,h3{color:${Ed.settings.heading}}.pl-pagebreak,.pl-section{border:0;page-break-after:always}.pl-colbreak{border:0}.pl-toc .toc-upd{display:none}.toc-line{display:flex}.toc-line .dots{flex:1;border-bottom:1px dotted #777;margin:0 4px 4px}.pl-del{text-decoration:line-through;color:#B42318}.pl-ins{text-decoration:underline;color:#1F6F43}.pl-island-box{display:inline-block;border:1px solid #ddd}</style></head><body>${st.header ? `<header>${st.header}</header>` : ''}${st.html}${st.footer ? `<footer>${st.footer}</footer>` : ''}</body></html>`;
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
  /* Mise en page : s'applique à la section du curseur (tout le document s'il n'y en a qu'une) */
  setMargins([t, r, b, l]) { Ed.updateSect(Ed.curSectIndex(), p => Object.assign(p, { mt: U.cmToPx(t), mr: U.cmToPx(r), mb: U.cmToPx(b), ml: U.cmToPx(l) })); this.pageChanged(); },
  setOrientation(o) {
    Ed.updateSect(Ed.curSectIndex(), p => { if ((o === 'landscape') !== (p.w > p.h)) [p.w, p.h] = [p.h, p.w]; });
    this.pageChanged();
  },
  setSize(k) {
    const [w, h] = PAGE_SIZES[k];
    Ed.updateSect(Ed.curSectIndex(), p => { const land = p.w > p.h; p.w = U.cmToPx(land ? h : w); p.h = U.cmToPx(land ? w : h); });
    this.pageChanged();
  },
  setColumns(k) { Ed.setColumns(k); this.drawRuler(); },
  pageChanged() { Ed._layout(); Ed.changed(false); this.drawRuler(); },
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
  fitWidth() { this.setZoom(($('#canvas').clientWidth - 40) / (Ed.sheetW || Ed.page.w)); },
  fitPage() { const g = Ed.caretGeom(), pg = (Ed.pages || Ed.defaultPages())[Ed.caretPage()] || Ed.page; this.setZoom(Math.min(($('#canvas').clientHeight - 50) / pg.h, ($('#canvas').clientWidth - 40) / Math.max(g.w, Ed.sheetW || g.w))); },
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
    const z = Ed.zoom, g = Ed.caretGeom(), si = Ed.curSectIndex();
    const p = { w: g.w, ml: g.ml, mr: g.mr };
    ruler.style.left = (s.left - w.left + g.x * z) + 'px';
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
        };
        const up = () => { h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); Ed.updateSect(si, sp => { sp.ml = p.ml; sp.mr = p.mr; }); this.pageChanged(); };
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
      Comments.renderPane(body);
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
      if (mod && !e.shiftKey && !e.altKey && k === 'q') { e.preventDefault(); this.requestQuit(); return; }
      if (e.key === 'F12') return run('saveAs');
      if (e.key === 'F11') return run('fullscreen');
      if (e.key === 'F7') return run('spell');
      if (mod && e.key === 'F1') { e.preventDefault(); document.body.classList.toggle('ribbon-collapsed'); return; }
      if (!mod) return;
      if (k === 's') return run('save');
      if (k === 'o') return run('open');
      if (k === 'n' && !e.shiftKey) return run('new');
      if (k === 'p' && e.shiftKey) return run('exportPdf');
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
      if (k === 'enter') return run(e.shiftKey ? 'colBreak' : 'pageBreak');
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

  async user() { return localStorage.getItem('plume-user') || sessionStorage.getItem('plume-user') || ''; },
  setUser(n) { (this.keepLocal() ? localStorage : sessionStorage).setItem('plume-user', n || ''); },
  /** Copie de secours des documents sur l'appareil : désactivée par défaut (aucune donnée persistante) */
  keepLocal() { try { return localStorage.getItem('plume-memoire') === 'on'; } catch { return false; } },
  async setKeepLocal(on) {
    try { localStorage.setItem('plume-memoire', on ? 'on' : 'off'); } catch { }
    if (on) { await this.flushAutosave(true); toast('Copie de secours <b>activée</b> sur cet appareil.'); }
    else { await this.purgeLocal(); toast('Mode confidentiel : <b>rien n’est gardé</b> sur cet appareil.'); }
  },
  /** Efface toutes les copies de documents gardées sur l'appareil */
  async purgeLocal() {
    try {
      for (const d of await Store.listDocs()) await Store.delDoc(d.id);
      await Store.setKV('lastDoc', null);
      localStorage.removeItem('plume-user');
    } catch { /* stockage indisponible */ }
  }
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
  expanded: new Set(),       // fils résolus dépliés dans le volet
  refs() { return $$('.pl-cref', Ed.editor); },
  ref(cid) { return Ed.editor.querySelector(`.pl-cref[data-cid="${CSS.escape(cid)}"]`); },
  data(r) { return { cid: r.dataset.cid, author: r.dataset.author, initials: r.dataset.initials, date: r.dataset.date, text: r.dataset.text || '', parent: r.dataset.parent || null, done: r.dataset.done === '1' }; },
  /** Fils de discussion : commentaires racines (dans l'ordre du document) et leurs réponses */
  list() {
    const all = this.refs();
    const ids = new Set(all.map(r => r.dataset.cid));
    const roots = all.filter(r => !r.dataset.parent || !ids.has(r.dataset.parent));
    return roots.map(r => ({ ...this.data(r), parent: null, replies: all.filter(x => x.dataset.parent === r.dataset.cid && x !== r).map(x => this.data(x)).map((x, i) => [x, i]).sort((a, b) => (Date.parse(a[0].date) || 0) - (Date.parse(b[0].date) || 0) || a[1] - b[1]).map(x => x[0]) }));
  },
  rootOf(cid) { const r = this.ref(cid); return r && r.dataset.parent && this.ref(r.dataset.parent) ? r.dataset.parent : cid; },
  author() { return localStorage.getItem('plume-user') || sessionStorage.getItem('plume-user') || Ed.props.author || 'Utilisateur Plume'; },
  initials(a) { return a.split(/\s+/).map(w => w[0] || '').join('').slice(0, 3).toUpperCase(); },
  stamp() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); },
  range(cid) {
    const a = Ed.editor.querySelector(`.pl-cstart[data-cid="${CSS.escape(cid)}"]`);
    const b = Ed.editor.querySelector(`.pl-cend[data-cid="${CSS.escape(cid)}"]`);
    if (!a || !b) return null;
    const r = document.createRange(); r.setStartAfter(a); r.setEndBefore(b); return r;
  },
  highlight() {
    if (!window.CSS || !CSS.highlights) return;
    const open = [], done = [];
    for (const c of this.list()) { const r = this.range(c.cid); if (r) (c.done ? done : open).push(r); }
    if (open.length) CSS.highlights.set('plume-comment', new Highlight(...open)); else CSS.highlights.delete('plume-comment');
    if (done.length) CSS.highlights.set('plume-comment-done', new Highlight(...done)); else CSS.highlights.delete('plume-comment-done');
  },
  async ask(title, value = '') {
    const ta = el('textarea', { rows: 4, style: 'width:100%', placeholder: 'Votre commentaire' }); ta.value = value;
    const res = await dialog({ title, body: ta, onOpen: () => ta.focus(), buttons: [{ label: 'Annuler', value: null }, { label: 'Publier', primary: true, value: 'ok' }] });
    return res === 'ok' && ta.value.trim() ? ta.value.trim() : null;
  },
  newRef(text, extra = {}) {
    const author = this.author();
    return el('span', { class: 'pl-cref', contenteditable: 'false', 'data-cid': 'c' + uid(), 'data-author': author, 'data-initials': this.initials(author), 'data-date': this.stamp(), 'data-text': text, ...extra });
  },
  async add(text) {
    Ed.syncSel();
    const r = Ed.lastRange;
    if (!r || r.collapsed || !Ed.editor.contains(r.commonAncestorContainer)) { toast('Sélectionnez d’abord le texte à commenter'); return; }
    if (text == null) text = await this.ask('Nouveau commentaire');
    if (!text) return;
    const ref = this.newRef(text);
    const cid = ref.dataset.cid;
    const end = r.cloneRange(); end.collapse(false);
    end.insertNode(ref);
    end.insertNode(el('span', { class: 'pl-cend', 'data-cid': cid }));
    const start = r.cloneRange(); start.collapse(true);
    start.insertNode(el('span', { class: 'pl-cstart', 'data-cid': cid }));
    Ed.changed(false);
    App.openNav('comments');
    return cid;
  },
  /** Répond à un fil : la réponse partage l'ancrage du commentaire racine (comme Word) */
  async reply(cid, text) {
    const root = this.rootOf(cid), rr = this.ref(root);
    if (!rr) return;
    if (text == null) text = await this.ask('Répondre à ' + (rr.dataset.author || 'ce commentaire'));
    if (!text) return;
    const ref = this.newRef(text, { 'data-parent': root });
    const thread = this.refs().filter(x => x === rr || x.dataset.parent === root);
    thread[thread.length - 1].after(ref);
    Ed.changed(false); App.navRefresh();
    return ref.dataset.cid;
  },
  /** Résout ou rouvre un fil */
  resolve(cid, done) {
    const rr = this.ref(this.rootOf(cid));
    if (!rr) return;
    if (done === undefined) done = rr.dataset.done !== '1';
    if (done) rr.dataset.done = '1'; else delete rr.dataset.done;
    this.expanded.delete(rr.dataset.cid);
    Ed.changed(false); this.highlight(); App.navRefresh();
  },
  goto(cid) {
    cid = this.rootOf(cid);
    const r = this.range(cid) || (() => { const x = document.createRange(); const ref = this.ref(cid); if (!ref) return null; x.selectNode(ref); return x; })();
    if (r) Ed.selectRange(r);
    this.current = cid;
    $$('#npBody .np-thread').forEach(t => t.classList.toggle('cur', t.dataset.cid === cid));
  },
  /** Commentaire précédent / suivant par rapport au curseur */
  move(dir) {
    const list = this.list();
    if (!list.length) { toast('Aucun commentaire dans ce document'); return; }
    const anchor = c => Ed.editor.querySelector(`.pl-cstart[data-cid="${CSS.escape(c.cid)}"]`) || this.ref(c.cid);
    Ed.syncSel();
    const cur = Ed.lastRange;
    let idx = list.findIndex(c => c.cid === this.current);
    if (cur && Ed.editor.contains(cur.commonAncestorContainer)) {
      const pos = c => { const r = document.createRange(); r.setStartBefore(anchor(c)); return r.compareBoundaryPoints(Range.START_TO_START, cur); };
      if (dir > 0) { const i = list.findIndex(c => pos(c) > 0 && c.cid !== this.current); idx = i >= 0 ? i : 0; }
      else { let i = -1; list.forEach((c, k) => { if (pos(c) < 0 && c.cid !== this.current) i = k; }); idx = i >= 0 ? i : list.length - 1; }
    } else idx = (idx + dir + list.length) % list.length;
    App.openNav('comments');
    this.goto(list[idx].cid);
    return list[idx].cid;
  },
  async edit(cid) {
    const ref = this.ref(cid);
    if (!ref) return;
    const t = await this.ask('Modifier le commentaire', ref.dataset.text || '');
    if (t) { ref.dataset.text = t; Ed.changed(false); App.navRefresh(); }
  },
  /** Supprime un commentaire ; pour un commentaire racine, tout le fil (réponses comprises) */
  remove(cid) {
    const ref = this.ref(cid);
    if (ref && ref.dataset.parent && this.ref(ref.dataset.parent)) ref.remove();
    else {
      $$('.pl-cref', Ed.editor).filter(x => x.dataset.parent === cid).forEach(x => x.remove());
      $$(`[data-cid="${CSS.escape(cid)}"]`, Ed.editor).forEach(n => n.remove());
    }
    Ed.changed(false); this.highlight(); App.navRefresh();
  },
  removeAll() { $$('.pl-cref,.pl-cstart,.pl-cend', Ed.editor).forEach(n => n.remove()); Ed.changed(false); this.highlight(); App.navRefresh(); toast('Tous les commentaires ont été supprimés'); },
  /** Volet des commentaires : fils de discussion */
  renderPane(body) {
    const list = this.list();
    const head = el('div', { class: 'np-cbar' }, [
      el('button', { title: 'Commentaire précédent', onclick: () => this.move(-1) }, [icon('chevron-left'), 'Précédent']),
      el('button', { title: 'Commentaire suivant', onclick: () => this.move(1) }, ['Suivant', icon('chevron-right')]),
      el('button', { title: 'Nouveau commentaire', onclick: () => this.add() }, [icon('message-square-plus'), 'Nouveau'])]);
    body.append(head);
    if (!list.length) { body.append(el('div', { class: 'np-empty' }, ['Aucun commentaire. Sélectionnez du texte puis Révision → Nouveau commentaire.'])); return; }
    const card = (c, reply) => el('div', { class: 'np-comment' + (reply ? ' reply' : ''), 'data-cid': c.cid }, [
      el('div', { class: 'who' }, [el('span', { class: 'av', style: { background: Revisions.color(c.author) } }, [c.initials || this.initials(c.author || '?')]), el('span', { class: 'nm' }, [c.author || 'Anonyme']), el('span', { class: 'when' }, [c.date && !isNaN(Date.parse(c.date)) ? fmtDate(Date.parse(c.date)) : ''])]),
      el('div', { class: 'txt' }, [c.text]),
      el('div', { class: 'acts small' }, [el('button', { onclick: () => this.edit(c.cid) }, ['Modifier']), reply ? el('button', { onclick: () => this.remove(c.cid) }, ['Supprimer']) : null])]);
    for (const c of list) {
      const open = !c.done || this.expanded.has(c.cid);
      const th = el('div', { class: 'np-thread' + (c.done ? ' done' : '') + (open ? '' : ' folded') + (this.current === c.cid ? ' cur' : ''), 'data-cid': c.cid, onclick: e => {
        if (e.target.closest('button')) return;
        if (c.done && e.target.closest('.np-fold')) { if (this.expanded.has(c.cid)) this.expanded.delete(c.cid); else this.expanded.add(c.cid); App.navRefresh(); return; }
        this.goto(c.cid);
      } });
      if (c.done) th.append(el('div', { class: 'np-fold', title: open ? 'Replier' : 'Déplier' }, [icon(open ? 'chevron-down' : 'chevron-right'), 'Résolu', c.replies.length ? ` · ${c.replies.length} réponse${c.replies.length > 1 ? 's' : ''}` : '']));
      th.append(card(c, false));
      if (c.replies.length) th.append(el('div', { class: 'np-replies' }, c.replies.map(r => card(r, true))));
      th.append(el('div', { class: 'acts' }, [
        c.done ? null : el('button', { onclick: () => this.reply(c.cid) }, ['Répondre']),
        el('button', { onclick: () => this.resolve(c.cid) }, [c.done ? 'Rouvrir' : 'Résoudre']),
        el('button', { onclick: () => this.remove(c.cid) }, ['Supprimer le fil'])]));
      body.append(th);
    }
  }
};

/* ---------- Révisions : affichage, navigation, acceptation / refus ---------- */
const Revisions = {
  view: 'all',             // all = toutes les marques, simple = marques simples, none = aucune marque, original
  PALETTE: ['#C0392B', '#1E63B5', '#1F7A3E', '#8E44AD', '#B9770E', '#0E7C86', '#C2185B', '#5D4037'],
  SEL: '.pl-ins,.pl-del,.pl-fmt,[data-pins-author],[data-pdel-author]',
  roots() { return [Ed.editor, ...$$('.hf', Ed.pagesLayer)]; },
  /** Révisions (dans l'ordre du document) : {el, kind} — kind = ins, del, fmt, pins, pdel */
  items(root = Ed.editor) {
    const out = [];
    for (const e of $$(this.SEL, root)) {
      if (e.classList.contains('pl-ins')) out.push({ el: e, kind: 'ins' });
      else if (e.classList.contains('pl-del')) out.push({ el: e, kind: 'del' });
      else if (e.classList.contains('pl-fmt')) out.push({ el: e, kind: 'fmt' });
      if (e.dataset.pinsAuthor != null) out.push({ el: e, kind: 'pins' });
      if (e.dataset.pdelAuthor != null) out.push({ el: e, kind: 'pdel' });
    }
    // une marque de paragraphe se trouve en fin de bloc : tri par position réelle
    if (out.some(x => /^p/.test(x.kind))) {
      const pos = out.map(x => this.startOf(x));
      const idx = out.map((x, i) => i).sort((a, b) => pos[a].compareBoundaryPoints(Range.START_TO_START, pos[b]) || a - b);
      return idx.map(i => out[i]);
    }
    return out;
  },
  count() { return this.roots().reduce((n, r) => n + this.items(r).length, 0); },
  authorOf(it) { return it.kind === 'pins' ? it.el.dataset.pinsAuthor : it.kind === 'pdel' ? it.el.dataset.pdelAuthor : it.el.dataset.author; },
  /** Couleur stable par auteur (ordre d'apparition dans le document) */
  authors() {
    const a = [];
    for (const r of this.roots()) for (const it of this.items(r)) { const n = this.authorOf(it) || ''; if (!a.includes(n)) a.push(n); }
    for (const c of Comments.refs()) if (!a.includes(c.dataset.author || '')) a.push(c.dataset.author || '');
    return a;
  },
  color(author) { const a = this.authors(); const i = a.indexOf(author || ''); return this.PALETTE[(i < 0 ? a.length : i) % this.PALETTE.length]; },
  colorize() {
    const a = this.authors();
    for (const r of this.roots()) for (const it of this.items(r)) {
      const v = String(a.indexOf(this.authorOf(it) || '') % this.PALETTE.length);
      const k = it.kind === 'pins' || it.kind === 'pdel' ? 'data-' + it.kind + '-rc' : 'data-rc';
      if (it.el.getAttribute(k) !== v) it.el.setAttribute(k, v);
    }
  },
  /** Accepte ou refuse une révision */
  resolveItem(it, accept) {
    const e = it.el;
    if (!e.isConnected) return;
    const unwrap = () => { e.removeAttribute('contenteditable'); e.replaceWith(...e.childNodes); };
    switch (it.kind) {
      case 'ins': if (accept) unwrap(); else e.remove(); break;
      case 'del': if (accept) e.remove(); else unwrap(); break;
      case 'fmt':
        if (!accept) {
          // on rétablit l'ancienne mise en forme en rejouant les commandes nécessaires
          let old = {}; try { old = JSON.parse(e.dataset.old || '{}'); } catch { }
          const t = document.createTreeWalker(e, NodeFilter.SHOW_TEXT).nextNode();
          const cur = t ? Track.oldFormat(t) : null;
          if (cur) {
            const r = document.createRange(); r.selectNodeContents(e);
            const s = getSelection(); s.removeAllRanges(); s.addRange(r);
            document.execCommand('styleWithCSS', false, true);
            if (cur.b !== !!old.b) document.execCommand('bold');
            if (cur.i !== !!old.i) document.execCommand('italic');
            if (cur.u !== !!old.u) document.execCommand('underline');
            if (cur.strike !== !!old.strike) document.execCommand('strikeThrough');
          }
        }
        // la marque peut porter elle-même du style (posé par le navigateur) : on ne garde alors que le style
        if (e.isConnected) {
          if (e.getAttribute('style')) { e.removeAttribute('class'); for (const k of ['data-author', 'data-date', 'data-old', 'data-rc']) e.removeAttribute(k); }
          else unwrap();
        }
        break;
      case 'pins':
        if (accept) { e.removeAttribute('data-pins-author'); e.removeAttribute('data-pins-date'); e.removeAttribute('data-pins-rc'); }
        else Track.join(e);
        break;
      case 'pdel':
        if (accept) Track.join(e);
        else { e.removeAttribute('data-pdel-author'); e.removeAttribute('data-pdel-date'); e.removeAttribute('data-pdel-rc'); }
        break;
    }
  },
  afterChange() {
    const h = Ed.headerEl(), f = Ed.footerEl();
    if (h) Ed.headerHTML = h.innerHTML; if (f) Ed.footerHTML = f.innerHTML;
    Ed.editor.normalize();
    Track.tidy();
    Ed.changed(false);
  },
  apply(accept) {
    let n = 0;
    for (const root of this.roots()) {
      // texte d'abord, marques de paragraphe ensuite (les fusions déplacent du contenu)
      const its = this.items(root);
      for (const it of its.filter(x => !/^p/.test(x.kind))) { this.resolveItem(it, accept); n++; }
      for (const it of its.filter(x => /^p/.test(x.kind)).reverse()) { this.resolveItem(it, accept); n++; }
    }
    this.afterChange();
    toast(n ? `${n} modification(s) ${accept ? 'acceptée(s)' : 'refusée(s)'}` : 'Aucune modification suivie dans ce document');
    return n;
  },
  /** Position de départ d'une révision (une marque de paragraphe est située en fin de bloc) */
  startOf(it) {
    const r = document.createRange();
    if (/^p/.test(it.kind)) { r.selectNodeContents(it.el); r.collapse(false); } else r.setStartBefore(it.el);
    return r;
  },
  selectItem(it) {
    const r = document.createRange();
    if (/^p/.test(it.kind)) { r.selectNodeContents(it.el); r.collapse(false); } else r.selectNode(it.el);
    Ed.selectRange(r);
    this.cur = it;
  },
  /** Révisions touchées par la sélection (ou contenant le curseur) */
  atSelection() {
    Ed.syncSel();
    const r = Ed.lastRange;
    if (!r || !Ed.editor.contains(r.commonAncestorContainer)) return [];
    const its = this.items();
    if (!r.collapsed) return its.filter(it => /^p/.test(it.kind) ? Track.crossedBlocks(r).includes(it.el) || (r.intersectsNode(it.el) && r.comparePoint(it.el, it.el.childNodes.length) === 0) : r.intersectsNode(it.el) && r.toString().length > 0 && !(r.compareBoundaryPoints(Range.START_TO_END, this.startOf(it)) <= 0));
    const n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    return its.filter(it => !/^p/.test(it.kind) && it.el.contains(n));
  },
  /** Révision suivante / précédente par rapport au curseur */
  move(dir) {
    const its = this.items();
    if (!its.length) { toast('Aucune modification suivie dans ce document'); return null; }
    Ed.syncSel();
    const cur = Ed.lastRange && Ed.editor.contains(Ed.lastRange.commonAncestorContainer) ? Ed.lastRange : null;
    let it;
    if (!cur) it = dir > 0 ? its[0] : its[its.length - 1];
    else if (dir > 0) {
      const ref = cur.cloneRange(); ref.collapse(false);
      it = its.find(x => x !== this.cur && this.startOf(x).compareBoundaryPoints(Range.START_TO_START, ref) >= 0 && !(this.cur && this.cur.el === x.el && this.cur.kind === x.kind)) || its[0];
    } else {
      const ref = cur.cloneRange(); ref.collapse(true);
      const before = its.filter(x => this.startOf(x).compareBoundaryPoints(Range.START_TO_START, ref) < 0 && !(this.cur && this.cur.el === x.el && this.cur.kind === x.kind));
      it = before[before.length - 1] || its[its.length - 1];
    }
    this.selectItem(it);
    return it;
  },
  /** Accepte / refuse la révision sélectionnée puis passe à la suivante */
  current(accept) {
    let its = this.atSelection();
    if (!its.length) { const it = this.move(1); if (!it) return 0; its = [it]; }
    const end = document.createTextNode('');
    const last = its[its.length - 1];
    if (/^p/.test(last.kind)) last.el.append(end); else last.el.after(end);
    for (const it of its.filter(x => !/^p/.test(x.kind))) this.resolveItem(it, accept);
    for (const it of its.filter(x => /^p/.test(x.kind)).reverse()) this.resolveItem(it, accept);
    if (end.isConnected) { const r = document.createRange(); r.setStartAfter(end); r.collapse(true); end.remove(); Ed.selectRange(r); }
    this.cur = null;
    this.afterChange();
    if (this.items().length) this.move(1);
    return its.length;
  },
  setView(v) {
    this.view = v;
    for (const k of ['simple', 'none', 'original']) document.body.classList.toggle('rv-' + k, v === k);
    document.body.classList.toggle('final-view', v === 'none');
    Ribbon.refresh();
  }
};
