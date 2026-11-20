/* =====================================================================
   Plume — Markdown (.md) : lecture et écriture (syntaxe CommonMark + GFM)
   ===================================================================== */
'use strict';

const Markdown = (() => {

  function inline(s) {
    // échappement puis syntaxe en ligne
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = htmlEsc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, alt, src) => /^(https?:|data:image\/)/i.test(src) ? `<img src="${src}" alt="${alt}">` : alt);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, t, href) => /^\s*javascript:/i.test(href) ? t : `<a href="${href}">${t}</a>`);
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<b>$1</b>');
    s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
    s = s.replace(/~~(.+?)~~/g, '<s>$1</s>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<span style="font-family:'Cascadia Code', Consolas, monospace">${htmlEsc(codes[+i])}</span>`);
    s = s.replace(/ {2,}$/g, '<br>');
    return s;
  }

  function toHtml(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    let out = '', i = 0;
    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      // bloc de code
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) buf.push(lines[i++]);
        i++;
        out += `<pre>${htmlEsc(buf.join('\n'))}</pre>`; continue;
      }
      // titres
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (i + 1 < lines.length && /^=+\s*$/.test(lines[i + 1]) && line.trim()) { out += `<h1>${inline(line.trim())}</h1>`; i += 2; continue; }
      if (i + 1 < lines.length && /^-+\s*$/.test(lines[i + 1]) && line.trim() && !listRe.test(line)) { out += `<h2>${inline(line.trim())}</h2>`; i += 2; continue; }
      // ligne horizontale
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out += '<hr class="pl-line">'; i++; continue; }
      // citation
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out += `<blockquote>${toHtml(buf.join('\n'))}</blockquote>`; continue;
      }
      // tableau GFM
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map(a => /^:-+:$/.test(a) ? 'center' : /-+:$/.test(a) ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        const cell = (c, k, b) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}><p>${b ? '<b>' : ''}${inline(c)}${b ? '</b>' : ''}</p></td>`;
        out += `<table data-borders="all"><tbody><tr data-header="1">${head.map((c, k) => cell(c, k, true)).join('')}</tr>${rows.map(r => `<tr>${head.map((x, k) => cell(r[k] || '', k)).join('')}</tr>`).join('')}</tbody></table>`;
        continue;
      }
      // listes (imbriquées par indentation)
      if (listRe.test(line)) {
        const items = [];
        while (i < lines.length && (listRe.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          const m = lines[i].match(listRe);
          if (m) items.push({ ind: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), text: m[3] });
          else items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        }
        const build = (arr, from, ind) => {
          let html = '', k = from;
          const ordered = arr[from].ordered;
          const start = arr[from].start;
          html += ordered ? `<ol${start > 1 ? ` start="${start}"` : ''}>` : '<ul>';
          while (k < arr.length && arr[k].ind >= ind) {
            if (arr[k].ind > ind) { const [sub, nk] = build(arr, k, arr[k].ind); html = html.replace(/<\/li>$/, sub + '</li>'); k = nk; continue; }
            let t = arr[k].text;
            const task = t.match(/^\[([ xX])\]\s+(.*)$/);
            if (task) t = (task[1] === ' ' ? '☐ ' : '☑ ') + task[2];
            html += `<li>${inline(t)}</li>`; k++;
          }
          return [html + (ordered ? '</ol>' : '</ul>'), k];
        };
        out += build(items, 0, items[0].ind)[0];
        continue;
      }
      // paragraphe
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*```|\s*~~~)/.test(lines[i]) && !listRe.test(lines[i]) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) buf.push(lines[i++]);
      out += `<p>${buf.map((l, k) => inline(k < buf.length - 1 && / {2,}$/.test(l) ? l : l.trimEnd())).join(' ')}</p>`;
    }
    return out || '<p><br></p>';
  }

  /* ---------- HTML Plume → Markdown ---------- */
  function fromEditor(editor) {
    const esc = s => s.replace(/([\\`*_\[\]#])/g, '\\$1');
    const inl = node => {
      let s = '';
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) { s += esc(n.data.replace(/​/g, '').replace(/\n/g, ' ')); continue; }
        if (n.nodeType !== 1) continue;
        if (n.classList.contains('pl-del') || n.classList.contains('pl-cref')) continue;
        if (n.classList.contains('pl-fn')) { s += `[^${n.textContent}]`; continue; }
        if (n.tagName === 'BR') { s += '  \n'; continue; }
        if (n.tagName === 'IMG') { const src = n.getAttribute('src') || ''; s += /^https?:/.test(src) ? `![${n.alt || ''}](${src})` : `![${n.alt || 'image'}]()`; continue; }
        const c = getComputedStyle(n);
        let inner = inl(n);
        if (!inner.trim()) { s += inner; continue; }
        if (n.tagName === 'A' && n.getAttribute('href')) { s += `[${inner}](${n.getAttribute('href')})`; continue; }
        const lead = inner.match(/^\s*/)[0], trail = inner.match(/\s*$/)[0];
        let core = inner.trim();
        const parentC = getComputedStyle(n.parentElement);
        if (/monospace|Consolas|Cascadia|Courier/i.test(c.fontFamily) && !/monospace|Consolas|Cascadia|Courier/i.test(parentC.fontFamily)) core = '`' + core.replace(/\\/g, '') + '`';
        if (parseInt(c.fontWeight, 10) >= 600 && parseInt(parentC.fontWeight, 10) < 600) core = `**${core}**`;
        if (c.fontStyle === 'italic' && parentC.fontStyle !== 'italic') core = `*${core}*`;
        if ((c.textDecorationLine || '').includes('line-through') && !(parentC.textDecorationLine || '').includes('line-through')) core = `~~${core}~~`;
        s += lead + core + trail;
      }
      return s;
    };
    const block = (e, depth = 0) => {
      const t = e.tagName;
      if (/^H[1-6]$/.test(t)) return '#'.repeat(e.classList.contains('title') ? 1 : +t[1]) + ' ' + inl(e).trim() + '\n\n';
      if (t === 'P' || t === 'DIV' && !e.querySelector('p,h1,h2,h3,ul,ol,table')) { const x = inl(e).trim(); return x ? x + '\n\n' : ''; }
      if (t === 'BLOCKQUOTE') return blocks(e).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      if (t === 'PRE') return '```\n' + e.textContent + '\n```\n\n';
      if (t === 'HR') return e.classList.contains('pl-pagebreak') ? '\n---\n\n' : '---\n\n';
      if (t === 'UL' || t === 'OL') {
        let k = parseInt(e.getAttribute('start') || '1', 10), s = '';
        for (const li of Array.from(e.children)) {
          const sub = Array.from(li.children).filter(c => c.tagName === 'UL' || c.tagName === 'OL');
          const clone = li.cloneNode(true);
          clone.querySelectorAll(':scope > ul, :scope > ol').forEach(x => x.remove());
          li.parentNode.insertBefore(clone, li); clone.style.display = 'none';
          const text = inl(clone).trim(); clone.remove();
          s += '  '.repeat(depth) + (t === 'OL' ? `${k++}. ` : '- ') + text + '\n';
          for (const sl of sub) s += block(sl, depth + 1).replace(/\n\n$/, '\n');
        }
        return s + (depth ? '' : '\n');
      }
      if (t === 'TABLE') {
        const rows = Array.from(e.rows).map(r => Array.from(r.cells).map(c => inl(c).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()));
        if (!rows.length) return '';
        const n = Math.max(...rows.map(r => r.length));
        const line = r => '| ' + Array.from({ length: n }, (x, k) => r[k] || '').join(' | ') + ' |';
        return [line(rows[0]), '| ' + Array(n).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      if (e.classList && e.classList.contains('pl-toc')) return '';
      return blocks(e);
    };
    const blocks = root => Array.from(root.children).map(c => block(c)).join('');
    let md = blocks(editor);
    const notes = Array.from(editor.querySelectorAll('.pl-fn'));
    if (notes.length) md += '\n' + notes.map(n => `[^${n.textContent}]: ${n.dataset.note || ''}`).join('\n') + '\n';
    return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  return { toHtml, fromEditor };
})();
