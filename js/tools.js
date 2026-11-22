/* =====================================================================
   Plume — outils avancés
   Suivi des modifications, correction automatique, publipostage,
   dictée, légendes, filigrane, protection du document.
   ===================================================================== */
'use strict';

/* ---------- Suivi des modifications (enregistrement) ----------
   Modèle dans l'éditeur :
   - texte inséré   : <span class="pl-ins" data-author data-date>
   - texte supprimé : <span class="pl-del" data-author data-date contenteditable="false">
   - mise en forme  : <span class="pl-fmt" data-author data-date data-old='{"b":..,"i":..,"u":..,"strike":..}'>
   - marque de paragraphe insérée / supprimée : attributs data-pins-author/date, data-pdel-author/date du bloc
   ------------------------------------------------------------------------------------------------------ */
const LEAF_BLOCK = /^(P|H[1-6]|LI|BLOCKQUOTE|PRE)$/;
const Track = {
  on: false,
  author() { return localStorage.getItem('plume-user') || sessionStorage.getItem('plume-user') || Ed.props.author || 'Utilisateur Plume'; },
  stamp() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); },
  toggle() {
    this.on = !this.on;
    document.body.classList.toggle('tracking', this.on);
    toast(this.on ? `Suivi des modifications <b>activé</b> : vos ajouts et suppressions sont marqués au nom de <b>${htmlEsc(this.author())}</b>.` : 'Suivi des modifications <b>désactivé</b>.');
    Ribbon.refresh();
  },
  /** Nom d'auteur utilisé pour les révisions et les commentaires */
  async setAuthor() {
    const inp = el('input', { value: this.author(), style: 'width:100%' });
    const res = await dialog({ title: 'Nom d’utilisateur', body: el('div', {}, [el('p', { style: 'margin:0 0 8px' }, ['Ce nom signe vos commentaires et vos modifications suivies.']), inp]), onOpen: () => { inp.focus(); inp.select(); }, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (res === 'ok' && inp.value.trim()) { App.setUser(inp.value.trim()); toast('Nom d’utilisateur : <b>' + htmlEsc(inp.value.trim()) + '</b>'); }
  },
  /** Bloc élémentaire (paragraphe, titre, élément de liste…) contenant un nœud */
  blockOf(n) {
    let e = n && (n.nodeType === 3 ? n.parentElement : n);
    while (e && e !== Ed.editor) { if (LEAF_BLOCK.test(e.tagName)) return e; e = e.parentElement; }
    return null;
  },
  /** Blocs élémentaires du document, dans l'ordre */
  leafBlocks(root = Ed.editor) { return $$('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre', root).filter(b => !b.querySelector('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre') || b.tagName === 'LI'); },
  markAttrs(b) { const d = b.dataset; return { pins: d.pinsAuthor != null ? [d.pinsAuthor, d.pinsDate || ''] : null, pdel: d.pdelAuthor != null ? [d.pdelAuthor, d.pdelDate || ''] : null }; },
  setMark(b, m) {
    for (const k of ['pins', 'pdel']) {
      if (m && m[k]) { b.setAttribute(`data-${k}-author`, m[k][0]); b.setAttribute(`data-${k}-date`, m[k][1]); }
      else { b.removeAttribute(`data-${k}-author`); b.removeAttribute(`data-${k}-date`); }
    }
  },
  /** Fusionne un bloc avec le suivant (suppression réelle de sa marque de paragraphe) */
  join(b) {
    const all = this.leafBlocks(b.closest('.hf') || Ed.editor);
    const next = all[all.indexOf(b) + 1];
    if (!next) { this.setMark(b, null); return; }
    if (!b.textContent && !b.querySelector('img,.pl-island')) b.innerHTML = '';
    else { const last = b.lastChild; if (last && last.nodeName === 'BR') last.remove(); }
    const moved = Array.from(next.childNodes).filter(n => !(n.nodeName === 'BR' && n === next.lastChild && next.childNodes.length === 1 && b.childNodes.length));
    b.append(...moved);
    this.dropPlaceholderBr(b);
    this.setMark(b, this.markAttrs(next));
    let par = next.parentElement; next.remove();
    while (par && par !== Ed.editor && !par.children.length && /^(UL|OL|BLOCKQUOTE|DIV)$/.test(par.tagName)) { const up = par.parentElement; par.remove(); par = up; }
    if (!b.childNodes.length) b.append(el('br'));
  },
  /** Retire le <br> de remplissage d'un bloc devenu non vide (sinon exporté comme saut de ligne) */
  dropPlaceholderBr(b) {
    if (!b) return;
    let last = b.lastChild;
    while (last && last.nodeType === 3 && !last.length) last = last.previousSibling;
    if (last && last.nodeName === 'BR' && b.textContent.length && !(last.previousSibling && last.previousSibling.nodeName === 'BR')) last.remove();
  },
  /** Éléments insécables traités d'un bloc (tabulation, champ, note, image, îlot) */
  atomOf(n) {
    const e = n.nodeType === 3 ? n.parentElement : n;
    return e && e.closest && e.closest('.pl-tab,.pl-field,.pl-fn,.pl-island,.pl-merge');
  },
  /** Segments (texte ou élément insécable) couverts par une plage, avec leurs bornes */
  segments(r) {
    const segs = [];
    let root = r.commonAncestorContainer;
    if (root.nodeType === 3) root = root.parentNode;
    const atoms = new Set();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const consider = n => {
      if (n.nodeType === 1) {
        if (n.tagName === 'IMG' && !this.atomOf(n.parentElement || n) && r.intersectsNode(n)) segs.push({ node: n, atom: true });
        return;
      }
      if (!n.length || !r.intersectsNode(n)) return;
      const atom = this.atomOf(n);
      if (atom) { if (!atoms.has(atom)) { atoms.add(atom); segs.push({ node: atom, atom: true }); } return; }
      if (n.parentElement.closest('.pl-cref')) return;
      const s = n === r.startContainer ? r.startOffset : 0;
      const e = n === r.endContainer ? r.endOffset : n.length;
      if (s < e) segs.push({ node: n, s, e });
    };
    if (root.nodeType === 3) consider(root);
    let n; while ((n = w.nextNode())) consider(n);
    return segs.filter(x => Ed.editor.contains(x.node));
  },
  /** Blocs dont la marque de paragraphe est couverte par la plage (tous sauf le dernier) */
  crossedBlocks(r) {
    return this.leafBlocks().filter(b => {
      if (!r.intersectsNode(b)) return false;
      const len = b.childNodes.length;
      return r.comparePoint(b, len) === 0 && !(r.endContainer === b && r.endOffset === len) && !b.contains(r.endContainer);
    });
  },
  /** La plage contient-elle encore quelque chose à supprimer ? */
  hasLive(r) {
    if (this.segments(r).some(x => !(x.node.nodeType === 3 ? x.node.parentElement : x.node).closest('.pl-del'))) return true;
    return this.crossedBlocks(r).some(b => b.dataset.pdelAuthor == null);
  },
  /** Marque comme supprimé le contenu d'une plage (ou le retire s'il s'agit de sa propre insertion) */
  markDeleted(r) {
    if (r.collapsed) return;
    const me = this.author(), now = this.stamp();
    const crossed = this.crossedBlocks(r);
    const segs = this.segments(r);
    for (const sg of segs) {
      let x = sg.node;
      if (!sg.atom) {
        if (sg.e < x.length) x.splitText(sg.e);
        if (sg.s > 0) x = x.splitText(sg.s);
      }
      const host = x.nodeType === 3 ? x.parentElement : x;
      if ((x.nodeType === 1 ? x.parentElement : host).closest('.pl-del')) continue;
      const ins = (x.nodeType === 1 ? x.parentElement : host).closest('.pl-ins');
      if (ins && ins.dataset.author === me) {
        x.remove();
        if (!ins.textContent && !ins.querySelector('img,.pl-island,.pl-field,.pl-fn')) ins.replaceWith(...ins.childNodes);
        continue;
      }
      const span = el('span', { class: 'pl-del', contenteditable: 'false', 'data-author': me, 'data-date': now });
      x.replaceWith(span); span.append(x);
    }
    // marques de paragraphe
    for (const b of crossed) {
      if (!b.isConnected) continue;
      if (b.dataset.pinsAuthor === me && b.dataset.pdelAuthor == null) this.join(b);
      else if (b.dataset.pdelAuthor == null) { b.setAttribute('data-pdel-author', me); b.setAttribute('data-pdel-date', now); }
    }
  },
  /** Retour arrière / Suppr avec suivi */
  remove(dir, unit) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const wasCollapsed = sel.isCollapsed;
    if (wasCollapsed) {
      // on passe par-dessus le texte déjà supprimé, comme Word
      let before = null;
      for (let k = 0; k < 40; k++) {
        sel.modify('extend', dir, unit);
        const r = sel.getRangeAt(0);
        const sig = r.toString().length + ':' + r.startOffset + ':' + r.endOffset + (r.startContainer.nodeName) + (r.endContainer.nodeName);
        if (r.collapsed || sig === before) break;
        before = sig;
        if (this.hasLive(r)) break;
      }
    }
    const r = sel.getRangeAt(0);
    if (r.collapsed || !Ed.editor.contains(r.commonAncestorContainer)) return;
    // pas de suppression à cheval sur deux cellules de tableau (comme Word)
    const cell = n => (n.nodeType === 3 ? n.parentElement : n).closest('td,th');
    if (wasCollapsed && cell(r.startContainer) !== cell(r.endContainer)) { const c = r.cloneRange(); c.collapse(dir === 'forward'); sel.removeAllRanges(); sel.addRange(c); return; }
    const marker = document.createTextNode('');
    const mr = r.cloneRange(); mr.collapse(dir !== 'forward'); mr.insertNode(marker);
    this.markDeleted(r);
    this.tidy();
    this.caretAt(marker);
    Ed.changed(true);
  },
  /** Place le curseur sur un repère (nœud texte vide) puis retire celui-ci */
  caretAt(marker) {
    const sel = getSelection();
    if (marker.isConnected) {
      const nr = document.createRange(); nr.setStartAfter(marker); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
      marker.remove();
    }
    if (sel.rangeCount) Ed.lastRange = sel.getRangeAt(0).cloneRange();
  },
  /** Regroupe les marques voisines du même auteur et retire les marques vides */
  tidy(root = Ed.editor) {
    for (const cls of ['pl-del', 'pl-ins']) for (const d of $$('.' + cls, root)) {
      if (!d.isConnected) continue;
      let n = d.nextSibling;
      while (n && n.nodeType === 3 && !n.length) n = n.nextSibling;
      while (n && n.nodeType === 1 && n.classList.contains(cls) && n.dataset.author === d.dataset.author) {
        d.append(...n.childNodes); const next = n.nextSibling; n.remove(); n = next;
        while (n && n.nodeType === 3 && !n.length) n = n.nextSibling;
      }
    }
    // nœuds texte voisins regroupés (un seul w:t / w:delText à l'export) ; les repères vides sont conservés
    for (const d of $$('.pl-del, .pl-ins', root)) for (let n = d.firstChild; n;) {
      const nx = n.nextSibling;
      if (n.nodeType === 3 && nx && nx.nodeType === 3 && n.length && nx.length) { n.appendData(nx.data); nx.remove(); continue; }
      n = nx;
    }
    for (const b of this.leafBlocks(root)) if (!b.childNodes.length) b.append(el('br'));
  },
  insert(text) {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    let r = sel.getRangeAt(0);
    if (!r.collapsed) {
      // remplacement : la suppression précède l'insertion
      const marker = document.createTextNode('');
      const er = r.cloneRange(); er.collapse(false); er.insertNode(marker);
      this.markDeleted(r);
      r = document.createRange(); r.setStartAfter(marker); r.collapse(true);
      marker.remove();
    }
    const me = this.author();
    // jamais à l'intérieur d'un texte supprimé
    const host0 = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    let del = host0.closest('.pl-del');
    if (del) { while (del.parentElement.closest('.pl-del')) del = del.parentElement.closest('.pl-del'); r.setStartAfter(del); r.collapse(true); }
    const c = r.startContainer, off = r.startOffset;
    const host = c.nodeType === 3 ? c.parentElement : c;
    const ins = host.closest('.pl-ins');
    const own = e => e && e.nodeType === 1 && e.classList.contains('pl-ins') && e.dataset.author === me;
    let tn, at;
    // nœud juste avant le curseur : une insertion à soi qu'on peut prolonger ?
    const prevNode = c.nodeType === 3 ? (off === 0 ? c.previousSibling : null) : c.childNodes[off - 1];
    if (own(ins)) {
      if (c.nodeType === 3) { tn = c; at = off; }
      else { tn = document.createTextNode(''); r.insertNode(tn); at = 0; }
    } else if (own(prevNode)) {
      tn = prevNode.lastChild && prevNode.lastChild.nodeType === 3 ? prevNode.lastChild : prevNode.appendChild(document.createTextNode(''));
      at = tn.length;
    } else {
      if (ins) {
        // insertion dans celle d'un autre auteur : on la scinde
        const tail = document.createRange(); tail.setStart(c, off); tail.setEnd(ins, ins.childNodes.length);
        const frag = tail.extractContents();
        const ins2 = ins.cloneNode(false); ins2.append(frag);
        ins.after(ins2);
        r = document.createRange(); r.setStartAfter(ins); r.collapse(true);
        if (!ins2.textContent) ins2.remove();
      }
      const span = el('span', { class: 'pl-ins', 'data-author': me, 'data-date': this.stamp() }, ['']);
      r.insertNode(span);
      tn = span.firstChild; at = 0;
    }
    tn.insertData(at, text);
    this.dropPlaceholderBr(this.blockOf(tn));
    const nr = document.createRange(); nr.setStart(tn, at + text.length); nr.collapse(true);
    sel.removeAllRanges(); sel.addRange(nr);
    Ed.lastRange = nr.cloneRange();
    Ed.changed(true);
  },
  /** Mise en forme suivie : mémorise l'ancienne mise en forme du texte sélectionné (gras, italique, souligné, barré) */
  oldFormat(t) {
    const pe = t.parentElement;
    const c = getComputedStyle(pe);
    const o = { b: parseInt(c.fontWeight, 10) >= 600, i: c.fontStyle === 'italic', u: false, strike: false };
    const block = this.blockOf(t);
    for (let a = pe; a && a !== block && a !== Ed.editor; a = a.parentElement) {
      if (a.classList.contains('pl-ins') || a.classList.contains('pl-del')) continue;
      const deco = (a.style && a.style.textDecorationLine) || (a.style && a.style.textDecoration) || '';
      if (deco.includes('underline') || a.tagName === 'U') o.u = true;
      if (deco.includes('line-through') || /^(S|STRIKE|DEL)$/.test(a.tagName)) o.strike = true;
    }
    return o;
  },
  /** Avant une commande de mise en forme suivie : mémorise l'ancienne mise en forme de chaque nœud texte sélectionné */
  beforeFormat() {
    const r = Ed.range();
    if (!r || r.collapsed || !Ed.editor.contains(r.commonAncestorContainer)) return null;
    const me = this.author(), old = new Map();
    let first = null;
    for (const sg of this.segments(r)) {
      if (sg.atom) continue;
      const pe = sg.node.parentElement;
      if (pe.closest('.pl-del') || (pe.closest('.pl-ins') && pe.closest('.pl-ins').dataset.author === me)) continue;
      const f = pe.closest('.pl-fmt');
      const o = f ? f.dataset.old : JSON.stringify(this.oldFormat(sg.node));
      old.set(sg.node, o); first = first || o;
    }
    return first ? { old, first, me, date: this.stamp() } : null;
  },
  /** Après la commande : chaque texte sélectionné est enveloppé dans une marque pl-fmt (w:rPrChange) */
  afterFormat(st) {
    if (!st) return;
    const r = Ed.range();
    if (!r || r.collapsed) return;
    const segs = this.segments(r).filter(x => !x.atom);
    let first = null, last = null;
    for (const sg of segs) {
      let x = sg.node;
      const pe = x.parentElement;
      if (pe.closest('.pl-del') || (pe.closest('.pl-ins') && pe.closest('.pl-ins').dataset.author === st.me)) continue;
      const o = st.old.get(x) || st.first;
      if (sg.e < x.length) x.splitText(sg.e);
      if (sg.s > 0) x = x.splitText(sg.s);
      if (!x.parentElement.closest('.pl-fmt')) {
        const span = el('span', { class: 'pl-fmt', 'data-author': st.me, 'data-date': st.date, 'data-old': o });
        x.replaceWith(span); span.append(x);
      }
      first = first || x; last = x;
    }
    if (first) { const nr = document.createRange(); nr.setStart(first, 0); nr.setEnd(last, last.length); const s = getSelection(); s.removeAllRanges(); s.addRange(nr); }
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
      const t = document.createTextNode(e.data === ' ' ? ' ' : e.data);
      ins.after(t);
      const nr = document.createRange(); nr.setStart(t, t.length); nr.collapse(true);
      const s = getSelection(); s.removeAllRanges(); s.addRange(nr);
      Ed.lastRange = nr.cloneRange(); Ed.changed(true);
    });
    // Entrée : la marque de paragraphe d'origine reste sur la seconde partie ; la première reçoit une marque neuve
    Ed.editor.addEventListener('beforeinput', e => {
      if (e.inputType !== 'insertParagraph') return;
      const r = Ed.range();
      const b = r && this.blockOf(r.startContainer);
      this._split = b ? { block: b, mark: this.markAttrs(b) } : null;
    }, true);
    Ed.editor.addEventListener('input', e => {
      if (e.inputType !== 'insertParagraph') return;
      const r = Ed.range();
      const cur = r && this.blockOf(r.startContainer);
      if (cur && this._split) {
        const all = this.leafBlocks();
        const prev = all[all.indexOf(cur) - 1];
        this.setMark(cur, this._split.mark);
        if (prev) this.setMark(prev, this.on && !Protect.on ? { pins: [this.author(), this.stamp()] } : null);
      }
      this._split = null;
      // marques vides recopiées par le navigateur dans le nouveau paragraphe : on les déballe sans perdre le curseur
      const sel = getSelection();
      for (const x of $$('.pl-ins, .pl-del, .pl-fmt', Ed.editor)) {
        if (x.textContent || x.querySelector('img,.pl-island,.pl-field,.pl-fn')) continue;
        const range = sel.rangeCount ? sel.getRangeAt(0) : null;
        const inside = range && x.contains(range.startContainer);
        const anchor = document.createTextNode('');
        x.before(anchor);
        x.replaceWith(...x.childNodes);
        if (inside) { const nr = document.createRange(); nr.setStartAfter(anchor); nr.collapse(true); sel.removeAllRanges(); sel.addRange(nr); }
        anchor.remove();
      }
    });
    Ed.editor.addEventListener('beforeinput', e => {
      if (!this.on || Protect.on) return;
      const t = e.inputType;
      if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromPaste' || t === 'insertFromDrop' || t === 'insertFromYank') {
        let text = e.data;
        if (text == null && e.dataTransfer) text = e.dataTransfer.getData('text/plain');
        if (text == null) return;
        e.preventDefault();
        // collage de plusieurs lignes : une ligne par paragraphe n'est pas gérée, les sauts deviennent des espaces
        this.insert(text.replace(/\r?\n/g, ' '));
      } else if (/^delete/.test(t)) {
        e.preventDefault();
        if (t === 'deleteByCut') { const r = Ed.range(); if (r && !r.collapsed) navigator.clipboard && navigator.clipboard.writeText(r.toString()).catch(() => { }); }
        const r = Ed.range();
        const sel = r && !r.collapsed;
        this.remove(/Backward/.test(t) || (sel && !/Forward/.test(t)) ? 'backward' : 'forward', /Word/.test(t) ? 'word' : /Line|Soft|Hard/.test(t) ? 'lineboundary' : 'character');
      }
    });
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

/* ---------- Polices personnelles (ex. Marelle, polices d'école) ---------- */
const CustomFonts = {
  fonts: [],          // [{ family, file, data }]
  list() { return [...new Set(this.fonts.map(f => f.family))].sort((a, b) => a.localeCompare(b, 'fr')); },
  async init() {
    try { const v = await Store.getKV('fonts'); this.fonts = Array.isArray(v) ? v : []; } catch { this.fonts = []; }
    for (const f of this.fonts) await this.register(f).catch(() => { });
    if (this.fonts.length) Ed.relayout();
  },
  async register(f) {
    const face = new FontFace(f.family, f.data, f.descriptors || {});
    await face.load();
    document.fonts.add(face);
  },
  /** Nom de famille lu dans la table « name » d'un fichier TrueType / OpenType */
  familyName(buf, fallback) {
    try {
      const dv = new DataView(buf);
      const tag = dv.getUint32(0);
      if (tag !== 0x00010000 && tag !== 0x4F54544F && tag !== 0x74727565) return fallback;   // WOFF/WOFF2 : nom du fichier
      const n = dv.getUint16(4);
      for (let i = 0; i < n; i++) {
        const o = 12 + i * 16;
        if (dv.getUint32(o) !== 0x6E616D65) continue;      // 'name'
        const base = dv.getUint32(o + 8);
        const count = dv.getUint16(base + 2), strOff = base + dv.getUint16(base + 4);
        const found = {};
        for (let k = 0; k < count; k++) {
          const r = base + 6 + k * 12;
          const pid = dv.getUint16(r), nid = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
          if (nid !== 16 && nid !== 1) continue;
          let str = '';
          if (pid === 3 || pid === 0) for (let c = 0; c < len; c += 2) str += String.fromCharCode(dv.getUint16(strOff + off + c));
          else for (let c = 0; c < len; c++) str += String.fromCharCode(dv.getUint8(strOff + off + c));
          if (str.trim() && !found[nid]) found[nid] = str.trim();
        }
        return found[16] || found[1] || fallback;
      }
    } catch { }
    return fallback;
  },
  add() {
    // champ de fichier dédié (indépendant de celui d'ouverture des documents)
    let fi = $('#fontInput');
    if (!fi) { fi = el('input', { type: 'file', id: 'fontInput', multiple: true, accept: '.ttf,.otf,.woff,.woff2', style: 'display:none' }); document.body.append(fi); }
    fi.onchange = async () => {
      const files = Array.from(fi.files || []); fi.value = '';
      const added = [];
      for (const file of files) {
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) { toast(`<b>${htmlEsc(file.name)}</b> n’est pas un fichier de police (.ttf, .otf, .woff).`); continue; }
        const data = await file.arrayBuffer();
        const guess = file.name.replace(/\.[^.]+$/, '').replace(/[-_](Regular|Bold|Italic|BoldItalic|Light|Medium|Book|Normal)$/i, '').replace(/[-_]+/g, ' ').trim();
        const family = this.familyName(data, guess);
        const style = /italic|oblique/i.test(file.name) ? 'italic' : 'normal';
        const weight = /bold|gras/i.test(file.name) ? '700' : '400';
        const entry = { family, file: file.name, data, descriptors: { style, weight } };
        try { await this.register(entry); } catch { toast(`<b>${htmlEsc(file.name)}</b> : fichier de police illisible.`); continue; }
        this.fonts = this.fonts.filter(f => f.file !== file.name);
        this.fonts.push(entry);
        added.push(family);
      }
      if (!added.length) return;
      await Store.setKV('fonts', this.fonts).catch(() => { });
      Ed.relayout();
      const names = [...new Set(added)].join(', ');
      toast(`Police ajoutée : <b>${htmlEsc(names)}</b>. Elle est dans le menu des polices, rubrique « Mes polices ».`, 6000);
    };
    fi.click();
  },
  async manage() {
    const box = el('div');
    const render = () => {
      box.innerHTML = '';
      if (!this.fonts.length) { box.append(el('p', {}, ['Aucune police ajoutée.'])); return; }
      for (const f of this.fonts) {
        box.append(el('div', { style: 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--ui-border)' }, [
          el('span', { style: `font-family:'${f.family.replace(/'/g, '')}', sans-serif;font-size:18px;flex:1` }, [`${f.family} — Abc àéè 123`]),
          el('span', { style: 'color:var(--ui-fg-2);font-size:12px' }, [f.file]),
          el('button', { class: 'btn', onclick: async () => { this.fonts = this.fonts.filter(x => x !== f); await Store.setKV('fonts', this.fonts).catch(() => { }); render(); toast('Police retirée (elle disparaîtra au prochain lancement).'); } }, ['Retirer'])]));
      }
    };
    render();
    await dialog({ title: 'Mes polices', body: box, width: 620, buttons: [{ label: 'Ajouter…', onClick: () => { this.add(); return true; } }, { label: 'Fermer', primary: true }] });
  }
};

/* ---------- Guide de prise en main (mots simples) ---------- */
const Guide = {
  open() {
    const step = (n, t, d) => `<div style="display:flex;gap:12px;margin:0 0 14px"><div style="flex:none;width:28px;height:28px;border-radius:50%;background:var(--title-bg);color:var(--brand);display:grid;place-items:center;font-weight:700">${n}</div><div><b>${t}</b><div style="color:var(--ui-fg-2);line-height:1.5;margin-top:2px">${d}</div></div></div>`;
    const html = `
      <p style="line-height:1.55;margin-top:0">Plume fonctionne comme les traitements de texte habituels. Vos documents restent sur votre appareil : aucun compte n'est nécessaire.</p>
      ${step(1, 'Écrire', 'Au lancement, choisissez <b>Document vierge</b> (ou <b>Ouvrir un fichier…</b> pour reprendre un document, par exemple sur votre clé USB). Cliquez dans la page blanche et tapez votre texte. Pensez à <b>enregistrer</b> : par défaut, Plume ne garde rien sur l’ordinateur.')}
      ${step(2, 'Mettre en forme', 'Sélectionnez du texte avec la souris, puis utilisez l’onglet <b>Accueil</b> : police, taille, <b>gras</b>, <i>italique</i>, couleur, listes, alignement.')}
      ${step(3, 'Écrire en cursive', 'Dans la liste des polices (en haut à gauche, sous « Accueil »), choisissez <b>Playwrite FR Moderne</b> ou <b>Playwrite FR Trad</b>. Pour les débutants en lecture : <b>Andika</b>. Pour les élèves dyslexiques : <b>OpenDyslexic</b>.')}
      ${step(4, 'Polices de l’école', 'Les cursives <b>Marelle</b> et <b>Borel</b> sont déjà dans Plume, en haut de la liste des polices, et voyagent avec le document Word. Pour une autre police : téléchargez-la (fichier <b>.ttf</b> ou <b>.otf</b>) puis, dans Plume, ouvrez la liste des polices puis cliquez tout en bas sur <b>« Ajouter une police… »</b> et choisissez le fichier. Elle apparaît dans « Mes polices » et reste disponible à chaque ouverture de Plume sur cet appareil.')}
      ${step(5, 'Ouvrir un document', 'Menu <b>Fichier → Ouvrir → Parcourir</b>. Plume ouvre les documents Word, LibreOffice, Google Docs (téléchargés), PDF, RTF…')}
      ${step(6, 'Enregistrer et partager', '<b>Ctrl + S</b> enregistre le fichier (sur l’ordinateur ou une clé USB). Pour l’envoyer à quelqu’un : <b>Fichier → Exporter</b>, puis choisissez <b>PDF</b> (s’ouvre partout, la police est incluse) ou <b>Word</b>.')}
      ${step(7, 'Imprimer', '<b>Ctrl + P</b>, ou menu Fichier → Imprimer.')}
      <p style="background:var(--brand-soft);padding:10px 12px;border-radius:10px;line-height:1.5">💡 <b>Astuce :</b> si vous envoyez un document écrit en cursive au format Word, l’autre ordinateur doit avoir la même police installée. En <b>PDF</b>, la police est toujours incluse.</p>
      <p style="color:var(--ui-fg-2)">Une question ? Pixel's ASBL — <a href="mailto:info@asblpixels.be">info@asblpixels.be</a></p>`;
    dialog({ title: 'Bien démarrer avec Plume', body: html, width: 640, buttons: [{ label: 'C’est parti !', primary: true }] });
  }
};
