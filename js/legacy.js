/* =====================================================================
   Plume — anciens formats Word (.doc, .dot — Word 97 à 2003)
   Lecture du conteneur OLE (Compound File Binary) et de la table des
   pièces du flux WordDocument. Récupère le texte, les paragraphes,
   les tableaux et les sauts de page.
   Dans l'application de bureau, si LibreOffice est installé, le module
   de conversion est utilisé à la place pour conserver toute la mise en forme.
   ===================================================================== */
'use strict';

const LegacyDoc = (() => {

  /** Lecture d'un fichier composé OLE2 → { nom: Uint8Array } */
  function readCfb(buf) {
    const b = new Uint8Array(buf);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (!sig.every((v, i) => b[i] === v)) throw new Error('Ce fichier n’est pas un document Word 97-2003 (.doc).');
    const ssz = 1 << dv.getUint16(0x1E, true);
    const mssz = 1 << dv.getUint16(0x20, true);
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
    const chain = (start, table) => { const out = []; let s = start, guard = 0; while (s < 0xFFFFFFFA && guard++ < 1e6) { out.push(s); s = table[s]; } return out; };
    const readChain = (start, size) => {
      const out = new Uint8Array(size === undefined ? chain(start, fat).length * ssz : size);
      let pos = 0;
      for (const s of chain(start, fat)) {
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
    const files = {};
    for (const e of entries) {
      if (e.type !== 2) continue;
      if (e.size < cutoff) {
        const out = new Uint8Array(e.size); let pos = 0;
        for (const s of chain(e.start, minifat)) { const n = Math.min(mssz, e.size - pos); if (n <= 0) break; out.set(ministream.subarray(s * mssz, s * mssz + n), pos); pos += n; }
        files[e.name] = out;
      } else files[e.name] = readChain(e.start, e.size);
    }
    return files;
  }

  /** Texte du document principal (table des pièces) */
  function extractText(files) {
    const wd = files['WordDocument'];
    if (!wd) throw new Error('Flux WordDocument introuvable : ce n’est pas un document Word.');
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('Format Word non reconnu (version antérieure à Word 97 ?).');
    const flags = dv.getUint16(0x0A, true);
    if (flags & 0x0100) throw new Error('Ce document Word est protégé par un mot de passe.');
    const table = files[(flags & 0x0200) ? '1Table' : '0Table'];
    if (!table) throw new Error('Table du document introuvable.');
    let p = 32;
    const csw = dv.getUint16(p, true); p += 2 + csw * 2;
    const cslw = dv.getUint16(p, true);
    const lw = p + 2;
    const ccpText = dv.getInt32(lw + 3 * 4, true);
    p = lw + cslw * 4;
    p += 2; // cbRgFcLcb
    const fcClx = dv.getUint32(p + 33 * 8, true), lcbClx = dv.getUint32(p + 33 * 8 + 4, true);   // FibRgFcLcb97 : fcClx = 34e paire
    const tdv = new DataView(table.buffer, table.byteOffset, table.byteLength);
    let q = fcClx;
    const end = fcClx + lcbClx;
    while (q < end && table[q] === 0x01) q += 3 + tdv.getInt16(q + 1, true);
    if (table[q] !== 0x02) throw new Error('Structure du document illisible.');
    const lcb = tdv.getUint32(q + 1, true); q += 5;
    const n = (lcb - 4) / 12;
    const cps = []; for (let i = 0; i <= n; i++) cps.push(tdv.getUint32(q + i * 4, true));
    const pcdBase = q + (n + 1) * 4;
    const cp1252 = new TextDecoder('windows-1252');
    let text = '';
    for (let i = 0; i < n && text.length < ccpText; i++) {
      let fc = tdv.getUint32(pcdBase + i * 8 + 2, true);
      const count = cps[i + 1] - cps[i];
      const compressed = (fc & 0x40000000) !== 0;
      if (compressed) { fc = (fc & ~0x40000000) >>> 1; text += cp1252.decode(wd.subarray(fc, fc + count)); }
      else { let s = ''; for (let k = 0; k < count; k++) s += String.fromCharCode(dv.getUint16(fc + k * 2, true)); text += s; }
    }
    return text.slice(0, ccpText > 0 ? ccpText : undefined);
  }

  /** Texte Word → HTML Plume */
  function toHtml(text) {
    // champs : on garde le résultat (entre \x14 et \x15)
    let t = '', depth = 0, inInstr = [];
    for (const c of text) {
      if (c === '\x13') { depth++; inInstr.push(true); continue; }
      if (c === '\x14') { inInstr[inInstr.length - 1] = false; continue; }
      if (c === '\x15') { depth--; inInstr.pop(); continue; }
      if (inInstr.some(Boolean)) continue;
      t += c;
    }
    t = t.replace(/[\x01\x08\x02\x05]/g, '').replace(/\x1E/g, '‑').replace(/\x1F/g, '­').replace(/\x0B/g, '\n');
    const html = [];
    let row = [], rows = [];
    const flushTable = () => {
      if (row.length) { rows.push(row); row = []; }
      if (rows.length) {
        const n = Math.max(...rows.map(r => r.length));
        html.push('<table data-borders="all"><tbody>' + rows.map(r => '<tr>' + Array.from({ length: n }, (x, k) => `<td><p>${fmt(r[k] || '') || '<br>'}</p></td>`).join('') + '</tr>').join('') + '</tbody></table>');
      }
      rows = [];
    };
    const fmt = s => htmlEsc(s).replace(/\n/g, '<br>').replace(/\t/g, '<span class="pl-tab">\t</span>');
    // découpage en paragraphes (\r) et cellules (\x07)
    let buf = '';
    let lastWasCell = false;
    for (const c of t) {
      if (c === '\x07') {
        if (lastWasCell && buf === '') { if (row.length) { rows.push(row); row = []; } lastWasCell = false; continue; } // marque de fin de ligne
        row.push(buf); buf = ''; lastWasCell = true; continue;
      }
      if (c === '\r' || c === '\x0C') {
        if (lastWasCell && !row.length && !buf) { lastWasCell = false; }
        if (row.length || rows.length) { if (lastWasCell) { buf += '\n'; continue; } flushTable(); }
        html.push(buf.trim() || c === '\x0C' ? `<p>${fmt(buf) || '<br>'}</p>` : '<p><br></p>');
        if (c === '\x0C') html.push('<hr class="pl-pagebreak" contenteditable="false">');
        buf = ''; lastWasCell = false; continue;
      }
      if (lastWasCell && c !== '\r') { lastWasCell = false; }
      buf += c;
    }
    if (row.length || rows.length) flushTable();
    if (buf) html.push(`<p>${fmt(buf)}</p>`);
    return html.join('') || '<p><br></p>';
  }

  function importDoc(buffer) {
    const files = readCfb(buffer);
    const text = extractText(files);
    return { html: toHtml(text), simplified: true };
  }

  /** Repère un fichier OLE2 (.doc, .xls…) */
  const isOle = buf => { const b = new Uint8Array(buf.slice ? buf.slice(0, 8) : buf); return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0; };

  return { importDoc, isOle, readCfb };
})();
