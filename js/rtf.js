/* =====================================================================
   Plume — Rich Text Format (.rtf)
   Lu par tous les traitements de texte (WordPad, TextEdit, Word, Writer…).
   ===================================================================== */
'use strict';

const Rtf = (() => {

  /* =====================================================================
     LECTURE
     ===================================================================== */
  function importRtf(buffer, opts = {}) {
    const bytes = new Uint8Array(buffer);
    let src = '';
    for (let i = 0; i < bytes.length; i++) src += String.fromCharCode(bytes[i]);
    if (!/^\s*\{\\rtf/.test(src)) throw new Error('Ce fichier n’est pas un document RTF valide.');

    let codepage = 'windows-1252';
    const m = src.match(/\\ansicpg(\d+)/);
    if (m) codepage = m[1] === '65001' ? 'utf-8' : 'windows-' + m[1];
    let dec;
    try { dec = new TextDecoder(codepage); } catch { dec = new TextDecoder('windows-1252'); }
    const decodeByte = b => dec.decode(new Uint8Array([b]));

    const fonts = {}, colors = [null];
    let title = '', author = '';
    const page = { w: 12240 / 15, h: 15840 / 15, mt: 1440 / 15, mr: 1800 / 15, mb: 1440 / 15, ml: 1800 / 15, mh: 720 / 15, mf: 720 / 15 };
    let pageSet = false;

    // état de caractère / paragraphe
    const freshChar = () => ({ b: false, i: false, u: false, s: false, f: null, fs: 24, cf: 0, hl: 0, sup: false, sub: false, caps: false, hidden: false });
    const freshPara = () => ({ align: null, li: 0, ri: 0, fi: 0, sb: 0, sa: 0, intbl: false, sl: 0, slmult: 0, outline: -1, pageBreakBefore: false });
    let ch = freshChar(), pa = freshPara();
    let uc = 1;
    const stack = [];

    // sortie
    const out = [];            // blocs HTML ou lignes de tableau
    let cur = '';              // paragraphe courant (HTML)
    let curRaw = '';           // texte du paragraphe courant
    let table = null;          // {rows:[[cells]], row:[], cellHtml:'' , widths:[]}
    let header = '', footer = '';
    let dest = null;           // destination spéciale en cours {type, depth, buf}
    let field = null;          // {inst, rslt, depth}
    let pict = null;           // {hex:'', type, w, h, gw, gh, depth}

    const fontCss = n => fonts[n] ? DocxImport.cssFont(fonts[n]) : null;
    const runCss = c => {
      const s = [];
      if (c.b) s.push('font-weight:bold');
      if (c.i) s.push('font-style:italic');
      const d = [c.u && 'underline', c.s && 'line-through'].filter(Boolean);
      if (d.length) s.push('text-decoration:' + d.join(' '));
      if (c.f != null && fontCss(c.f) && c.f !== defFont) s.push('font-family:' + fontCss(c.f));
      if (c.fs && c.fs !== 24) s.push(`font-size:${c.fs / 2}pt`);
      if (c.cf && colors[c.cf]) s.push('color:' + colors[c.cf]);
      if (c.hl && colors[c.hl]) s.push('background-color:' + colors[c.hl]);
      if (c.caps) s.push('text-transform:uppercase');
      return s.join(';');
    };
    let defFont = 0;
    let lastCss = null, spanOpen = false;
    const emitText = t => {
      if (!t) return;
      if (dest) { dest.buf += t; return; }
      if (field && field.phase === 'inst') { field.inst += t; return; }
      if (ch.hidden) return;
      const css = runCss(ch);
      const key = css + (ch.sup ? '^' : ch.sub ? '_' : '');
      let html = xmlEsc(t);
      if (ch.sup) html = `<sup>${html}</sup>`; else if (ch.sub) html = `<sub>${html}</sub>`;
      const target = field && field.phase === 'rslt' ? 'field' : 'cur';
      const wrapped = css ? `<span style="${css}">${html}</span>` : html;
      if (target === 'field') field.rslt += wrapped; else { cur += wrapped; curRaw += t; }
      lastCss = key;
    };
    const emitRaw = h => { if (dest) return; if (field && field.phase === 'rslt') field.rslt += h; else cur += h; };

    const paraCss = () => {
      const s = [];
      if (pa.align) s.push('text-align:' + pa.align);
      if (pa.li) s.push(`margin-left:${pa.li / 20}pt`);
      if (pa.ri) s.push(`margin-right:${pa.ri / 20}pt`);
      if (pa.fi) s.push(`text-indent:${pa.fi / 20}pt`);
      s.push(`margin-top:${pa.sb / 20}pt`, `margin-bottom:${pa.sa / 20}pt`);
      if (pa.sl) s.push(pa.slmult ? `line-height:${Math.round(Math.abs(pa.sl) / 240 * 100) / 100}` : `line-height:${Math.abs(pa.sl) / 20}pt`);
      return s.join(';');
    };
    const endPara = () => {
      if (dest) { dest.buf += '\n'; return; }
      const content = cur || '<br>';
      if (pa.intbl && table) {
        table.cell += `<p style="margin:0">${content}</p>`;
      } else {
        flushTable();
        if (pa.pageBreakBefore) out.push('<hr class="pl-pagebreak" contenteditable="false">');
        const tag = pa.outline >= 0 && pa.outline < 6 ? 'h' + (pa.outline + 1) : 'p';
        out.push(`<${tag} style="${paraCss()}">${content}</${tag}>`);
      }
      cur = ''; curRaw = '';
    };
    const flushTable = () => {
      if (!table) return;
      if (table.row.length || table.cell) { if (table.cell) table.row.push(table.cell); table.rows.push({ cells: table.row, widths: table.widths }); }
      if (table.rows.length) {
        const w = table.rows[0].widths;
        let h = '<table data-borders="all">';
        if (w && w.length) h += '<colgroup>' + w.map(x => `<col style="width:${Math.max(20, Math.round(x / 15))}px">`).join('') + '</colgroup>';
        h += '<tbody>' + table.rows.map(r => '<tr>' + r.cells.map(c => `<td>${c || '<p><br></p>'}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
        out.push(h);
      }
      table = null;
    };

    // destinations ignorées
    const SKIP = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'filetbl', 'revtbl', 'pgdsctbl', 'mmathPr', 'fldinst', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl', 'footerr', 'footerf', 'footnote', 'annotation', 'atnid', 'atnauthor', 'bkmkstart', 'bkmkend', 'shp', 'shpinst', 'nonshppict', 'pntxta', 'pntxtb', 'title', 'author', 'operator', 'company', 'doccomm', 'keywords', 'subject', 'creatim', 'revtim', 'printim', 'buptim', 'userprops', 'docvar', 'template', 'wgrffmtfilter', 'defchp', 'defpap', 'fchars', 'lchars', 'blipuid', 'xe', 'tc', 'shppict']);

    let i = 0;
    const n = src.length;
    let groupDepth = 0;
    let skipDepth = -1;          // profondeur à partir de laquelle on ignore
    let starNext = false;
    let fontTbl = null, colorTbl = null, infoTbl = null;
    let curFont = null, colorBuf = { r: 0, g: 0, b: 0, any: false };
    let fnDepth = -1, fnBuf = '';
    let hfDepth = -1, hfType = null, hfSaved = null;

    while (i < n) {
      const c = src[i];
      if (c === '{') {
        stack.push({ ch: { ...ch }, pa: { ...pa }, uc });
        groupDepth++; i++;
        starNext = false;
        continue;
      }
      if (c === '}') {
        // fin de groupe
        if (skipDepth === groupDepth) skipDepth = -1;
        if (fontTbl && fontTbl.depth === groupDepth) { /* fin d'une entrée de police */ }
        if (fontTbl && groupDepth === fontTbl.depth - 1) fontTbl = null;
        if (colorTbl && colorTbl.depth === groupDepth) colorTbl = null;
        if (pict && pict.depth === groupDepth) { finishPict(); pict = null; }
        if (field && field.instDepth === groupDepth) field.phase = 'between';
        if (field && field.rsltDepth === groupDepth) field.phase = 'done';
        if (field && field.depth === groupDepth) finishField();
        if (infoTbl && infoTbl.depth === groupDepth) { if (infoTbl.kind === 'title') title = infoTbl.buf.trim(); if (infoTbl.kind === 'author') author = infoTbl.buf.trim(); infoTbl = null; dest = null; }
        if (fnDepth === groupDepth) { emitRaw(`<span class="pl-fn" contenteditable="false" data-note="${xmlEsc(fnBuf.trim())}">*</span>`); fnDepth = -1; dest = null; }
        if (hfDepth === groupDepth) {
          endParaIfAny();
          const html = out.splice(hfSaved.len).join('');
          if (hfType === 'header') header = header || html; else footer = footer || html;
          cur = hfSaved.cur; pa = hfSaved.pa;
          hfDepth = -1;
        }
        const st = stack.pop();
        if (st) { ch = st.ch; pa = { ...st.pa, intbl: pa.intbl && st.pa.intbl ? true : st.pa.intbl }; uc = st.uc; }
        groupDepth--; i++;
        continue;
      }
      if (c === '\\') {
        const nx = src[i + 1];
        if (nx === '\\' || nx === '{' || nx === '}') { if (skipDepth < 0) handleText(nx); i += 2; continue; }
        if (nx === '*') { starNext = true; i += 2; continue; }
        if (nx === "'") {
          const hex = src.substr(i + 2, 2);
          if (skipDepth < 0) handleText(decodeByte(parseInt(hex, 16)));
          i += 4; continue;
        }
        if (nx === '~') { if (skipDepth < 0) handleText('\u00A0'); i += 2; continue; }
        if (nx === '-') { i += 2; continue; }
        if (nx === '_') { if (skipDepth < 0) handleText('\u2011'); i += 2; continue; }
        if (nx === '\n' || nx === '\r') { if (skipDepth < 0) endPara(); i += 2; continue; }
        // mot de contrôle
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(src[j])) j++;
        const word = src.slice(i + 1, j);
        let param = null;
        let k = j;
        if (src[k] === '-' || /\d/.test(src[k] || '')) {
          let e = k + 1;
          while (e < n && /\d/.test(src[e])) e++;
          param = parseInt(src.slice(k, e), 10);
          k = e;
        }
        if (src[k] === ' ') k++;
        i = k;
        control(word, param);
        continue;
      }
      if (c === '\r' || c === '\n') { i++; continue; }
      // texte brut
      let j = i;
      while (j < n && !'\\{}\r\n'.includes(src[j])) j++;
      if (skipDepth < 0) handleText(decodeBytes(src.slice(i, j)));
      else if (pict && skipDepth === -2) { /* */ }
      i = j;
    }
    endParaIfAny();
    flushTable();

    function decodeBytes(s) {
      const b = new Uint8Array(s.length);
      for (let q = 0; q < s.length; q++) b[q] = s.charCodeAt(q) & 255;
      return dec.decode(b);
    }
    function endParaIfAny() { if (cur || curRaw) endPara(); }
    function handleText(t) {
      if (pict) { pict.hex += t.replace(/[^0-9a-fA-F]/g, ''); return; }
      if (fontTbl && curFont != null) { fonts[curFont] = ((fonts[curFont] || '') + t).replace(/;\s*$/, ''); return; }
      if (colorTbl) { if (t.includes(';')) { colors.push(colorBuf.any ? '#' + [colorBuf.r, colorBuf.g, colorBuf.b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase() : null); colorBuf = { r: 0, g: 0, b: 0, any: false }; } return; }
      if (infoTbl) { infoTbl.buf += t; return; }
      if (fnDepth >= 0) { fnBuf += t; return; }
      emitText(t);
    }
    function finishPict() {
      if (!pict.hex || !pict.type) return;
      const bytes = new Uint8Array(pict.hex.length >> 1);
      for (let q = 0; q < bytes.length; q++) bytes[q] = parseInt(pict.hex.substr(q * 2, 2), 16);
      const blob = new Blob([bytes], { type: pict.type });
      const url = opts.registerImage ? opts.registerImage(blob) : URL.createObjectURL(blob);
      const w = pict.gw ? Math.round(pict.gw / 15 * (pict.sx || 100) / 100) : null;
      const h = pict.gh ? Math.round(pict.gh / 15 * (pict.sy || 100) / 100) : null;
      emitRaw(`<img src="${url}" alt="" style="${w ? `width:${w}px;height:${h}px` : ''}">`);
    }
    function finishField() {
      const f = field; field = null;
      const inst = f.inst.trim();
      const hm = inst.match(/HYPERLINK\s+"([^"]+)"/i);
      if (/^PAGE\b/i.test(inst)) emitRaw('<span class="pl-field" contenteditable="false" data-field="page">1</span>');
      else if (/^NUMPAGES\b/i.test(inst)) emitRaw('<span class="pl-field" contenteditable="false" data-field="numpages">1</span>');
      else if (hm && !/^\s*javascript:/i.test(hm[1])) emitRaw(`<a href="${xmlEsc(hm[1])}">${f.rslt}</a>`);
      else emitRaw(f.rslt);
    }

    function control(w, p) {
      const star = starNext; starNext = false;
      // destinations
      if (w === 'fonttbl') { fontTbl = { depth: groupDepth + 1 }; skipDepth = -1; return; }
      if (w === 'colortbl') { colorTbl = { depth: groupDepth }; return; }
      if (w === 'info') { return; }
      if (w === 'title' || w === 'author') { infoTbl = { depth: groupDepth, kind: w, buf: '' }; dest = { buf: '' }; return; }
      if (w === 'pict') { pict = { depth: groupDepth, hex: '', type: null }; skipDepth = -1; return; }
      if (pict) {
        if (w === 'pngblip') pict.type = 'image/png';
        else if (w === 'jpegblip') pict.type = 'image/jpeg';
        else if (w === 'emfblip' || w === 'wmetafile' || w === 'macpict' || w === 'dibitmap' || w === 'wbitmap') pict.type = null;
        else if (w === 'picwgoal') pict.gw = p; else if (w === 'pichgoal') pict.gh = p;
        else if (w === 'picscalex') pict.sx = p; else if (w === 'picscaley') pict.sy = p;
        else if (w === 'bin') { /* données binaires brutes : rare, ignoré */ }
        return;
      }
      if (w === 'field') { field = { depth: groupDepth, inst: '', rslt: '', phase: 'start' }; return; }
      if (w === 'fldinst' && field) { field.phase = 'inst'; field.instDepth = groupDepth; return; }
      if (w === 'fldrslt' && field) { field.phase = 'rslt'; field.rsltDepth = groupDepth; return; }
      if (w === 'footnote') { fnDepth = groupDepth; fnBuf = ''; dest = { buf: '' }; return; }
      if (['header', 'headerr', 'footer', 'footerr'].includes(w)) {
        hfDepth = groupDepth; hfType = w.startsWith('header') ? 'header' : 'footer';
        hfSaved = { len: out.length, cur, pa: { ...pa } }; cur = ''; return;
      }
      if (fnDepth >= 0) { if (w === 'par') fnBuf += '\n'; if (w === 'u') fnBuf += String.fromCharCode(p < 0 ? p + 65536 : p); return; }
      if (fontTbl) {
        if (w === 'f') curFont = p;
        return;
      }
      if (colorTbl) {
        if (w === 'red') { colorBuf.r = p; colorBuf.any = true; } else if (w === 'green') { colorBuf.g = p; colorBuf.any = true; } else if (w === 'blue') { colorBuf.b = p; colorBuf.any = true; }
        return;
      }
      if (star || SKIP.has(w)) { if (skipDepth < 0) skipDepth = groupDepth; return; }
      if (skipDepth >= 0) return;

      switch (w) {
        case 'deff': defFont = p; break;
        case 'paperw': page.w = p / 15; pageSet = true; break;
        case 'paperh': page.h = p / 15; break;
        case 'margl': page.ml = p / 15; break;
        case 'margr': page.mr = p / 15; break;
        case 'margt': page.mt = p / 15; break;
        case 'margb': page.mb = p / 15; break;
        case 'headery': page.mh = p / 15; break;
        case 'footery': page.mf = p / 15; break;
        case 'uc': uc = p; break;
        case 'u': {
          handleText(String.fromCharCode(p < 0 ? p + 65536 : p));
          // sauter les caractères de remplacement
          let skip = uc;
          while (skip > 0 && i < n) {
            if (src[i] === '\\' && src[i + 1] === "'") { i += 4; skip--; }
            else if (src[i] === '\\' || src[i] === '{' || src[i] === '}') break;
            else { i++; skip--; }
          }
          break;
        }
        case 'par': endPara(); break;
        case 'sect': endPara(); break;
        case 'line': emitRaw('<br>'); break;
        case 'tab': emitRaw('<span class="pl-tab">\t</span>'); break;
        case 'page': endParaIfAny(); flushTable(); out.push('<hr class="pl-pagebreak" contenteditable="false">'); break;
        case 'pagebb': pa.pageBreakBefore = true; break;
        case 'emdash': handleText('—'); break;
        case 'endash': handleText('–'); break;
        case 'bullet': handleText('•'); break;
        case 'lquote': handleText('‘'); break;
        case 'rquote': handleText('’'); break;
        case 'ldblquote': handleText('“'); break;
        case 'rdblquote': handleText('”'); break;
        case 'emspace': case 'enspace': case 'qmspace': handleText(' '); break;
        case 'pard': { const intbl = false; pa = freshPara(); pa.intbl = intbl; break; }
        case 'plain': ch = freshChar(); ch.f = defFont; break;
        case 'b': ch.b = p !== 0; break;
        case 'i': ch.i = p !== 0; break;
        case 'ul': ch.u = p !== 0; break;
        case 'uld': case 'uldb': case 'ulw': case 'uldash': case 'ulwave': ch.u = p !== 0; break;
        case 'ulnone': ch.u = false; break;
        case 'strike': case 'striked': ch.s = p !== 0; break;
        case 'caps': ch.caps = p !== 0; break;
        case 'v': ch.hidden = p !== 0; break;
        case 'f': ch.f = p; break;
        case 'fs': ch.fs = p; break;
        case 'cf': ch.cf = p; break;
        case 'highlight': case 'cb': case 'chcbpat': ch.hl = p; break;
        case 'super': ch.sup = true; ch.sub = false; break;
        case 'sub': ch.sub = true; ch.sup = false; break;
        case 'nosupersub': ch.sup = ch.sub = false; break;
        case 'ql': pa.align = null; break;
        case 'qc': pa.align = 'center'; break;
        case 'qr': pa.align = 'right'; break;
        case 'qj': pa.align = 'justify'; break;
        case 'li': pa.li = p; break;
        case 'ri': pa.ri = p; break;
        case 'fi': pa.fi = p; break;
        case 'sb': pa.sb = p; break;
        case 'sa': pa.sa = p; break;
        case 'sl': pa.sl = p; break;
        case 'slmult': pa.slmult = p; break;
        case 'outlinelevel': pa.outline = p; break;
        case 'intbl': pa.intbl = true; if (!table) table = { rows: [], row: [], cell: '', widths: [] }; break;
        case 'trowd': if (!table) table = { rows: [], row: [], cell: '', widths: [] }; table.pendingWidths = []; table.lastX = 0; break;
        case 'cellx': if (table) { table.pendingWidths = table.pendingWidths || []; table.pendingWidths.push(p - (table.lastX || 0)); table.lastX = p; } break;
        case 'cell': if (table) { if (cur) { table.cell += `<p style="margin:0">${cur}</p>`; cur = ''; curRaw = ''; } table.row.push(table.cell); table.cell = ''; } break;
        case 'row': if (table) { table.rows.push({ cells: table.row, widths: table.pendingWidths || table.widths }); table.row = []; table.cell = ''; } pa.intbl = false; break;
      }
    }

    const html = out.join('') || '<p><br></p>';
    return {
      html, header, footer,
      page: pageSet ? page : undefined,
      settings: { fontCss: fonts[defFont] ? DocxImport.cssFont(fonts[defFont]) : undefined, size: 12, after: 0, lineHeight: 1.15 },
      props: { title, author }
    };
  }

  /* =====================================================================
     ÉCRITURE
     ===================================================================== */
  async function exportRtf({ editor, headerEl, footerEl, page, props }) {
    const fonts = [], colors = [null];
    const fontIdx = f => { let i = fonts.indexOf(f); if (i < 0) { fonts.push(f); i = fonts.length - 1; } return i; };
    const colorIdx = hex => { if (!hex) return 0; let i = colors.indexOf(hex); if (i < 0) { colors.push(hex); i = colors.length - 1; } return i; };
    const tw = px => Math.round(px * 15);
    const esc = s => {
      let o = '';
      for (const c of s) {
        const code = c.codePointAt(0);
        if (c === '\\' || c === '{' || c === '}') o += '\\' + c;
        else if (c === '\t') o += '\\tab ';
        else if (c === '\n') o += '\\line ';
        else if (c === '\u00A0') o += '\\~';
        else if (code < 128) o += c;
        else if (code > 0xFFFF) { const s2 = String.fromCodePoint(code); o += `\\u${s2.charCodeAt(0) - 65536}?\\u${s2.charCodeAt(1) - 65536}?`; }
        else o += `\\u${code > 32767 ? code - 65536 : code}?`;
      }
      return o;
    };
    const imgs = new Map();
    for (const img of editor.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || imgs.has(src)) continue;
      try {
        let blob = await (await fetch(src)).blob();
        let type = blob.type;
        if (type !== 'image/png' && type !== 'image/jpeg') {
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0); blob = await new Promise(r => c.toBlob(r, 'image/png')); type = 'image/png';
        }
        const b = new Uint8Array(await blob.arrayBuffer());
        let hex = ''; for (let q = 0; q < b.length; q++) { hex += b[q].toString(16).padStart(2, '0'); if (q % 64 === 63) hex += '\n'; }
        imgs.set(src, { hex, type });
      } catch { }
    }
    const runProps = (node, blockEl) => {
      const pe = node.nodeType === 1 ? node : node.parentElement;
      const c = getComputedStyle(pe);
      let p = `\\f${fontIdx(c.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''))}\\fs${Math.round(parseFloat(c.fontSize) * 1.5)}`;
      if (parseInt(c.fontWeight, 10) >= 600) p += '\\b';
      if (c.fontStyle === 'italic') p += '\\i';
      const col = colorIdx(rgbToHex(c.color));
      if (col) p += `\\cf${col}`;
      let u = false, s = false, hl = null, pos = null;
      for (let a = pe; a && a !== blockEl.parentElement && a !== editor; a = a.parentElement) {
        const ac = getComputedStyle(a);
        if ((ac.textDecorationLine || '').includes('underline') || a.tagName === 'U') u = true;
        if ((ac.textDecorationLine || '').includes('line-through') || a.tagName === 'S') s = true;
        if (!hl && a !== blockEl) hl = rgbToHex(ac.backgroundColor);
        if (!pos && (a.tagName === 'SUP' || ac.verticalAlign === 'super')) pos = 'super';
        if (!pos && (a.tagName === 'SUB' || ac.verticalAlign === 'sub')) pos = 'sub';
      }
      if (u) p += '\\ul'; if (s) p += '\\strike'; if (hl) p += `\\chcbpat${colorIdx(hl)}\\cb${colorIdx(hl)}`;
      if (pos) p += '\\' + pos;
      if (c.textTransform === 'uppercase') p += '\\caps';
      return p;
    };
    const runs = (nodes, blockEl) => {
      let o = '';
      for (const n of nodes) {
        if (n.nodeType === 3) { const t = n.data.replace(/\u200B/g, ''); if (t) o += `{\\plain${runProps(n, blockEl)} ${esc(n.parentElement.closest('pre') ? t : t.replace(/\n/g, ' '))}}`; continue; }
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'BR') { o += '\\line '; continue; }
        if (n.tagName === 'IMG') {
          const d = imgs.get(n.getAttribute('src'));
          if (d) { const w = n.offsetWidth || 200, h = n.offsetHeight || 150; o += `{\\pict\\${d.type === 'image/png' ? 'pngblip' : 'jpegblip'}\\picw${tw(w)}\\pich${tw(h)}\\picwgoal${tw(w)}\\pichgoal${tw(h)}\n${d.hex}}`; }
          continue;
        }
        if (n.classList.contains('pl-field')) { o += `{\\field{\\*\\fldinst ${n.dataset.field === 'page' ? 'PAGE' : 'NUMPAGES'}}{\\fldrslt ${esc(n.textContent)}}}`; continue; }
        if (n.classList.contains('pl-fn')) { o += `{\\super\\chftn}{\\footnote\\pard\\plain{\\super\\chftn} ${esc(n.dataset.note || '')}}`; continue; }
        if (n.classList.contains('pl-del') || n.classList.contains('pl-cstart') || n.classList.contains('pl-cend') || n.classList.contains('pl-cref')) continue;
        if (n.classList.contains('pl-island')) { o += runs(Array.from(n.querySelectorAll('img')), blockEl); continue; }
        if (n.classList.contains('pl-tab')) { o += '\\tab '; continue; }
        if (n.tagName === 'A' && n.getAttribute('href')) { o += `{\\field{\\*\\fldinst HYPERLINK "${esc(n.getAttribute('href'))}"}{\\fldrslt ${runs(Array.from(n.childNodes), blockEl)}}}`; continue; }
        if (n.contentEditable === 'false') continue;
        o += runs(Array.from(n.childNodes), blockEl);
      }
      return o;
    };
    const paraProps = (e, extra = '') => {
      const c = getComputedStyle(e);
      let p = '\\pard\\plain';
      const al = { center: '\\qc', right: '\\qr', end: '\\qr', justify: '\\qj' }[c.textAlign] || '\\ql';
      p += al;
      p += `\\li${tw(parseFloat(c.marginLeft) || 0)}\\ri${tw(parseFloat(c.marginRight) || 0)}\\fi${tw(parseFloat(c.textIndent) || 0)}\\sb${tw(parseFloat(c.marginTop) || 0)}\\sa${tw(parseFloat(c.marginBottom) || 0)}`;
      if (e.style.lineHeight && /^[\d.]+$/.test(e.style.lineHeight)) p += `\\sl${Math.round(240 * parseFloat(e.style.lineHeight))}\\slmult1`;
      if (/^H[1-6]$/.test(e.tagName)) p += `\\outlinelevel${+e.tagName[1] - 1}`;
      return p + extra;
    };
    const isBlock = n => n.nodeType === 1 && /^(P|H[1-6]|DIV|BLOCKQUOTE|PRE|UL|OL|LI|TABLE|HR)$/.test(n.tagName);
    let pageBreakNext = false;
    const blocks = (container, inCell) => {
      let o = '', inl = [];
      const flush = () => { if (inl.some(x => x.nodeType === 1 || x.textContent.trim())) o += paraProps(container, inCell ? '\\intbl' : '') + ' ' + runs(inl, container) + (inCell ? '' : '\\par\n'); inl = []; };
      for (const n of Array.from(container.childNodes)) {
        if (!isBlock(n)) { inl.push(n); continue; }
        flush();
        o += block(n, inCell);
      }
      flush();
      return o;
    };
    const block = (e, inCell) => {
      const t = e.tagName;
      if (t === 'HR') { if (e.classList.contains('pl-pagebreak')) { pageBreakNext = true; return ''; } return '\\pard\\brdrb\\brdrs\\brdrw10\\brsp20 \\par\n'; }
      if (t === 'TABLE') return table(e);
      if (t === 'UL' || t === 'OL') return list(e, 0);
      if (Array.from(e.children).some(isBlock)) return blocks(e, inCell);
      const pb = pageBreakNext ? '\\pagebb' : ''; pageBreakNext = false;
      return paraProps(e, (inCell ? '\\intbl' : '') + pb) + ' ' + runs(Array.from(e.childNodes), e) + (inCell ? '' : '\\par\n');
    };
    const list = (L, level) => {
      let o = '', k = parseInt(L.getAttribute('start') || '1', 10);
      const type = getComputedStyle(L).listStyleType;
      for (const li of Array.from(L.children)) {
        if (li.tagName !== 'LI') continue;
        const label = L.tagName === 'OL' ? (type === 'lower-alpha' ? String.fromCharCode(96 + k) : type === 'upper-alpha' ? String.fromCharCode(64 + k) : type === 'lower-roman' ? roman(k).toLowerCase() : type === 'upper-roman' ? roman(k) : String(k)) + '.' : (type === 'circle' ? '◦' : type === 'square' ? '▪' : '•');
        k++;
        const inl = [], subs = [];
        for (const n of Array.from(li.childNodes)) (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL') ? subs : inl).push(n);
        const ind = 360 * (level + 1) + 360;
        o += `\\pard\\plain\\li${ind}\\fi-360\\sa0 {\\plain ${esc(label)}\\tab}` + runs(inl, li) + '\\par\n';
        for (const s of subs) o += list(s, level + 1);
      }
      return o;
    };
    const roman = num => { const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let r = ''; for (const [v, s] of m) while (num >= v) { r += s; num -= v; } return r; };
    const table = T => {
      let o = '';
      const borders = T.dataset.borders !== 'none';
      for (const tr of Array.from(T.rows)) {
        o += '\\trowd\\trgaph108\\trleft0';
        let x = 0;
        for (const td of Array.from(tr.cells)) {
          x += tw(td.getBoundingClientRect().width || 100);
          const bg = rgbToHex(getComputedStyle(td).backgroundColor);
          o += (borders ? '\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10' : '') + (bg ? `\\clcbpat${colorIdx(bg)}` : '') + `\\cellx${x}`;
        }
        o += '\n';
        for (const td of Array.from(tr.cells)) {
          const inner = blocks(td, true);
          o += (inner || '\\pard\\intbl ') + '\\cell\n';
        }
        o += '\\row\n';
      }
      return o + '\\pard\n';
    };

    const body = blocks(editor, false);
    const hdr = headerEl && headerEl.textContent.trim() ? `{\\header ${blocks(headerEl, false)}}` : '';
    const ftr = footerEl && (footerEl.textContent.trim() || footerEl.querySelector('.pl-field')) ? `{\\footer ${blocks(footerEl, false)}}` : '';
    const fonttbl = '{\\fonttbl' + fonts.map((f, i) => `{\\f${i}\\fnil\\fcharset0 ${esc(f)};}`).join('') + '}';
    const colortbl = '{\\colortbl ;' + colors.slice(1).map(h => `\\red${parseInt(h.slice(1, 3), 16)}\\green${parseInt(h.slice(3, 5), 16)}\\blue${parseInt(h.slice(5, 7), 16)};`).join('') + '}';
    const info = `{\\info{\\title ${esc(props.title || '')}}{\\author ${esc(props.author || '')}}}`;
    const pg = `\\paperw${tw(page.w)}\\paperh${tw(page.h)}\\margl${tw(page.ml)}\\margr${tw(page.mr)}\\margt${tw(page.mt)}\\margb${tw(page.mb)}\\headery${tw(page.mh)}\\footery${tw(page.mf)}${page.w > page.h ? '\\landscape' : ''}`;
    const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n${fonttbl}\n${colortbl}\n${info}\n${pg}\n${hdr}${ftr}\n${body}}`;
    return new Blob([rtf], { type: 'application/rtf' });
  }

  return { importRtf, exportRtf };
})();
