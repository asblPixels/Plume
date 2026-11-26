/* =====================================================================
   Plume — anciens formats Word (.doc, .dot — Word 97 à 2003)
   Lecture du conteneur OLE (Compound File Binary), de la table des
   pièces, des propriétés FKP (CHPX / PAPX), des styles (STSH) et des
   listes du flux WordDocument. Récupère le texte (8 bits cp1252 ou
   UTF-16), les paragraphes, les titres, les listes, les tableaux, les
   sauts de page, les liens et la mise en forme simple (gras, italique,
   souligné, barré, taille, couleur, police, exposant / indice).
   Non repris : images, en-têtes / pieds, notes, zones de texte.
   Dans l'application de bureau, si LibreOffice est installé, le module
   de conversion est utilisé à la place pour conserver toute la mise en forme.
   ===================================================================== */
'use strict';

const LegacyDoc = (() => {

  /** Lecture d'un fichier composé OLE2 → { nom: Uint8Array } */
  function readCfb(buf, names = null) {
    const b = new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (!sig.every((v, i) => b[i] === v)) throw new Error('Ce fichier n’est pas un document Word 97-2003 (.doc).');
    const ssz = 1 << dv.getUint16(0x1E, true);
    const mssz = 1 << dv.getUint16(0x20, true);
    if (![512, 4096].includes(ssz) || mssz !== 64) throw new Error('Taille de secteur OLE invalide.');
    const firstDir = dv.getUint32(0x30, true);
    const cutoff = dv.getUint32(0x38, true);
    const firstMiniFat = dv.getUint32(0x3C, true);
    const nMiniFat = dv.getUint32(0x40, true);
    let difatSec = dv.getUint32(0x44, true);
    const nDifat = dv.getUint32(0x48, true);
    const sectorOff = s => (s + 1) * ssz;
    const fatSectors = [];
    for (let i = 0; i < 109; i++) { const s = dv.getUint32(0x4C + i * 4, true); if (s < 0xFFFFFFFA) fatSectors.push(s); }
    for (let k = 0; k < nDifat && difatSec < 0xFFFFFFFA; k++) {
      const o = sectorOff(difatSec);
      for (let i = 0; i < ssz / 4 - 1; i++) { const s = dv.getUint32(o + i * 4, true); if (s < 0xFFFFFFFA) fatSectors.push(s); }
      difatSec = dv.getUint32(o + ssz - 4, true);
    }
    const fat = [];
    for (const s of fatSectors) { const o = sectorOff(s); for (let i = 0; i < ssz / 4; i++) fat.push(dv.getUint32(o + i * 4, true)); }
    const chain = (start, table) => {
      const out = [], visited = new Set();
      for (let s = start; s < 0xFFFFFFFA; s = table[s]) {
        if (s >= table.length || visited.has(s)) throw new Error('Chaîne OLE invalide.');
        visited.add(s);
        out.push(s);
      }
      return out;
    };
    const readChain = (start, size) => {
      const sectors = chain(start, fat);
      const capacity = sectors.length * ssz;
      if (capacity > b.length || size > capacity) throw new Error('Flux OLE tronqué.');
      const out = new Uint8Array(size === undefined ? capacity : size);
      let pos = 0;
      for (const s of sectors) {
        const o = sectorOff(s); const n = Math.min(ssz, out.length - pos);
        if (n <= 0) break;
        out.set(b.subarray(o, o + n), pos); pos += n;
      }
      return out;
    };
    // répertoire
    const dir = readChain(firstDir);
    const ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nameLen = ddv.getUint16(o + 0x40, true);
      let name = '';
      for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
      entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
    }
    const root = entries[0];
    const ministream = root ? readChain(root.start, root.size) : new Uint8Array(0);
    const minifat = [];
    if (nMiniFat) { const m = readChain(firstMiniFat); const mdv = new DataView(m.buffer); for (let i = 0; i < m.length / 4; i++) minifat.push(mdv.getUint32(i * 4, true)); }
    const files = Object.create(null);
    for (const e of entries) {
      if (e.type !== 2 || (names && !names.has(e.name))) continue;
      if (e.size < cutoff) {
        if (e.size > ministream.length) throw new Error('Flux OLE tronqué.');
        const out = new Uint8Array(e.size); let pos = 0;
        for (const s of chain(e.start, minifat)) { const n = Math.min(mssz, e.size - pos); if (n <= 0) break; out.set(ministream.subarray(s * mssz, s * mssz + n), pos); pos += n; }
        files[e.name] = out;
      } else files[e.name] = readChain(e.start, e.size);
    }
    return files;
  }

  /* =====================================================================
     Flux WordDocument : FIB, table des pièces, propriétés (FKP), styles
     ===================================================================== */
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const i16 = (b, o) => { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  /** Parcours d'une liste de sprm (modificateurs de propriétés) */
  function eachSprm(b, start, end, fn) {
    let p = start;
    while (p + 2 <= end) {
      const op = u16(b, p); p += 2;
      let size;
      switch (op >> 13) {
        case 0: case 1: size = 1; break;
        case 2: case 4: case 5: size = 2; break;
        case 3: size = 4; break;
        case 7: size = 3; break;
        default:
          if (op === 0xD608 || op === 0xD606) size = 2 + u16(b, p) - 1;   // sprmTDefTable : taille sur 2 octets
          else if (op === 0xC615 && b[p] === 255) { const del = b[p + 1]; const add = b[p + 2 + del * 4]; size = 1 + 1 + del * 4 + 1 + add * 3; }
          else size = 1 + b[p];
      }
      if (p + size > end + 1) break;
      fn(op, p, size);
      p += size;
    }
  }

  const ICO = [null, '#000000', '#0000FF', '#00FFFF', '#00FF00', '#FF00FF', '#FF0000', '#FFFF00', '#FFFFFF', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0'];
  const toggle = (v, base) => v === 0x80 ? base : v === 0x81 ? !base : !!v;
  /** sprm de caractère → propriétés (relatives aux propriétés de base) */
  function applyChp(b, start, end, o, base = {}) {
    eachSprm(b, start, end, (op, p) => {
      switch (op) {
        case 0x0835: o.b = toggle(b[p], base.b); break;
        case 0x0836: o.i = toggle(b[p], base.i); break;
        case 0x0837: o.strike = toggle(b[p], base.strike); break;
        case 0x2A53: o.strike = toggle(b[p], base.strike); break;            // double barré
        case 0x083A: o.smallCaps = toggle(b[p], base.smallCaps); break;
        case 0x083B: o.caps = toggle(b[p], base.caps); break;
        case 0x083C: o.vanish = toggle(b[p], base.vanish); break;
        case 0x2A3E: o.u = b[p] !== 0; break;
        case 0x4A43: o.sz = u16(b, p) / 2; break;
        case 0x2A42: o.color = ICO[b[p]] || null; break;
        case 0x6870: o.color = b[p + 3] === 0xFF ? null : '#' + [b[p], b[p + 1], b[p + 2]].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase(); break;
        case 0x2A0C: o.hl = ICO[b[p]] || null; break;
        case 0x4A4F: o.ftc = u16(b, p); break;   // police (caractères latins)
        case 0x2A48: o.vert = b[p] === 1 ? 'sup' : b[p] === 2 ? 'sub' : null; break;
      }
    });
    return o;
  }
  /** sprm de paragraphe → propriétés */
  function applyPap(b, start, end, o) {
    eachSprm(b, start, end, (op, p, size) => {
      switch (op) {
        case 0x2403: case 0x2461: o.jc = b[p]; break;
        case 0x2416: o.inTable = !!b[p]; break;
        case 0x2417: o.ttp = !!b[p]; break;
        case 0x6649: o.itap = u32(b, p); break;
        case 0x244B: o.innerCell = !!b[p]; break;
        case 0x244C: o.innerTtp = !!b[p]; break;
        case 0x2407: o.pbb = !!b[p]; break;
        case 0x460B: o.ilfo = u16(b, p); break;
        case 0x260A: o.ilvl = b[p]; break;
        case 0x2640: o.outline = b[p]; break;
        case 0xA413: o.before = u16(b, p) / 20; break;   // espacement avant (twips → pt)
        case 0xA414: o.after = u16(b, p) / 20; break;
        case 0x6412: { const dya = i16(b, p), mult = u16(b, p + 2); o.line = mult ? Math.round(dya / 240 * 100) / 100 : null; break; }
        case 0x840F: case 0x845E: o.indL = i16(b, p) / 20; break;
        case 0x8411: case 0x8460: o.first = i16(b, p) / 20; break;
        case 0xD608: {   // définition de la ligne : bords des cellules (rgdxaCenter) et fusions (TC80)
          const n = b[p + 2];
          if (n > 0 && n < 64) {
            const xs = []; for (let k = 0; k <= n; k++) xs.push(i16(b, p + 3 + k * 2));
            const tc = [];
            const t0 = p + 3 + (n + 1) * 2;
            for (let k = 0; k < n && t0 + k * 20 + 2 <= p + size; k++) {
              const g = u16(b, t0 + k * 20);
              tc.push({ hFirst: !!(g & 1), hMerged: !!(g & 2), vMerge: !!(g & 0x20), vRestart: !!(g & 0x40), va: (g >> 7) & 3 });
            }
            o.xs = xs; o.tc = tc;
          }
          break;
        }
      }
    });
    return o;
  }

  /** Lecture complète d'un document Word 97-2003 */
  function parseDoc(files) {
    const wd = files['WordDocument'];
    if (!wd) throw new Error('Flux WordDocument introuvable : ce n’est pas un document Word.');
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    const ident = dv.getUint16(0, true);
    if (ident !== 0xA5EC) throw Object.assign(new Error('Format Word non reconnu'), { userMessage: ident === 0xA5DC ? 'Ce document vient de Word 6 ou Word 95 : ce format très ancien n’est pas lisible dans le navigateur. Ouvrez-le dans l’application de bureau Plume avec LibreOffice installé.' : 'Format Word non reconnu (version antérieure à Word 97 ?).' });
    const flags = dv.getUint16(0x0A, true);
    if (flags & 0x0100) throw Object.assign(new Error('Document protégé'), { userMessage: 'Ce document Word est protégé par un mot de passe : retirez la protection dans Word puis réessayez.' });
    const table = files[(flags & 0x0200) ? '1Table' : '0Table'];
    if (!table) throw new Error('Table du document introuvable.');
    let p = 32;
    const csw = dv.getUint16(p, true); p += 2 + csw * 2;
    const cslw = dv.getUint16(p, true);
    const lw = p + 2;
    const lwAt = i => dv.getInt32(lw + i * 4, true);
    const ccp = { text: lwAt(3), ftn: lwAt(4), hdd: lwAt(5), atn: lwAt(7), edn: lwAt(8), txbx: lwAt(9) };
    p = lw + cslw * 4;
    const cbRg = dv.getUint16(p, true); p += 2;
    const fcLcb = i => i < cbRg ? [dv.getUint32(p + i * 8, true), dv.getUint32(p + i * 8 + 4, true)] : [0, 0];

    /* --- table des pièces (CLX) --- */
    const [fcClx, lcbClx] = fcLcb(33);
    let q = fcClx;
    const end = fcClx + lcbClx;
    while (q < end && table[q] === 0x01) q += 3 + i16(table, q + 1);
    if (table[q] !== 0x02) throw new Error('Structure du document illisible.');
    const lcb = u32(table, q + 1); q += 5;
    const n = (lcb - 4) / 12;
    const cps = []; for (let i = 0; i <= n; i++) cps.push(u32(table, q + i * 4));
    const pcdBase = q + (n + 1) * 4;
    const cp1252 = new TextDecoder('windows-1252');
    const total = Math.max(0, ccp.text);
    let text = '';
    const fcs = new Int32Array(total + 1);   // position (FC) de chaque caractère dans le flux
    for (let i = 0; i < n && text.length < total; i++) {
      let fc = u32(table, pcdBase + i * 8 + 2);
      const count = Math.min(cps[i + 1] - cps[i], total - text.length);
      if (count <= 0) continue;
      const compressed = (fc & 0x40000000) !== 0;
      const at = text.length;
      if (compressed) {
        fc = (fc & ~0x40000000) >>> 1;
        text += cp1252.decode(wd.subarray(fc, fc + count));
        for (let k = 0; k < count; k++) fcs[at + k] = fc + k;
      } else {
        let s = '';
        for (let k = 0; k < count; k++) { s += String.fromCharCode(dv.getUint16(fc + k * 2, true)); fcs[at + k] = fc + k * 2; }
        text += s;
      }
    }

    /* --- FKP : propriétés de caractère et de paragraphe --- */
    function fkpRuns(idx, isPap) {
      const [fc, len] = fcLcb(idx);
      const runs = [];
      if (!len || fc + len > table.length) return runs;
      const cnt = (len - 4) / 8;
      const seen = new Set();
      for (let i = 0; i < cnt; i++) {
        const pn = u32(table, fc + (cnt + 1) * 4 + i * 4) & 0x3FFFFF;
        if (seen.has(pn)) continue;
        seen.add(pn);
        const base = pn * 512;
        if (base + 512 > wd.length) continue;
        const crun = wd[base + 511];
        for (let k = 0; k < crun; k++) {
          const a = u32(wd, base + k * 4), z = u32(wd, base + (k + 1) * 4);
          if (isPap) {
            const off = wd[base + (crun + 1) * 4 + k * 13] * 2;
            const o = {};
            if (off) {
              let cb = wd[base + off], st = base + off + 1, size;
              if (cb === 0) { cb = wd[base + off + 1]; st++; size = cb * 2; } else size = cb * 2 - 1;
              o.istd = u16(wd, st);
              applyPap(wd, st + 2, st + size, o);
            }
            runs.push([a, z, o]);
          } else {
            const off = wd[base + (crun + 1) * 4 + k] * 2;
            runs.push([a, z, off ? { s: base + off + 1, e: base + off + 1 + wd[base + off] } : null]);
          }
        }
      }
      runs.sort((x, y) => x[0] - y[0]);
      return runs;
    }
    const find = (runs, fc) => {
      let lo = 0, hi = runs.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (fc < runs[m][0]) hi = m - 1; else if (fc >= runs[m][1]) lo = m + 1; else return runs[m][2]; }
      return null;
    };
    const chpRuns = fkpRuns(12, false), papRuns = fkpRuns(13, true);

    /* --- polices (SttbfFfn) --- */
    const fonts = [];
    {
      const [fc, len] = fcLcb(15);
      if (len > 4 && fc + len <= table.length) {
        let r = fc;
        let cData = u16(table, r); r += 2;
        if (cData === 0xFFFF) { cData = u16(table, r); r += 2; }
        r += 2;   // cbExtra
        for (let i = 0; i < cData && r < fc + len; i++) {
          const cch = table[r];
          let name = '';
          for (let k = r + 1 + 39; k + 1 < r + 1 + cch; k += 2) { const c = u16(table, k); if (!c) break; name += String.fromCharCode(c); }
          fonts.push(/^[^\x00-\x1F]{1,80}$/.test(name) ? name : null);
          r += 1 + cch;
        }
      }
    }

    /* --- styles (STSH) --- */
    const styles = [];
    let defFtc = null;
    {
      const [fc, len] = fcLcb(1);
      if (len > 4 && fc + len <= table.length) {
        const cbStshi = u16(table, fc);
        const sh = fc + 2;
        const cstd = u16(table, sh), cbBase = u16(table, sh + 2);
        if (cbStshi >= 18) defFtc = u16(table, sh + 12);
        let r = sh + cbStshi;
        for (let i = 0; i < cstd && r + 2 <= fc + len; i++) {
          const cb = u16(table, r);
          const st = r + 2;
          r = st + cb;
          if (!cb) { styles.push(null); continue; }
          const sti = u16(table, st) & 0x0FFF;
          const stk = u16(table, st + 2) & 0x000F, istdBase = u16(table, st + 2) >> 4;
          const cupx = u16(table, st + 4) & 0x000F;
          let o = st + cbBase;
          const cch = u16(table, o);
          let name = '';
          for (let k = 0; k < cch; k++) name += String.fromCharCode(u16(table, o + 2 + k * 2));
          o += 2 + cch * 2 + 2;
          const upx = [];
          for (let k = 0; k < cupx && o + 2 <= st + cb; k++) {
            if ((o - st) % 2) o++;
            const cbu = u16(table, o);
            upx.push([o + 2, o + 2 + cbu]);
            o += 2 + cbu;
          }
          styles.push({ sti, stk, istdBase, name, upx });
        }
      }
    }
    const styleCache = {};
    /** Propriétés (paragraphe + caractère) d'un style, chaîne d'héritage comprise */
    function styleProps(istd, depth = 0) {
      if (styleCache[istd]) return styleCache[istd];
      const s = styles[istd];
      if (!s || depth > 12) return { pap: {}, chp: {}, sti: 0x0FFE, name: '' };
      const base = s.istdBase !== 0x0FFF && s.istdBase !== istd ? styleProps(s.istdBase, depth + 1) : { pap: {}, chp: { sz: 10 } };
      const pap = Object.assign({}, base.pap), chp = Object.assign({}, base.chp);
      if (s.stk === 1) {
        if (s.upx[0]) applyPap(table, s.upx[0][0] + 2, s.upx[0][1], pap);
        if (s.upx[1]) applyChp(table, s.upx[1][0], s.upx[1][1], chp, base.chp);
      } else if (s.stk === 2 && s.upx[0]) applyChp(table, s.upx[0][0], s.upx[0][1], chp, base.chp);
      delete pap.inTable; delete pap.ttp; delete pap.itap; delete pap.xs; delete pap.tc;
      return (styleCache[istd] = { pap, chp, sti: s.sti, name: s.name.toLowerCase() });
    }

    /* --- listes (PlfLst / PlfLfo) : type de chaque niveau --- */
    const lists = {};   // lsid → [nfc par niveau]
    const lfo = [];     // ilfo-1 → lsid
    try {
      const [fl, ll] = fcLcb(73);
      if (ll > 2 && fl + ll <= table.length) {
        const c = u16(table, fl);
        const lstf = [];
        for (let i = 0; i < c; i++) { const o = fl + 2 + i * 28; lstf.push({ lsid: u32(table, o), simple: !!(table[o + 26] & 1) }); }
        let o = fl + 2 + c * 28;
        for (const L of lstf) {
          const lv = [];
          for (let k = 0; k < (L.simple ? 1 : 9); k++) {
            const nfc = table[o + 4];
            const cbChpx = table[o + 24], cbPapx = table[o + 25];
            o += 28 + cbPapx + cbChpx;
            const cch = u16(table, o); o += 2 + cch * 2;
            lv.push(nfc);
          }
          lists[L.lsid] = lv;
        }
      }
      const [ff, lf] = fcLcb(74);
      if (lf > 4 && ff + lf <= table.length) {
        const c = u32(table, ff);
        for (let i = 0; i < c; i++) lfo.push(u32(table, ff + 4 + i * 16));
      }
    } catch { /* listes illisibles : paragraphes simples */ }

    const normal = styleProps(0);
    const fontName = ftc => (ftc != null && fonts[ftc]) || null;
    return {
      text, ccp, pictures: (text.match(/[\x01\x08]/g) || []).length,
      hasPap: papRuns.length > 0,
      papAt: cp => { const o = find(papRuns, fcs[cp]) || {}; const st = styleProps(o.istd || 0); return Object.assign({}, st.pap, o, { style: st }); },
      chpAt: (cp, st) => { const r = find(chpRuns, fcs[cp]); const base = st ? st.chp : normal.chp; const o = Object.assign({}, base); if (r) applyChp(wd, r.s, r.e, o, base); return o; },
      listType: (ilfo, ilvl) => { const lv = lists[lfo[ilfo - 1]]; const nfc = lv ? (lv[ilvl] ?? lv[0]) : 23; return nfc; },
      normal, fonts, defFtc, fontName: ftc => fontName(ftc ?? defFtc), defFont: fontName(normal.chp.ftc ?? defFtc)
    };
  }

  /* =====================================================================
     Conversion en HTML Plume
     ===================================================================== */
  const NFC = { 0: 'decimal', 1: 'upper-roman', 2: 'lower-roman', 3: 'upper-alpha', 4: 'lower-alpha', 23: 'disc', 255: 'none' };
  function toHtml(doc) {
    const { text } = doc;
    const N = doc.normal.chp;
    const defSz = N.sz || 10;
    const out = [];
    // 1) paragraphes : suites de morceaux {t, chp, link} terminées par une marque (\r, \x07, \x0C)
    const paras = [];
    let cur = { runs: [], start: 0 };
    const fields = [];   // pile {instr, result, link}
    let link = null;
    const push = (t, chp) => {
      const last = cur.runs[cur.runs.length - 1];
      if (last && last.link === link && sameChp(last.chp, chp)) last.t += t; else cur.runs.push({ t, chp, link });
    };
    for (let cp = 0; cp < text.length; cp++) {
      const c = text[cp];
      if (c === '\x13') { fields.push({ instr: '', inResult: false, prevLink: link }); continue; }
      if (c === '\x14') { const f = fields[fields.length - 1]; if (f) { f.inResult = true; const m = f.instr.match(/HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i); if (m) link = /\\l/.test(f.instr) ? '#' + m[1] : m[1]; } continue; }
      if (c === '\x15') { const f = fields.pop(); if (f) link = f.prevLink; continue; }
      if (fields.length && !fields[fields.length - 1].inResult) { fields[fields.length - 1].instr += c; continue; }
      if (c === '\r' || c === '\x07' || c === '\x0C') {
        const pap = doc.hasPap ? doc.papAt(cp) : {};
        paras.push(Object.assign(cur, { mark: c, pap }));
        cur = { runs: [], start: cp + 1 };
        continue;
      }
      if (/[\x00-\x06\x08\x0E-\x1D]/.test(c)) continue;   // images, notes, objets : non repris
      const pap = cur.pap0 || (cur.pap0 = doc.hasPap ? doc.papAt(cp) : {});
      const chp = doc.chpAt(cp, pap.style);
      if (chp.vanish) continue;
      push(c === '\x1E' ? '‑' : c === '\x1F' ? '­' : c, chp);
    }
    if (cur.runs.length) paras.push(Object.assign(cur, { mark: '\r', pap: {} }));

    // 2) HTML des paragraphes
    function sameChp(a, b) { return ['b', 'i', 'u', 'strike', 'sz', 'color', 'hl', 'ftc', 'vert', 'caps', 'smallCaps'].every(k => (a[k] ?? null) === (b[k] ?? null)); }
    const runHtml = (r, base) => {
      let h = htmlEsc(r.t).replace(/\x0B/g, '<br>').replace(/\t/g, '<span class="pl-tab">\t</span>');
      const s = [];
      const ch = r.chp;
      if (!!ch.b !== !!base.b) s.push(`font-weight:${ch.b ? 'bold' : 'normal'}`);
      if (!!ch.i !== !!base.i) s.push(`font-style:${ch.i ? 'italic' : 'normal'}`);
      const deco = [ch.u && !base.u && 'underline', ch.strike && !base.strike && 'line-through'].filter(Boolean);
      if (deco.length) s.push(`text-decoration:${deco.join(' ')}`);
      if (ch.sz && ch.sz !== base.sz) s.push(`font-size:${ch.sz}pt`);
      if (ch.color && ch.color !== base.color && ch.color !== '#000000') s.push(`color:${ch.color}`);
      if (ch.hl) s.push(`background-color:${ch.hl}`);
      const f = doc.fontName(ch.ftc), bf = doc.fontName(base.ftc);
      if (f && f !== bf && typeof DocxImport !== 'undefined') s.push(`font-family:${DocxImport.cssFont(f)}`);
      if (ch.caps && !base.caps) s.push('text-transform:uppercase');
      if (ch.smallCaps && !base.smallCaps) s.push('font-variant:small-caps');
      if (s.length) h = `<span style="${s.join(';')}">${h}</span>`;
      if (ch.vert) h = `<${ch.vert}>${h}</${ch.vert}>`;
      if (r.link) h = `<a href="${htmlEsc(r.link)}">${h}</a>`;
      return h;
    };
    const JC = { 1: 'center', 2: 'right', 3: 'justify', 4: 'justify' };
    function paraHtml(P, inCell) {
      const st = P.pap.style || { sti: 0 };
      const sti = st.sti;
      let tag = 'p', cls = '';
      if (!inCell && sti >= 1 && sti <= 6) tag = 'h' + sti;
      else if (!inCell && sti === 62) { tag = 'h1'; cls = 'title'; }
      else if (!inCell && sti === 74) cls = 'subtitle';
      else if (!inCell && /^(heading|titre|überschrift|titolo|kop)\s*([1-6])$/.test(st.name || '')) tag = 'h' + st.name.slice(-1);
      // base de comparaison : style Normal pour un paragraphe, style du titre sinon (l'aspect vient de Plume)
      const base = tag === 'p' && !cls ? Object.assign({}, N, { sz: defSz }) : (st.chp || N);
      const inner = P.runs.map(r => runHtml(r, base)).join('');
      const css = [];
      const NP = doc.normal.pap;
      if (JC[P.pap.jc]) css.push(`text-align:${JC[P.pap.jc]}`);
      if (tag === 'p' && !inCell) {
        if (P.pap.after != null && P.pap.after !== (NP.after || 0)) css.push(`margin-bottom:${P.pap.after}pt`);
        if (P.pap.before != null && P.pap.before !== (NP.before || 0)) css.push(`margin-top:${P.pap.before}pt`);
        if (P.pap.line && P.pap.line !== (NP.line || 1)) css.push(`line-height:${P.pap.line}`);
        if (P.pap.indL && !P.pap.ilfo) css.push(`margin-left:${P.pap.indL}pt`);
        if (P.pap.first && !P.pap.ilfo) css.push(`text-indent:${P.pap.first}pt`);
      }
      return `<${tag}${cls ? ` class="${cls}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}>${inner || '<br>'}</${tag}>`;
    }

    // 3) blocs : tableaux, listes, sauts de page
    let rows = [], row = [], cell = [];   // rows : [{ cells, xs, tc }]
    /** Tableau : grille commune à toutes les lignes (bords des cellules), fusions horizontales et verticales */
    const flushTable = () => {
      if (cell.length) { row.push(cell); cell = []; }
      if (row.length) { rows.push({ cells: row }); row = []; }
      if (!rows.length) return;
      const withXs = rows.filter(r => r.xs && r.xs.length === r.cells.length + 1);
      let grid = null;
      if (withXs.length === rows.length) {
        const pts = [...new Set(withXs.flatMap(r => r.xs))].sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 15);
        if (pts.length >= 2 && pts.length < 66) grid = pts;
      }
      const snap = x => grid.reduce((best, g, i) => Math.abs(g - x) < Math.abs(grid[best] - x) ? i : best, 0);
      const nc = grid ? grid.length - 1 : Math.max(...rows.map(r => r.cells.length));
      const occ = [];   // occ[r][c] = { td } cellule d'origine (fusions verticales)
      const html = rows.map((r, ri) => {
        occ[ri] = [];
        const tds = [];
        let gc = 0;
        r.cells.forEach((content, k) => {
          const tc = (r.tc && r.tc[k]) || {};
          let c0 = gc, c1 = gc + 1;
          if (grid) { c0 = snap(r.xs[k]); c1 = Math.max(c0 + 1, snap(r.xs[k + 1])); }
          gc = c1;
          if (tc.hMerged && !tc.hFirst && tds.length) { tds[tds.length - 1].span += c1 - c0; tds[tds.length - 1].content.push(...content); return; }
          const above = ri > 0 && occ[ri - 1][c0];
          if (tc.vMerge && !tc.vRestart && above) {   // suite d'une fusion verticale
            above.rs++;
            above.content.push(...content.filter(h => !/^<p><br><\/p>$/.test(h)));
            for (let c = c0; c < c1; c++) occ[ri][c] = above;
            return;
          }
          const td = { span: c1 - c0, rs: 1, content: [...content], va: tc.va };
          tds.push(td);
          for (let c = c0; c < c1; c++) occ[ri][c] = td;
        });
        if (!grid) while (tds.reduce((a, t) => a + t.span, 0) < nc) tds.push({ span: 1, rs: 1, content: [] });
        return tds;
      });
      let cg = '', tw = '';
      if (grid) {
        const px = grid.slice(1).map((x, i) => Math.max(8, Math.round((x - grid[i]) / 15)));
        cg = '<colgroup>' + px.map(w => `<col style="width:${w}px">`).join('') + '</colgroup>';
        tw = ` style="width:${px.reduce((a, b) => a + b, 0)}px"`;
      }
      const VA = { 1: 'middle', 2: 'bottom' };
      out.push(`<table data-borders="all"${tw}>${cg}<tbody>` + html.map(tds => '<tr>' + tds.map(t => `<td${t.span > 1 ? ` colspan="${t.span}"` : ''}${t.rs > 1 ? ` rowspan="${t.rs}"` : ''}${VA[t.va] ? ` style="vertical-align:${VA[t.va]}"` : ''}>${t.content.join('') || '<p><br></p>'}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      rows = [];
    };
    let listStack = [];   // [{tag, html[]}]
    const flushList = () => {
      while (listStack.length > 1) { const l = listStack.pop(); const top = listStack[listStack.length - 1]; top.items[top.items.length - 1] += l.open + l.items.map(i => `<li>${i}</li>`).join('') + l.close; }
      if (listStack.length) { const l = listStack.pop(); out.push(l.open + l.items.map(i => `<li>${i}</li>`).join('') + l.close); }
    };
    const listItem = (P, html) => {
      const ilvl = Math.min(8, P.pap.ilvl || 0);
      const nfc = doc.listType(P.pap.ilfo, ilvl);
      const type = NFC[nfc] || 'decimal';
      const tag = nfc === 23 || nfc === 255 ? 'ul' : 'ol';
      while (listStack.length > ilvl + 1) { const l = listStack.pop(); const top = listStack[listStack.length - 1]; top.items[top.items.length - 1] += l.open + l.items.map(i => `<li>${i}</li>`).join('') + l.close; }
      if (listStack.length === ilvl + 1 && (listStack[ilvl].ilfo !== P.pap.ilfo || listStack[ilvl].tag !== tag)) { if (ilvl === 0) flushList(); else { const l = listStack.pop(); const top = listStack[listStack.length - 1]; top.items[top.items.length - 1] += l.open + l.items.map(i => `<li>${i}</li>`).join('') + l.close; } }
      while (listStack.length < ilvl + 1) {
        const st = ['disc', 'decimal'].includes(type) ? '' : ` style="list-style-type:${type}"`;
        listStack.push({ tag, ilfo: P.pap.ilfo, open: `<${tag}${st}>`, close: `</${tag}>`, items: [] });
        if (listStack.length > 1) { const top = listStack[listStack.length - 2]; if (!top.items.length) top.items.push(''); }
      }
      listStack[ilvl].items.push(html.replace(/^<p>([\s\S]*)<\/p>$/, '$1'));
    };

    const fallback = !doc.hasPap;
    let lastWasCell = false;
    for (const P of paras) {
      const inTable = fallback ? P.mark === '\x07' : !!(P.pap.inTable || P.pap.itap);
      if (!fallback && P.pap.pbb && !inTable) { flushList(); flushTable(); out.push(PB); }
      if (inTable) {
        flushList();
        const html = paraHtml(P, true);
        if (fallback) {
          // sans propriétés de paragraphe : marque de cellule vide juste après une cellule = fin de ligne
          if (P.mark === '\x07' && lastWasCell && !P.runs.length && !cell.length) { if (row.length) { rows.push({ cells: row }); row = []; } lastWasCell = false; continue; }
          cell.push(html);
          if (P.mark === '\x07') { row.push(cell); cell = []; lastWasCell = true; }
          continue;
        }
        if (P.mark === '\x07' && P.pap.ttp) {   // fin de ligne
          if (cell.length) { row.push(cell); cell = []; }
          rows.push({ cells: row, xs: P.pap.xs, tc: P.pap.tc }); row = [];
          continue;
        }
        cell.push(html);
        if (P.mark === '\x07') { row.push(cell); cell = []; }
        continue;
      }
      lastWasCell = false;
      flushTable();
      const html = paraHtml(P, false);
      if (P.pap.ilfo && P.runs.length) listItem(P, html);
      else { flushList(); out.push(html); }
      if (P.mark === '\x0C') { flushList(); out.push(PB); }
    }
    flushList(); flushTable();
    return out.join('') || '<p><br></p>';
  }
  const PB = '<hr class="pl-pagebreak" contenteditable="false">';

  function importDoc(buffer) {
    const files = readCfb(buffer);
    const doc = parseDoc(files);
    const html = toHtml(doc);
    // ce qui n'a pas pu être repris : annoncé clairement
    const missing = [];
    if (doc.pictures) missing.push(`${doc.pictures} image${doc.pictures > 1 ? 's' : ''} ou objet${doc.pictures > 1 ? 's' : ''}`);
    if (doc.ccp.hdd > 0) missing.push('les en-têtes et pieds de page');
    if (doc.ccp.ftn > 0 || doc.ccp.edn > 0) missing.push('les notes');
    if (doc.ccp.txbx > 0) missing.push('les zones de texte');
    if (doc.ccp.atn > 0) missing.push('les commentaires');
    const sz = doc.normal.chp.sz || 10;
    const font = doc.defFont || 'Times New Roman';
    return {
      html, simplified: true, missing,
      settings: { font, fontCss: typeof DocxImport !== 'undefined' ? DocxImport.cssFont(font) : font, size: sz, lineHeight: doc.normal.pap.line || 1, after: doc.normal.pap.after || 0, before: doc.normal.pap.before || 0, color: '#000000' }
    };
  }

  /** Repère un fichier OLE2 (.doc, .xls…) */
  const isOle = buf => { const b = new Uint8Array(buf.slice ? buf.slice(0, 8) : buf); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; };

  return { importDoc, isOle, readCfb, parseDoc };
})();
