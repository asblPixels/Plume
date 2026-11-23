/* =====================================================================
   Plume — fonctions utilitaires partagées
   ===================================================================== */
'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

/** Crée un élément : el('div', {class:'x', onclick:fn}, [enfants|texte]) */
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

/** Icône SVG (tracés Lucide, licence ISC) au style Plume */
const DUO = new Set(['save','undo-2','redo-2','clipboard-paste','paintbrush','baseline','highlighter','table','image','link',
  'file-plus','folder-open','file-down','printer','list-tree','spell-check','volume-2','search','replace','panel-top','panel-bottom',
  'hash','omega','calendar','columns-2','frame','book-open','zoom-in','zoom-out','list','list-ordered','separator-horizontal','info','download','sparkles']);
function icon(name, extra = '') {
  const s = el('span', { class: 'ic' + (DUO.has(name) ? ' duo' : '') + (extra ? ' ' + extra : '') });
  s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${(window.ICONS || {})[name] || ''}</svg>`;
  return s;
}
function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach(n => { const i = icon(n.dataset.icon); n.replaceWith(i); });
}

/* ---------- Conversions d'unités ---------- */
const U = {
  PX_PER_CM: 96 / 2.54,
  pxToPt: px => px * 0.75,
  ptToPx: pt => pt / 0.75,
  cmToPx: cm => cm * 96 / 2.54,
  pxToCm: px => px * 2.54 / 96,
  twipToPx: tw => tw / 15,
  pxToTwip: px => Math.round(px * 15),
  emuToPx: emu => emu / 9525,
  pxToEmu: px => Math.round(px * 9525),
  /** Convertit une longueur CSS ("12pt", "1cm", "16px") en px */
  cssToPx(v, fontPx = 16) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    const m = String(v).trim().match(/^(-?[\d.]+)\s*(px|pt|cm|mm|in|em|rem|%)?$/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    switch (m[2]) {
      case 'pt': return n / 0.75;
      case 'cm': return n * 96 / 2.54;
      case 'mm': return n * 96 / 25.4;
      case 'in': return n * 96;
      case 'em': case 'rem': return n * fontPx;
      default: return n;
    }
  }
};

/* ---------- Couleurs ---------- */
function rgbToHex(c) {
  if (!c) return null;
  if (c[0] === '#') return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c.slice(0, 7);
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null; // transparent
  return '#' + [m[1], m[2], m[3]].map(x => Math.round(+x).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ---------- XML ---------- */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const htmlEsc = xmlEsc;

/* ---------- Notifications ---------- */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- Boîtes de dialogue (pas d'alert/prompt natifs) ---------- */
/**
 * dialog({title, body: Node|string, buttons:[{label, primary, value, onClick}], onOpen})
 * Renvoie une promesse résolue avec la valeur du bouton (ou null si fermé).
 */
function dialog({ title, body, buttons = [{ label: 'OK', primary: true, value: true }], onOpen, width }) {
  return new Promise(resolve => {
    const back = el('div', { class: 'dlg-back' });
    const box = el('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', style: width ? { width: `min(${width}px, calc(100vw - 24px))` } : null });
    const close = v => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const head = el('div', { class: 'dlg-h' }, [title, el('button', { class: 'tb-btn', style: 'color:inherit', title: 'Fermer', onclick: () => close(null) }, [icon('x')])]);
    const b = el('div', { class: 'dlg-b' });
    if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
    const f = el('div', { class: 'dlg-f' });
    for (const btn of buttons) {
      f.append(el('button', {
        class: 'btn' + (btn.primary ? ' primary' : ''),
        onclick: async () => {
          if (btn.onClick) { const r = await btn.onClick(b); if (r === false) return; }
          if (!btn.keepOpen) close(btn.value !== undefined ? btn.value : btn.label);
        }
      }, [btn.label]));
    }
    box.append(head, b, f);
    back.append(box);
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const p = buttons.findIndex(x => x.primary);
        if (p >= 0) { e.preventDefault(); f.children[p].click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    if (onOpen) onOpen(b);
    const first = b.querySelector('input,select,textarea');
    (first || f.querySelector('.primary') || f.firstChild)?.focus();
  });
}

/* ---------- Téléchargement ---------- */
function downloadBlob(blob, name) {
  if (window.Native && Native.on) return Native.save(blob, name);   // attendre réellement la fin de l’écriture mobile
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Stockage local des documents (IndexedDB) ---------- */
const Store = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('plume', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);   // valeur absente → undefined
      t.onerror = () => rej(t.error);
    });
  },
  putDoc(doc) { return this.tx('docs', 'readwrite', s => s.put(doc)); },
  getDoc(id) { return this.tx('docs', 'readonly', s => s.get(id)); },
  delDoc(id) { return this.tx('docs', 'readwrite', s => s.delete(id)); },
  async listDocs() {
    const all = await this.tx('docs', 'readonly', s => s.getAll());
    return (all || []).map(d => ({ id: d.id, name: d.name, updated: d.updated })).sort((a, b) => b.updated - a.updated);
  },
  setKV(k, v) { return this.tx('kv', 'readwrite', s => s.put(v, k)); },
  getKV(k) { return this.tx('kv', 'readonly', s => s.get(k)); }
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function fmtDate(ts) {
  return new Date(ts).toLocaleString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
