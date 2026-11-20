/* =====================================================================
   Plume — outils avancés
   Suivi des modifications, correction automatique, publipostage,
   dictée, légendes, filigrane, protection du document.
   ===================================================================== */
'use strict';

/* ---------- Suivi des modifications (enregistrement) ---------- */
const Track = {
  on: false,
  author() { return localStorage.getItem('plume-user') || Ed.props.author || 'Utilisateur Plume'; },
  stamp() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); },
  toggle() {
    this.on = !this.on;
    document.body.classList.toggle('tracking', this.on);
    toast(this.on ? 'Suivi des modifications <b>activé</b> : vos ajouts et suppressions sont marqués.' : 'Suivi des modifications <b>désactivé</b>.');
    Ribbon.refresh();
  },
  init() {
    // hors suivi : on ne prolonge pas une marque d'insertion existante
    Ed.editor.addEventListener('beforeinput', e => {
      if (this.on || e.inputType !== 'insertText' || !e.data) return;
      const r = Ed.range();
      if (!r || !r.collapsed) return;
      const n = r.startContainer;
      const ins = (n.nodeType === 3 ? n.parentElement : n).closest('.pl-ins');
      if (!ins) return;
      const atEnd = n.nodeType === 3 ? (r.startOffset === n.length && !n.nextSibling) : r.startOffset >= n.childNodes.length;
      if (!atEnd) return;
      e.preventDefault();
      // une espace seule en fin de ligne serait absorbée par le navigateur : espace insécable provisoire
      const t = document.createTextNode(e.data === ' ' ? '\u00A0' : e.data);
      ins.after(t);
      const nr = document.createRange(); nr.setStart(t, t.length); nr.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
      Ed.lastRange = nr.cloneRange(); Ed.changed(true);
    });
    Ed.editor.addEventListener('input', e => {
      if (e.inputType === 'insertParagraph') $$('.pl-ins, .pl-del', Ed.editor).forEach(x => { if (!x.textContent) x.remove(); });
    });
    Ed.editor.addEventListener('beforeinput', e => {
      if (!this.on || Protect.on) return;
      const t = e.inputType;
      if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromPaste' || t === 'insertFromDrop') {
        let text = e.data;
        if (text == null && e.dataTransfer) text = e.dataTransfer.getData('text/plain');
        if (text == null) return;
        e.preventDefault();
        this.insert(text);
      } else if (t === 'deleteContentBackward' || t === 'deleteContentForward' || t === 'deleteWordBackward' || t === 'deleteWordForward' || t === 'deleteByCut') {
        e.preventDefault();
        if (t === 'deleteByCut') { const r = Ed.range(); if (r && !r.collapsed) navigator.clipboard && navigator.clipboard.writeText(r.toString()).catch(() => { }); }
        this.remove(/Backward/.test(t) ? 'backward' : 'forward', /Word/.test(t) ? 'word' : 'character');
      }
    });
  },
  /** Supprime ou marque comme supprimé le contenu d'une plage */
  markDeleted(r) {
    const root = Ed.editor;
    if (r.collapsed) return;
    // découpe des nœuds texte aux bornes
    if (r.startContainer.nodeType === 3 && r.startOffset > 0 && r.startOffset < r.startContainer.length) {
      const tail = r.startContainer.splitText(r.startOffset); r.setStart(tail, 0);
    }
    if (r.endContainer.nodeType === 3 && r.endOffset > 0 && r.endOffset < r.endContainer.length) r.endContainer.splitText(r.endOffset);
    const nodes = [];
    const w = document.createTreeWalker(r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) if (r.intersectsNode(n) && n.length) nodes.push(n);
    let last = null;
    for (const t of nodes) {
      if (!root.contains(t)) continue;
      const ins = t.parentElement.closest('.pl-ins');
      if (ins && ins.dataset.author === this.author()) { last = ins; t.remove(); if (!ins.textContent) { last = ins.previousSibling || ins.parentNode; ins.remove(); } continue; }
      if (t.parentElement.closest('.pl-del')) { last = t.parentElement.closest('.pl-del'); continue; }
      const span = el('span', { class: 'pl-del', contenteditable: 'false', 'data-author': this.author(), 'data-date': this.stamp() });
      t.replaceWith(span); span.append(t); last = span;
    }
    return { first: nodes[0], last };
  },
  remove(dir, unit) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    if (sel.isCollapsed) sel.modify('extend', dir, unit);
    const r = sel.getRangeAt(0);
    if (r.collapsed) return;
    const startMarker = document.createTextNode('');
    const endRange = r.cloneRange(); endRange.collapse(dir === 'forward' ? false : true);
    endRange.insertNode(startMarker);
    this.markDeleted(r);
    // curseur : avant la suppression (retour arrière) ou après (suppr)
    const nr = document.createRange();
    nr.setStartAfter(startMarker); nr.collapse(true);
    if (dir === 'forward') { let x = startMarker; nr.setStartAfter(x); }
    startMarker.remove();
    sel.removeAllRanges(); sel.addRange(nr);
    this.mergeAdjacent();
    Ed.afterCmd();
  },
  /** Regroupe les marques de suppression voisines du même auteur */
  mergeAdjacent() {
    for (const d of $$('.pl-del', Ed.editor)) {
      let n = d.nextSibling;
      while (n && n.nodeType === 1 && n.classList.contains('pl-del') && n.dataset.author === d.dataset.author) {
        d.append(...n.childNodes); const next = n.nextSibling; n.remove(); n = next;
      }
      d.normalize();
    }
  },
  insert(text) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    let r = sel.getRangeAt(0);
    if (!r.collapsed) {
      const end = document.createTextNode('');
      const er = r.cloneRange(); er.collapse(false); er.insertNode(end);
      this.markDeleted(r);
      r = document.createRange(); r.setStartAfter(end); r.collapse(true); end.remove();
    }
    const container = r.startContainer;
    const ins = (container.nodeType === 3 ? container.parentElement : container).closest('.pl-ins');
    if (ins && ins.dataset.author === this.author() && container.nodeType === 3) {
      container.insertData(r.startOffset, text);
      const nr = document.createRange(); nr.setStart(container, r.startOffset + text.length); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    } else {
      const span = el('span', { class: 'pl-ins', 'data-author': this.author(), 'data-date': this.stamp() }, [text]);
      r.insertNode(span);
      const nr = document.createRange(); nr.setStart(span.firstChild, text.length); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    Ed.lastRange = sel.getRangeAt(0).cloneRange();
    Ed.changed(true);
  }
};

/* ---------- Correction automatique (typographie française) ---------- */
const AutoCorrect = {
  get on() { return localStorage.getItem('plume-autocorrect') !== 'off'; },
  set on(v) { localStorage.setItem('plume-autocorrect', v ? 'on' : 'off'); },
  /** Insère du texte tel quel (sans que le navigateur ne transforme les espaces insécables) */
  raw(node, off, removeBefore, text) {
    if (removeBefore) { node.deleteData(off - removeBefore, removeBefore); off -= removeBefore; }
    // espace insécable provisoire que le navigateur place en fin de texte : on la remet en espace normale
    if (node.data[off - 1] === '\u00A0' && !/^[\u00A0\u202F»]/.test(text)) node.replaceData(off - 1, 1, ' ');
    node.insertData(off, text);
    const r = document.createRange(); r.setStart(node, off + text.length); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    Ed.lastRange = r.cloneRange();
    Ed.changed(true);
  },
  init() {
    Ed.editor.addEventListener('beforeinput', e => {
      if (!this.on || Track.on || e.inputType !== 'insertText' || !e.data || e.data.length !== 1) return;
      const lang = (Ed.editor.lang || 'fr').slice(0, 2);
      const r = Ed.range();
      if (!r || !r.collapsed) return;
      let node = r.startContainer, off = r.startOffset;
      if (node.nodeType !== 3) {
        // curseur entre deux éléments : on crée un nœud texte pour y écrire
        if (!/["';:!?-]/.test(e.data)) return;
        const t = document.createTextNode('');
        r.insertNode(t); node = t; off = 0;
      }
      const prev = (node.data[off - 1] || '').replace('\u00A0', ' ');
      const c = e.data;
      let rm = 0, out = null;
      if (c === "'") out = '’';
      else if (c === '"' && lang === 'fr') out = (!prev || /[\s(\[«\u202F]/.test(prev)) ? '«\u202F' : (prev === ' ' ? (rm = 1, '\u202F»') : '\u202F»');
      else if (c === '"') out = (!prev || /[\s(\[]/.test(prev)) ? '“' : '”';
      else if (lang === 'fr' && /[;:!?]/.test(c) && prev === ' ') { rm = 1; out = '\u202F' + c; }
      else if (c === '-' && prev === '-') { rm = 1; out = '–'; }
      else if (c === ' ' && /(^|\s)\([cC]\)$/.test(node.data.slice(Math.max(0, off - 4), off))) { rm = 3; out = '© '; }
      if (out === null) return;
      e.preventDefault();
      this.raw(node, off, rm, out);
    });
  },
  toggle() { this.on = !this.on; toast('Correction automatique ' + (this.on ? '<b>activée</b> (guillemets « », apostrophe ’, espaces avant ; : ! ?)' : '<b>désactivée</b>')); Ribbon.refresh(); }
};

/* ---------- Publipostage ---------- */
const Merge = {
  data: null,      // { cols:[], rows:[[]] }
  index: 0,
  preview: false,
  async pickRecipients() {
    const fi = $('#fileInput');
    fi.accept = '.csv,.txt,.tsv';
    App.fileInputCb = async f => {
      const text = await f.text();
      const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { toast('Le fichier doit contenir une ligne d’en-têtes et au moins un destinataire.'); return; }
      const sep = lines[0].includes('\t') ? '\t' : (lines[0].split(';').length > lines[0].split(',').length ? ';' : ',');
      const parse = l => { const o = []; let c = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === sep) { o.push(c); c = ''; } else c += ch; } o.push(c); return o.map(x => x.trim()); };
      this.data = { cols: parse(lines[0]), rows: lines.slice(1).map(parse) };
      this.index = 0;
      toast(`<b>${this.data.rows.length}</b> destinataires chargés (${this.data.cols.length} champs)`);
      Ribbon.refresh();
    };
    fi.click();
  },
  insertField(name) {
    if (!name) return;
    Ed.focus();
    document.execCommand('insertHTML', false, `<span class="pl-merge" contenteditable="false" data-merge="${htmlEsc(name)}">«${htmlEsc(name)}»</span>&#8203;`);
    Ed.afterCmd();
    if (this.preview) this.render();
  },
  render() {
    for (const s of $$('.pl-merge', Ed.editor)) {
      const k = this.data ? this.data.cols.indexOf(s.dataset.merge) : -1;
      s.textContent = this.preview && this.data && k >= 0 ? (this.data.rows[this.index][k] || '') : `«${s.dataset.merge}»`;
      s.classList.toggle('previewing', this.preview);
    }
    Ed.relayout();
  },
  togglePreview() {
    if (!this.data) { toast('Choisissez d’abord les destinataires (fichier CSV)'); return; }
    this.preview = !this.preview; this.render(); Ribbon.refresh();
    if (this.preview) toast(`Aperçu : destinataire <b>${this.index + 1}</b> sur ${this.data.rows.length}`);
  },
  move(d) {
    if (!this.data) return;
    this.index = Math.max(0, Math.min(this.data.rows.length - 1, this.index + d));
    this.preview = true; this.render(); Ribbon.refresh();
    toast(`Destinataire <b>${this.index + 1}</b> sur ${this.data.rows.length}`, 1200);
  },
  /** Fusionne : un exemplaire du document par destinataire, séparés par des sauts de page */
  async finish() {
    if (!this.data) { toast('Choisissez d’abord les destinataires (fichier CSV)'); return; }
    if (!$('.pl-merge', Ed.editor)) { toast('Insérez d’abord des champs de fusion dans le document'); return; }
    const tpl = Ed.editor.cloneNode(true);
    $$('.pl-merge', tpl).forEach(s => { s.textContent = `«${s.dataset.merge}»`; });
    const parts = this.data.rows.map(row => {
      const c = tpl.cloneNode(true);
      $$('.pl-merge', c).forEach(s => { const k = this.data.cols.indexOf(s.dataset.merge); s.replaceWith(document.createTextNode(k >= 0 ? row[k] || '' : '')); });
      return c.innerHTML;
    });
    const html = parts.join('<hr class="pl-pagebreak" contenteditable="false">');
    const header = Ed.headerHTML, footer = Ed.footerHTML, page = { ...Ed.page }, settings = { ...Ed.settings };
    await App.flushAutosave();
    App.docId = uid(); App.fileHandle = null; App.desktopPath = null; App.format = 'docx'; Ed.source = null;
    $('#docTitle').value = App.name() + ' — fusion';
    Ed.load({ html, header, footer, page, settings, props: { ...Ed.props } });
    App.afterOpen();
    this.preview = false;
    toast(`<b>${parts.length}</b> documents fusionnés dans un nouveau fichier. Enregistrez-le ou imprimez-le.`, 5000);
  }
};

/* ---------- Dictée ---------- */
const Dictation = {
  rec: null,
  toggle() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('La dictée vocale n’est pas disponible dans ce navigateur (utilisez Chrome, Edge ou l’application de bureau).', 5000); return; }
    if (this.rec) { this.rec.stop(); return; }
    const rec = new SR();
    rec.lang = Ed.editor.lang || 'fr-BE';
    rec.continuous = true; rec.interimResults = false;
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) {
        let t = ev.results[i][0].transcript.trim();
        t = t.replace(/\s*(virgule)\s*/gi, ', ').replace(/\s*(point final|point)\s*$/i, '. ').replace(/\s*nouvelle ligne\s*/gi, '\n');
        Ed.focus();
        const parts = t.split('\n');
        parts.forEach((p, k) => { if (k) document.execCommand('insertParagraph'); if (p) document.execCommand('insertText', false, p + (/[\s.,]$/.test(p) ? '' : ' ')); });
        Ed.afterCmd();
      }
    };
    rec.onend = () => { this.rec = null; document.body.classList.remove('dictating'); Ribbon.refresh(); };
    rec.onerror = e => { toast('Dictée interrompue : ' + htmlEsc(e.error === 'not-allowed' ? 'accès au micro refusé' : e.error)); };
    rec.start(); this.rec = rec;
    document.body.classList.add('dictating');
    toast('🎙 Dictée en cours — parlez. Dites « virgule », « point », « nouvelle ligne ». Cliquez à nouveau pour arrêter.', 4500);
    Ribbon.refresh();
  }
};

/* ---------- Légendes ---------- */
const Captions = {
  async insert() {
    const label = el('select', {}, ['Figure', 'Tableau', 'Équation', 'Illustration'].map(l => el('option', {}, [l])));
    const txt = el('input', { type: 'text', placeholder: 'Texte de la légende' });
    const r = await dialog({ title: 'Insérer une légende', body: el('div', {}, [el('div', { class: 'fld' }, [el('label', {}, ['Étiquette']), label]), el('div', { class: 'fld' }, [el('label', {}, ['Légende']), txt])]), buttons: [{ label: 'Annuler', value: null }, { label: 'Insérer', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    const n = $$(`.pl-caption[data-label="${CSS.escape(label.value)}"]`, Ed.editor).length + 1;
    Ed.insertHTML(`<p class="pl-caption" data-label="${htmlEsc(label.value)}" style="font-size:9pt;font-style:italic;color:#44546A"><b>${htmlEsc(label.value)} <span class="pl-capnum">${n}</span></b> : ${htmlEsc(txt.value)}</p>`);
    this.renumber();
  },
  renumber() {
    const count = {};
    for (const c of $$('.pl-caption', Ed.editor)) { const l = c.dataset.label; count[l] = (count[l] || 0) + 1; const s = c.querySelector('.pl-capnum'); if (s) s.textContent = count[l]; }
  }
};

/* ---------- Filigrane ---------- */
const Watermark = {
  async set() {
    const presets = ['CONFIDENTIEL', 'BROUILLON', 'COPIE', 'NE PAS DIFFUSER', 'URGENT', 'EXEMPLE'];
    const inp = el('input', { type: 'text', value: Ed.settings.watermark || '', placeholder: 'Texte du filigrane', list: 'wmList' });
    const dl = el('datalist', { id: 'wmList' }, presets.map(p => el('option', { value: p })));
    const r = await dialog({ title: 'Filigrane', body: el('div', {}, [el('div', { class: 'fld' }, [el('label', {}, ['Texte']), inp]), dl, el('p', { style: 'color:var(--ui-fg-2)' }, ['Affiché en diagonale sur chaque page, à l’écran, à l’impression et dans le PDF.'])]), buttons: [{ label: 'Supprimer le filigrane', value: 'del' }, { label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r === 'del') Ed.settings.watermark = '';
    else if (r === 'ok') Ed.settings.watermark = inp.value.trim();
    else return;
    this.render(); Ed.changed(false);
  },
  render() {
    const t = Ed.settings.watermark || '';
    for (const card of Ed.pagesLayer.children) {
      let w = card.querySelector('.pl-watermark');
      if (!t) { if (w) w.remove(); continue; }
      if (!w) { w = el('div', { class: 'pl-watermark' }); card.prepend(w); }
      w.textContent = t;
    }
    let pw = $('#printWatermark');
    if (!pw) { pw = el('div', { id: 'printWatermark', class: 'print-hf' }); document.body.append(pw); }
    pw.textContent = t;
  }
};

/* ---------- Protection du document ---------- */
const Protect = {
  on: false,
  toggle() {
    this.on = !this.on;
    Ed.editor.contentEditable = this.on ? 'false' : 'true';
    $$('.hf', Ed.pagesLayer).forEach(h => { if (!(h.title || '').includes('première page')) h.contentEditable = this.on ? 'false' : 'true'; });
    document.body.classList.toggle('protected', this.on);
    toast(this.on ? '🔒 Document <b>protégé</b> : lecture seule. Cliquez à nouveau sur « Restreindre » pour modifier.' : '🔓 Protection retirée : le document est modifiable.');
    Ribbon.refresh();
  }
};
