/* =====================================================================
   Plume — îlots Office modifiables
   Les objets complexes d'un .docx (graphiques, SmartArt, formes et zones
   de texte, équations, images flottantes, objets OLE…) sont importés
   comme « îlots » : un élément non éditable qui porte le XML d'origine
   (data-x, base64). Ce module permet de les modifier :
   - graphiques : données (caches c:strCache/c:numCache), titre, type,
     classeur incorporé régénéré ;
   - formes / zones de texte : texte, remplissage, contour (mc:Choice
     ET mc:Fallback mis à jour ensemble) ;
   - SmartArt : textes des nœuds (dataN.xml + dessin en cache drawingN.xml),
     ajout / suppression de nœud ;
   - équations : éditeur en notation linéaire ⇄ OMML, aperçu MathML ;
   - autres objets : propriétés (taille, habillage) et remplacement d'image.
   Les parties liées modifiées (chartN.xml, classeur, dataN.xml…) sont
   portées par l'îlot lui-même (data-own, base64 JSON) : l'historique par
   instantanés (annuler / rétablir) et le copier-coller restent cohérents.
   ===================================================================== */
'use strict';

const Ilots = (() => {
  const NS = {
    c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    dgm: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
    dsp: 'http://schemas.microsoft.com/office/drawing/2008/diagram',
    v: 'urn:schemas-microsoft-com:vml',
    w10: 'urn:schemas-microsoft-com:office:word',
    xml: 'http://www.w3.org/XML/1998/namespace'
  };
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const T = {
    chart: REL + '/chart', pkg: REL + '/package', ole: REL + '/oleObject', image: REL + '/image',
    dgmData: REL + '/diagramData', dgmDrawing: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing'
  };
  const CT = {
    chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dgmData: 'application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml',
    dgmDrawing: 'application/vnd.ms-office.drawingml.diagramDrawing+xml'
  };
  const PH_DRAWING = '@@PLUME-DESSIN-SMARTART@@';

  /* ---------- Outils XML ---------- */
  const b64 = str => btoa(unescape(encodeURIComponent(str)));
  const unb64 = s => decodeURIComponent(escape(atob(s)));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function parse(s) {
    const d = new DOMParser().parseFromString(s, 'application/xml');
    if (d.getElementsByTagName('parsererror').length) throw new Error('XML illisible');
    return d;
  }
  const ser = n => new XMLSerializer().serializeToString(n);
  const kids = (n, q) => n ? Array.from(n.children).filter(c => !q || c.nodeName === q) : [];
  const kid = (n, q) => kids(n, q)[0] || null;
  const desc = (n, q) => n ? Array.from(n.getElementsByTagName(q)) : [];
  const valOf = (n, q) => { const k = kid(n, q); return k ? k.getAttribute('val') : null; };
  /** Crée un élément préfixé : mk(doc, 'c:ser', {val: 1, 'r:id': 'rId1'}, [enfants|texte]) */
  function mk(doc, q, attrs = {}, children = []) {
    const e = doc.createElementNS(NS[q.split(':')[0]], q);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k.includes(':')) e.setAttributeNS(NS[k.split(':')[0]], k, String(v)); else e.setAttribute(k, String(v));
    }
    for (const c of [].concat(children)) if (c != null) e.append(typeof c === 'string' ? doc.createTextNode(c) : c);
    return e;
  }
  /** Insère en respectant l'ordre du schéma : avant le premier enfant dont le nom figure dans `followers` */
  function insertBefore(parent, node, followers) {
    const ref = Array.from(parent.children).find(c => followers.includes(c.nodeName));
    parent.insertBefore(node, ref || null);
  }
  const colName = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const guid = () => '{' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16).toUpperCase(); }) + '}';
  const newKey = () => 'k' + Math.random().toString(36).slice(2, 10);
  const emu = px => Math.round(px * 9525);

  /* ---------- Îlot : XML d'origine et parties propres ---------- */
  const xOf = isl => unb64(isl.dataset.x);
  const setX = (isl, xml) => { isl.dataset.x = b64(xml); };
  function ownOf(isl) { try { return isl.dataset.own ? JSON.parse(unb64(isl.dataset.own)) : null; } catch { return null; } }
  /** Ne garde que les parties atteignables depuis les relations de l'îlot */
  function prune(own) {
    const keep = new Set();
    const visit = k => {
      if (!k || keep.has(k) || !own.parts[k]) return;
      keep.add(k);
      const p = own.parts[k];
      (p.rels || []).forEach(r => visit(r.part));
      (p.hostRels || []).forEach(r => visit(r.part));
    };
    Object.values(own.rels || {}).forEach(r => visit(r.part));
    for (const k of Object.keys(own.parts)) if (!keep.has(k)) delete own.parts[k];
    return own;
  }
  const saveOwn = (isl, own) => { isl.dataset.own = b64(JSON.stringify(prune(own))); };

  /* ---------- Paquet d'origine (document ouvert depuis un .docx) ---------- */
  const zip = () => (typeof Ed !== 'undefined' && Ed.source && Ed.source.zip) || null;
  const relsPathOf = part => part.replace(/([^/]+)$/, '_rels/$1.rels');
  const resolve = (part, target) => {
    if (target.startsWith('/')) return target.slice(1);
    const base = part.split('/').slice(0, -1);
    for (const seg of target.split('/')) { if (seg === '..') base.pop(); else if (seg !== '.') base.push(seg); }
    return base.join('/');
  };
  async function srcText(z, p) { const f = z && z.file(p); return f ? f.async('string') : null; }
  const relsCache = new WeakMap();
  async function srcRels(z, part) {
    if (!z) return {};
    if (!relsCache.has(z)) relsCache.set(z, {});
    const c = relsCache.get(z);
    if (!c[part]) {
      const r = {};
      const x = await srcText(z, relsPathOf(part));
      if (x) for (const e of parse(x).getElementsByTagName('Relationship')) r[e.getAttribute('Id')] = { type: e.getAttribute('Type'), target: e.getAttribute('Target'), mode: e.getAttribute('TargetMode') };
      c[part] = r;
    }
    return c[part];
  }
  /** Relations d'une partie d'origine, sous forme normalisée */
  async function srcRelList(z, path) {
    return Object.entries(await srcRels(z, path)).map(([id, r]) => r.mode === 'External'
      ? { id, type: r.type, target: r.target, external: true } : { id, type: r.type, src: resolve(path, r.target) });
  }
  /** Partie liée à l'îlot par un identifiant de relation (partie propre d'abord, sinon d'origine) */
  async function linked(isl, rid, own = ownOf(isl), z = zip()) {
    const o = own && own.rels && own.rels[rid];
    if (o && own.parts[o.part]) { const p = own.parts[o.part]; return { key: o.part, own: p, type: o.type, xml: p.xml, bin: p.bin, rels: p.rels || [] }; }
    if (!z) return null;
    const host = isl.dataset.part || 'word/document.xml';
    const r = (await srcRels(z, host))[rid];
    if (!r || r.mode === 'External') return null;
    const path = resolve(host, r.target);
    return { src: path, type: r.type, xml: await srcText(z, path), rels: await srcRelList(z, path) };
  }

  /* ---------- Historique, sélection, messages ---------- */
  const before = () => { if (Ed._typingTimer) Ed.commit(); };
  function after(isl) {
    const h = isl && isl.isConnected && isl.closest('.hf');
    if (h) Ed.onHFInput(h);
    Ed.changed(false);
  }
  function select(isl) {
    $$('.pl-island.il-sel').forEach(x => x.classList.remove('il-sel'));
    isl.classList.add('il-sel');
    const r = document.createRange(); r.selectNode(isl);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); Ed.lastRange = r.cloneRange();
  }
  const fail = e => { console.warn('Plume — îlot :', e); toast('Modification impossible : ' + esc(e && e.message || e)); };
  const info = (title, msg) => dialog({ title, body: `<p style="line-height:1.5">${msg}</p>` });
  const box = isl => isl.querySelector('.pl-island-box');

  /* =====================================================================
     GRAPHIQUES
     ===================================================================== */
  const CHART_TYPES = ['barChart', 'bar3DChart', 'lineChart', 'line3DChart', 'pieChart', 'pie3DChart', 'doughnutChart', 'areaChart', 'area3DChart', 'radarChart', 'scatterChart', 'ofPieChart'];
  const KINDS = [['col', 'Histogramme (colonnes)'], ['bar', 'Barres'], ['line', 'Courbes'], ['area', 'Aires'], ['pie', 'Secteurs']];
  const typeEls = plot => kids(plot).filter(n => /Chart$/.test(n.nodeName));

  /** Valeurs d'un cache (c:tx, c:cat, c:val, c:xVal, c:yVal) */
  function readCache(n) {
    if (!n) return [];
    const v = kid(n, 'c:v');
    if (v) return [v.textContent];
    const ref = kid(n, 'c:strRef') || kid(n, 'c:numRef') || kid(n, 'c:multiLvlStrRef');
    const cache = ref ? (kid(ref, 'c:strCache') || kid(ref, 'c:numCache') || kid(ref, 'c:multiLvlStrCache')) : (kid(n, 'c:strLit') || kid(n, 'c:numLit'));
    if (!cache) return [];
    const holder = cache.nodeName === 'c:multiLvlStrCache' ? kid(cache, 'c:lvl') : cache;
    const out = new Array(+(valOf(cache, 'c:ptCount') || 0)).fill('');
    for (const p of kids(holder, 'c:pt')) {
      const i = +p.getAttribute('idx');
      while (out.length <= i) out.push('');
      const t = kid(p, 'c:v'); out[i] = t ? t.textContent : '';
    }
    return out;
  }
  const isNumRef = n => !!(n && (kid(n, 'c:numRef') || kid(n, 'c:numLit')));
  const fmtCode = n => { const f = n && n.getElementsByTagName('c:formatCode')[0]; return f ? f.textContent : 'General'; };

  /** Modèle simple d'un graphique : type, titre, catégories, séries */
  function readChart(doc) {
    const plot = doc.getElementsByTagName('c:plotArea')[0];
    if (!plot) return null;
    const types = typeEls(plot);
    const sers = types.flatMap(t => kids(t, 'c:ser'));
    const editable = types.length > 0 && sers.length > 0 && types.every(t => CHART_TYPES.includes(t.localName));
    let kind = 'other';
    if (types.length === 1) {
      const t = types[0].localName;
      kind = t === 'barChart' ? (valOf(types[0], 'c:barDir') === 'bar' ? 'bar' : 'col') : ({ lineChart: 'line', pieChart: 'pie', areaChart: 'area' })[t] || 'other';
    }
    const series = sers.map(s => ({ name: readCache(kid(s, 'c:tx'))[0] || '', vals: readCache(kid(s, 'c:val') || kid(s, 'c:yVal')).map(v => v === '' || isNaN(+v) ? null : +v) }));
    const catSer = sers.find(s => kid(s, 'c:cat') || kid(s, 'c:xVal'));
    const catEl = catSer ? (kid(catSer, 'c:cat') || kid(catSer, 'c:xVal')) : null;
    let cats = catEl ? readCache(catEl) : [];
    const n = Math.max(cats.length, 1, ...series.map(s => s.vals.length));
    cats = Array.from({ length: n }, (_, i) => cats[i] !== undefined ? cats[i] : (catEl ? '' : String(i + 1)));
    series.forEach(s => { while (s.vals.length < n) s.vals.push(null); });
    const chart = doc.getElementsByTagName('c:chart')[0];
    const tEl = kid(chart, 'c:title');
    let title = '';
    if (tEl) {
      const tx = kid(tEl, 'c:tx');
      if (tx) { const rich = kid(tx, 'c:rich'); title = rich ? kids(rich, 'a:p').map(p => desc(p, 'a:t').map(t => t.textContent).join('')).join(' ') : (readCache(tx)[0] || ''); }
      else title = series.length === 1 ? series[0].name : 'Titre du graphique';
    }
    let sheet = null;
    const f = doc.getElementsByTagName('c:f')[0];
    if (f) { const m = f.textContent.match(/^\s*(?:'((?:[^']|'')+)'|([^!]+))!/); if (m) sheet = m[1] ? m[1].replace(/''/g, "'") : m[2]; }
    return {
      editable, kind, canType: ['col', 'bar', 'line', 'pie', 'area'].includes(kind), title, cats, series, sheet,
      numCats: isNumRef(catEl), catFmt: fmtCode(catEl), scatter: types.some(t => t.localName === 'scatterChart')
    };
  }

  const sheetRef = s => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`;
  const numStr = v => String(v);
  function strCache(doc, arr) {
    return mk(doc, 'c:strCache', {}, [mk(doc, 'c:ptCount', { val: arr.length }),
      ...arr.map((v, i) => v === '' || v == null ? null : mk(doc, 'c:pt', { idx: i }, [mk(doc, 'c:v', {}, String(v))]))]);
  }
  function numCache(doc, arr, fmt) {
    return mk(doc, 'c:numCache', {}, [mk(doc, 'c:formatCode', {}, fmt || 'General'), mk(doc, 'c:ptCount', { val: arr.length }),
      ...arr.map((v, i) => v == null || v === '' ? null : mk(doc, 'c:pt', { idx: i }, [mk(doc, 'c:v', {}, numStr(v))]))]);
  }
  const parseNum = s => { const t = String(s).replace(/[\s ]/g, '').replace(',', '.'); return t === '' ? null : (isFinite(+t) ? +t : NaN); };

  /** Paragraphes d'un corps de texte DrawingML (c:rich, dgm:t, dsp:txBody) */
  function setParas(doc, body, lines) {
    const ps = kids(body, 'a:p');
    const tpl = ps[0];
    const pPr = tpl && kid(tpl, 'a:pPr');
    const r0 = tpl && kids(tpl, 'a:r')[0];
    const rPr = r0 ? kid(r0, 'a:rPr') : (tpl && kid(tpl, 'a:endParaRPr'));
    const asRPr = (src, name) => {
      const e = mk(doc, name);
      for (const at of Array.from(src.attributes)) e.setAttributeNS(at.namespaceURI, at.name, at.value);
      for (const c of Array.from(src.childNodes)) e.append(c.cloneNode(true));
      return e;
    };
    ps.forEach(p => p.remove());
    for (const line of (lines.length ? lines : [''])) {
      const p = mk(doc, 'a:p');
      if (pPr) p.append(pPr.cloneNode(true));
      if (line !== '') p.append(mk(doc, 'a:r', {}, [rPr ? asRPr(rPr, 'a:rPr') : mk(doc, 'a:rPr', { lang: 'fr-FR' }), mk(doc, 'a:t', {}, line)]));
      else if (rPr) p.append(asRPr(rPr, 'a:endParaRPr'));
      insertBefore(body, p, ['a:extLst']);
    }
  }

  function setTitle(doc, text) {
    const chart = doc.getElementsByTagName('c:chart')[0];
    let t = kid(chart, 'c:title');
    let atd = kid(chart, 'c:autoTitleDeleted');
    if (!text) {
      if (t) t.remove();
      if (!atd) chart.insertBefore(mk(doc, 'c:autoTitleDeleted', { val: 1 }), chart.firstElementChild);
      else atd.setAttribute('val', '1');
      return;
    }
    if (!t) { t = mk(doc, 'c:title', {}, [mk(doc, 'c:overlay', { val: 0 })]); chart.insertBefore(t, chart.firstElementChild); }
    if (atd) atd.setAttribute('val', '0');
    let tx = kid(t, 'c:tx');
    let rich = tx && kid(tx, 'c:rich');
    if (!rich) {
      if (tx) tx.remove();
      rich = mk(doc, 'c:rich', {}, [mk(doc, 'a:bodyPr'), mk(doc, 'a:lstStyle'), mk(doc, 'a:p')]);
      t.insertBefore(mk(doc, 'c:tx', {}, [rich]), t.firstElementChild);
    }
    setParas(doc, rich, [text]);
  }

  function axes(doc, catId, valId, horiz) {
    const v = (q, val) => mk(doc, q, { val });
    const cat = mk(doc, 'c:catAx', {}, [v('c:axId', catId), mk(doc, 'c:scaling', {}, [v('c:orientation', 'minMax')]), v('c:delete', 0), v('c:axPos', horiz ? 'l' : 'b'),
      mk(doc, 'c:numFmt', { formatCode: 'General', sourceLinked: 1 }), v('c:majorTickMark', 'none'), v('c:minorTickMark', 'none'), v('c:tickLblPos', 'nextTo'),
      v('c:crossAx', valId), v('c:crosses', 'autoZero'), v('c:auto', 1), v('c:lblAlgn', 'ctr'), v('c:lblOffset', 100), v('c:noMultiLvlLbl', 0)]);
    const val = mk(doc, 'c:valAx', {}, [v('c:axId', valId), mk(doc, 'c:scaling', {}, [v('c:orientation', 'minMax')]), v('c:delete', 0), v('c:axPos', horiz ? 'b' : 'l'),
      mk(doc, 'c:majorGridlines'), mk(doc, 'c:numFmt', { formatCode: 'General', sourceLinked: 1 }), v('c:majorTickMark', 'none'), v('c:minorTickMark', 'none'), v('c:tickLblPos', 'nextTo'),
      v('c:crossAx', catId), v('c:crosses', 'autoZero'), v('c:crossBetween', 'between')]);
    return [cat, val];
  }
  function setAxPos(plot, ids, kind) {
    for (const ax of kids(plot)) {
      if (!/^c:(catAx|dateAx|valAx)$/.test(ax.nodeName) || !ids.includes(valOf(ax, 'c:axId'))) continue;
      const p = kid(ax, 'c:axPos'); if (!p) continue;
      const isVal = ax.nodeName === 'c:valAx';
      p.setAttribute('val', (kind === 'bar') !== isVal ? 'l' : 'b');
    }
  }
  /** Change le type d'un graphique simple (un seul type de tracé) */
  function changeType(doc, plot, kind) {
    const old = typeEls(plot)[0];
    const oldAx = kids(old, 'c:axId').map(a => a.getAttribute('val'));
    if (old.localName === 'barChart' && (kind === 'col' || kind === 'bar')) { kid(old, 'c:barDir').setAttribute('val', kind); setAxPos(plot, oldAx, kind); return; }
    const sers = kids(old, 'c:ser').map(s => {
      const c = q => { const x = kid(s, q); return x ? x.cloneNode(true) : null; };
      const parts = [c('c:idx'), c('c:order'), c('c:tx')];
      if (kind === 'col' || kind === 'bar') parts.push(mk(doc, 'c:invertIfNegative', { val: 0 }));
      parts.push(c('c:cat'), c('c:val'));
      if (kind === 'line') parts.push(mk(doc, 'c:smooth', { val: 0 }));
      return mk(doc, 'c:ser', {}, parts);
    });
    const plotAxes = kids(plot).filter(n => /^c:(catAx|valAx|dateAx|serAx)$/.test(n.nodeName));
    const ax = kind === 'pie' ? [] : (oldAx.length >= 2 && plotAxes.length ? oldAx.slice(0, 2) : [String(5e8 + Math.floor(Math.random() * 1e8)), String(6e8 + Math.floor(Math.random() * 1e8))]);
    const axEls = ax.map(v => mk(doc, 'c:axId', { val: v }));
    const v = (q, val) => mk(doc, q, { val });
    let ne;
    if (kind === 'col' || kind === 'bar') ne = mk(doc, 'c:barChart', {}, [v('c:barDir', kind), v('c:grouping', 'clustered'), v('c:varyColors', 0), ...sers, v('c:gapWidth', 150), ...axEls]);
    else if (kind === 'line') ne = mk(doc, 'c:lineChart', {}, [v('c:grouping', 'standard'), v('c:varyColors', 0), ...sers, v('c:marker', 1), ...axEls]);
    else if (kind === 'area') ne = mk(doc, 'c:areaChart', {}, [v('c:grouping', 'standard'), v('c:varyColors', 0), ...sers, ...axEls]);
    else ne = mk(doc, 'c:pieChart', {}, [v('c:varyColors', 1), ...sers, v('c:firstSliceAng', 0)]);
    plot.replaceChild(ne, old);
    if (kind === 'pie') { plotAxes.forEach(n => n.remove()); kids(plot, 'c:dTable').forEach(n => n.remove()); }
    else if (!(oldAx.length >= 2 && plotAxes.length)) { const [ca, va] = axes(doc, ax[0], ax[1], kind === 'bar'); ne.after(ca); ca.after(va); }
    else setAxPos(plot, ax, kind);
  }

  /** Écrit les données dans le XML du graphique (caches, formules, titre, type) */
  function writeChart(doc, m, res, extRid) {
    const plot = doc.getElementsByTagName('c:plotArea')[0];
    if (m.canType && res.kind && res.kind !== m.kind) changeType(doc, plot, res.kind);
    const S = sheetRef(res.sheet || m.sheet || 'Feuil1');
    const N = res.cats.length;
    const sers = typeEls(plot).flatMap(t => kids(t, 'c:ser'));
    while (sers.length > res.series.length) sers.pop().remove();
    let maxIdx = Math.max(-1, ...sers.map(s => +valOf(s, 'c:idx') || 0)), maxOrd = Math.max(-1, ...sers.map(s => +valOf(s, 'c:order') || 0));
    while (sers.length < res.series.length) {
      const last = sers[sers.length - 1];
      const cl = last.cloneNode(true);
      for (const q of ['c:spPr', 'c:dPt', 'c:extLst', 'c:trendline', 'c:errBars', 'c:explosion', 'c:pictureOptions', 'c:marker']) kids(cl, q).forEach(x => x.remove());
      const dl = kid(cl, 'c:dLbls'); if (dl) kids(dl, 'c:dLbl').forEach(x => x.remove());
      kid(cl, 'c:idx').setAttribute('val', ++maxIdx); kid(cl, 'c:order').setAttribute('val', ++maxOrd);
      last.after(cl); sers.push(cl);
    }
    const catsNumeric = res.cats.every(c => c !== '' && isFinite(parseNum(c)));
    const numCats = catsNumeric && (m.numCats || m.scatter);
    sers.forEach((s, i) => {
      const col = colName(i + 1);
      const sr = res.series[i];
      kids(s, 'c:tx').forEach(x => x.remove());
      kid(s, 'c:order').after(mk(doc, 'c:tx', {}, [mk(doc, 'c:strRef', {}, [mk(doc, 'c:f', {}, `${S}!$${col}$1`), strCache(doc, [sr.name])])]));
      const valName = kid(s, 'c:yVal') ? 'c:yVal' : 'c:val';
      const catName = valName === 'c:yVal' ? 'c:xVal' : 'c:cat';
      let cat = kid(s, catName);
      if (!cat) { cat = mk(doc, catName); insertBefore(s, cat, [valName]); }
      const catFmt = numCats ? m.catFmt : null;
      cat.replaceChildren(numCats
        ? mk(doc, 'c:numRef', {}, [mk(doc, 'c:f', {}, `${S}!$A$2:$A$${N + 1}`), numCache(doc, res.cats.map(parseNum), catFmt)])
        : mk(doc, 'c:strRef', {}, [mk(doc, 'c:f', {}, `${S}!$A$2:$A$${N + 1}`), strCache(doc, res.cats)]));
      let val = kid(s, valName);
      const vfmt = fmtCode(val);
      if (!val) { val = mk(doc, valName); cat.after(val); }
      val.replaceChildren(mk(doc, 'c:numRef', {}, [mk(doc, 'c:f', {}, `${S}!$${col}$2:$${col}$${N + 1}`), numCache(doc, sr.vals, vfmt)]));
      // points et étiquettes individuels au-delà des données : retirés
      kids(s, 'c:dPt').forEach(p => { if (+valOf(p, 'c:idx') >= N) p.remove(); });
      const dl = kid(s, 'c:dLbls'); if (dl) kids(dl, 'c:dLbl').forEach(p => { if (+valOf(p, 'c:idx') >= N) p.remove(); });
    });
    if (res.title !== m.title) setTitle(doc, res.title);
    if (extRid) {
      const cs = doc.documentElement;
      let ed = kid(cs, 'c:externalData');
      if (!ed) insertBefore(cs, mk(doc, 'c:externalData', { 'r:id': extRid }, [mk(doc, 'c:autoUpdate', { val: 0 })]), ['c:printSettings', 'c:userShapes', 'c:extLst']);
      else ed.setAttributeNS(NS.r, 'r:id', extRid);
    }
  }

  /** Classeur Excel minimal (catégories en A, séries en B, C…) */
  async function buildXlsx(sheet, cats, series, numCats) {
    const z = new JSZip();
    const strs = [];
    const si = s => { let i = strs.indexOf(s); if (i < 0) { strs.push(s); i = strs.length - 1; } return i; };
    const cell = (ref, v, str) => v == null || v === '' ? '' : str ? `<c r="${ref}" t="s"><v>${si(String(v))}</v></c>` : `<c r="${ref}"><v>${numStr(v)}</v></c>`;
    let rows = `<row r="1">${series.map((s, i) => cell(colName(i + 1) + '1', s.name, true)).join('')}</row>`;
    cats.forEach((c, r) => {
      rows += `<row r="${r + 2}">${cell('A' + (r + 2), numCats ? parseNum(c) : c, !numCats)}${series.map((s, i) => cell(colName(i + 1) + (r + 2), s.vals[r], false)).join('')}</row>`;
    });
    const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const SM = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    z.file('[Content_Types].xml', H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
    z.file('_rels/.rels', H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file('xl/workbook.xml', H + `<workbook xmlns="${SM}" xmlns:r="${NS.r}"><bookViews><workbookView/></bookViews><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    z.file('xl/_rels/workbook.xml.rels', H + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
    z.file('xl/worksheets/sheet1.xml', H + `<worksheet xmlns="${SM}" xmlns:r="${NS.r}"><dimension ref="A1:${colName(series.length)}${cats.length + 1}"/><sheetData>${rows}</sheetData></worksheet>`);
    z.file('xl/sharedStrings.xml', H + `<sst xmlns="${SM}" count="${strs.length}" uniqueCount="${strs.length}">${strs.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`);
    z.file('xl/styles.xml', H + `<styleSheet xmlns="${SM}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    return z.generateAsync({ type: 'base64', compression: 'DEFLATE' });
  }

  /** Construit la partie graphique propre de l'îlot (graphique + classeur) */
  async function chartOwn(own, rid, p, doc, m, res) {
    res.sheet = m.sheet || 'Feuil1';
    const oldExt = kid(doc.documentElement, 'c:externalData');
    let extRid = oldExt ? oldExt.getAttribute('r:id') : null;
    // l'ancien classeur (ou lien externe) est remplacé par un classeur cohérent avec les nouvelles données
    const rels = (p.rels || []).filter(r => r.type !== T.pkg && r.type !== T.ole && r.id !== extRid);
    if (!extRid) { let k = 1; extRid = 'rIdPl1'; while (rels.some(r => r.id === extRid)) extRid = 'rIdPl' + (++k); }
    writeChart(doc, m, res, extRid);
    const numCats = res.cats.every(c => c !== '' && isFinite(parseNum(c))) && (m.numCats || m.scatter);
    const xkey = newKey(), ckey = newKey();
    own.parts[xkey] = { dir: 'word/embeddings', base: 'Feuille_Microsoft_Excel', ext: 'xlsx', ct: CT.xlsx, bin: await buildXlsx(res.sheet, res.cats, res.series, numCats) };
    own.parts[ckey] = { dir: 'word/charts', base: 'chart', ext: 'xml', ct: CT.chart, xml: ser(doc), rels: [...rels, { id: extRid, type: T.pkg, part: xkey }] };
    own.rels[rid] = { type: T.chart, part: ckey };
    return own.parts[ckey].xml;
  }
  function chartPreview(isl, xml) {
    const b = box(isl); if (!b) return;
    const w = parseFloat(b.style.width) || 400, h = parseFloat(b.style.height) || 240;
    b.innerHTML = DocxImport.chartSvg(xml, w, h) || '<span class="pl-island-label">Graphique</span>';
    b.title = 'Graphique — double-cliquez pour modifier les données';
  }

  /** Boîte de dialogue « Modifier les données » (tableur simple) */
  function chartDialog(m, doc, title = 'Modifier les données du graphique') {
    const st = { title: m.title, kind: m.kind, cats: [...m.cats], series: m.series.map(s => ({ name: s.name, vals: s.vals.map(v => v == null ? '' : String(v).replace('.', ',')) })) };
    const titleIn = el('input', { type: 'text', class: 'il-in', placeholder: '(aucun titre)' }); titleIn.value = st.title;
    titleIn.addEventListener('input', () => { st.title = titleIn.value; preview(); });
    const typeSel = el('select', { class: 'il-in', disabled: !m.canType || null }, m.canType ? KINDS.map(([k, l]) => el('option', { value: k }, [l])) : [el('option', {}, ['Type d’origine (non modifiable ici)'])]);
    if (m.canType) typeSel.value = st.kind;
    typeSel.addEventListener('change', () => { st.kind = typeSel.value; preview(); });
    const grid = el('div', { class: 'il-grid' });
    const pv = el('div', { class: 'il-chart-pv' });
    const preview = () => {
      try {
        const d = parse(ser(doc));
        writeChart(d, m, collect(true), null);
        pv.innerHTML = DocxImport.chartSvg(ser(d), 300, 170);
      } catch { pv.innerHTML = ''; }
    };
    const collect = loose => ({
      title: st.title.trim(), kind: st.kind, cats: st.cats.map(c => c.trim()),
      series: st.series.map(s => ({ name: s.name.trim(), vals: s.vals.map(v => { const n = parseNum(v); return n == null || isNaN(n) ? (loose ? null : n) : n; }) }))
    });
    const inp = (value, onInput, cls = '') => { const i = el('input', { type: 'text', class: 'il-cell ' + cls }); i.value = value; i.addEventListener('input', () => { onInput(i.value); i.classList.remove('bad'); preview(); }); return i; };
    const xbtn = (title, fn, dis) => el('button', { type: 'button', class: 'il-x', title, disabled: dis || null, onclick: () => { fn(); render(); } }, ['✕']);
    const render = () => {
      const t = el('table', { class: 'il-table' });
      const head = el('tr', {}, [el('th', {}, ['Catégories'])]);
      st.series.forEach((s, j) => head.append(el('th', {}, [el('div', { class: 'il-th' }, [inp(s.name, v => { s.name = v; }, 'il-sname'), xbtn('Supprimer la série', () => st.series.splice(j, 1), st.series.length < 2)])])));
      t.append(head);
      st.cats.forEach((c, i) => {
        const tr = el('tr', {}, [el('td', {}, [el('div', { class: 'il-th' }, [xbtn('Supprimer la ligne', () => { st.cats.splice(i, 1); st.series.forEach(s => s.vals.splice(i, 1)); }, st.cats.length < 2), inp(c, v => { st.cats[i] = v; }, 'il-cat')])])]);
        st.series.forEach(s => tr.append(el('td', {}, [inp(s.vals[i] ?? '', v => { s.vals[i] = v; }, 'il-num')])));
        t.append(tr);
      });
      grid.replaceChildren(t);
      preview();
    };
    const tools = el('div', { class: 'il-row' }, [
      el('button', { type: 'button', class: 'btn', onclick: () => { st.cats.push('Catégorie ' + (st.cats.length + 1)); st.series.forEach(s => s.vals.push('')); render(); } }, ['+ Ligne']),
      el('button', { type: 'button', class: 'btn', onclick: () => { st.series.push({ name: 'Série ' + (st.series.length + 1), vals: st.cats.map(() => '') }); render(); } }, ['+ Série'])
    ]);
    const body = el('div', { class: 'il-chart' }, [
      el('div', { class: 'il-cols' }, [
        el('div', { class: 'il-col' }, [el('label', { class: 'il-lab' }, ['Titre du graphique', titleIn]), el('label', { class: 'il-lab' }, ['Type', typeSel])]),
        pv
      ]),
      grid, tools,
      el('p', { class: 'il-note' }, ['Les valeurs décimales s’écrivent avec une virgule ou un point. Le classeur Excel incorporé est régénéré à partir de ce tableau.'])
    ]);
    render();
    let result = null;
    return dialog({
      title, body, width: 760,
      buttons: [{ label: 'Annuler', value: null }, {
        label: 'OK', primary: true, value: 'ok', onClick: b => {
          const r = collect(false);
          let ok = true;
          $$('.il-num', b).forEach((i, k) => { const v = parseNum(i.value); if (v !== null && isNaN(v)) { i.classList.add('bad'); ok = false; } });
          if (!ok) { toast('Certaines valeurs ne sont pas des nombres.'); return false; }
          result = r; return true;
        }
      }]
    }).then(v => v === 'ok' ? result : null);
  }

  async function editChart(isl) {
    const x = parse(xOf(isl));
    const cEl = desc(x, 'c:chart')[0];
    if (!cEl) return info('Graphique', 'Ce type de graphique (graphique Office 2016 : cascade, compartimentage…) est conservé tel quel mais ne peut pas être modifié dans Plume.');
    const rid = cEl.getAttribute('r:id');
    const own = ownOf(isl) || { rels: {}, parts: {} };
    const p = await linked(isl, rid, own);
    if (!p || !p.xml) return info('Graphique', 'Les données de ce graphique sont introuvables dans le document d’origine.');
    const doc = parse(p.xml);
    const m = readChart(doc);
    if (!m || !m.editable) return info('Graphique', 'Ce type de graphique (bulles, boursier, surface…) est conservé tel quel mais ne peut pas être modifié dans Plume.');
    const res = await chartDialog(m, parse(p.xml));
    if (!res) return;
    await applyChart(isl, res, { own, rid, p, doc, m });
  }
  /** Applique des données à un graphique (utilisable sans dialogue) */
  async function applyChart(isl, res, ctx) {
    if (!ctx) {
      const cEl = desc(parse(xOf(isl)), 'c:chart')[0];
      const rid = cEl.getAttribute('r:id');
      const own = ownOf(isl) || { rels: {}, parts: {} };
      const p = await linked(isl, rid, own);
      const doc = parse(p.xml);
      ctx = { own, rid, p, doc, m: readChart(doc) };
    }
    const r = { title: ctx.m.title, kind: ctx.m.kind, cats: ctx.m.cats, series: ctx.m.series, ...res };
    before();
    const xml = await chartOwn(ctx.own, ctx.rid, ctx.p, ctx.doc, ctx.m, r);
    saveOwn(isl, ctx.own);
    chartPreview(isl, xml);
    after(isl);
  }
  /** Données actuelles d'un graphique (tests, réimport) */
  async function chartData(isl) {
    const cEl = desc(parse(xOf(isl)), 'c:chart')[0];
    if (!cEl) return null;
    const p = await linked(isl, cEl.getAttribute('r:id'));
    return p && p.xml ? readChart(parse(p.xml)) : null;
  }

  const CHART_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}" xmlns:r="${NS.r}"><c:date1904 val="0"/><c:lang val="fr-FR"/><c:roundedCorners val="0"/><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:invertIfNegative val="0"/><c:val/></c:ser><c:gapWidth val="219"/><c:overlap val="-27"/><c:axId val="511111111"/><c:axId val="522222222"/></c:barChart><c:catAx><c:axId val="511111111"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="522222222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx><c:valAx><c:axId val="522222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="511111111"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
  const DEFAULT_CHART = () => ({
    editable: true, kind: 'col', canType: true, title: '', sheet: 'Feuil1', numCats: false, scatter: false,
    cats: ['Catégorie 1', 'Catégorie 2', 'Catégorie 3', 'Catégorie 4'],
    series: [{ name: 'Série 1', vals: [4.3, 2.5, 3.5, 4.5] }, { name: 'Série 2', vals: [2.4, 4.4, 1.8, 2.8] }, { name: 'Série 3', vals: [2, 2, 3, 5] }]
  });
  /** Insertion > Graphique : nouveau graphique complet (partie chart + classeur) */
  async function insertChart(res) {
    const m = DEFAULT_CHART();
    if (!res) { res = await chartDialog(m, parse(CHART_TEMPLATE), 'Insérer un graphique'); if (!res) return null; }
    res = { title: m.title, kind: m.kind, cats: m.cats, series: m.series, ...res };
    const w = Math.round(Math.min(576, Ed.contentWidth())), h = Math.round(w * 0.5625);
    const rid = 'rIdPlChart1';
    const own = { rels: {}, parts: {} };
    const doc = parse(CHART_TEMPLATE);
    const xml = await chartOwn(own, rid, { rels: [] }, doc, m, res);
    const rx = `<w:r xmlns:w="${NS.w}"><w:drawing><wp:inline xmlns:wp="${NS.wp}" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${emu(w)}" cy="${emu(h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="Graphique 1"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="${NS.a}"><a:graphicData uri="${NS.c}"><c:chart xmlns:c="${NS.c}" xmlns:r="${NS.r}" r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const svg = DocxImport.chartSvg(xml, w, h);
    const html = `<span class="pl-island" contenteditable="false" data-kind="chart" data-part="word/document.xml" data-x="${b64(rx)}" data-own="${b64(JSON.stringify(prune(own)))}"><span class="pl-island-box" style="width:${w}px;height:${h}px" title="Graphique — double-cliquez pour modifier les données">${svg}</span></span>&#8203;`;
    before();
    Ed.insertHTML(html);
    return true;
  }

  /* =====================================================================
     FORMES ET ZONES DE TEXTE (wps / VML, mc:Choice + mc:Fallback)
     ===================================================================== */
  const VML_SHAPES = ['v:shape', 'v:rect', 'v:roundrect', 'v:oval', 'v:polyline', 'v:arc', 'v:curve'];
  const vmlShapes = root => VML_SHAPES.flatMap(q => desc(root, q));
  /** Branche principale (mc:Choice) et de repli (mc:Fallback) d'un îlot */
  function branches(root) {
    const ac = root.nodeName === 'mc:AlternateContent' ? root : desc(root, 'mc:AlternateContent')[0];
    return { choice: ac ? kid(ac, 'mc:Choice') : null, fallback: ac ? kid(ac, 'mc:Fallback') : null, main: ac ? (kid(ac, 'mc:Choice') || kid(ac, 'mc:Fallback')) : root };
  }
  const nestedIn = (n, q, stop) => { for (let p = n.parentNode; p && p !== stop; p = p.parentNode) if (p.nodeName === q) return true; return false; };
  function txbxText(b) {
    return kids(b, 'w:p').map(p => desc(p, 'w:r').filter(r => !nestedIn(r, 'w:txbxContent', b)).map(r => kids(r).map(c => c.nodeName === 'w:t' ? c.textContent : c.nodeName === 'w:tab' ? '\t' : c.nodeName === 'w:br' ? ' ' : '').join('')).join('')).join('\n');
  }
  /** Remplace le contenu d'une w:txbxContent par des paragraphes simples (mise en forme du 1er run conservée) */
  function setTxbx(doc, b, text) {
    const ps = kids(b, 'w:p');
    const lines = String(text).split('\n');
    const out = lines.map((line, i) => {
      const t = ps[Math.min(i, ps.length - 1)];
      const p = mk(doc, 'w:p');
      const pPr = t && kid(t, 'w:pPr');
      if (pPr) p.append(pPr.cloneNode(true));
      const r0 = t && desc(t, 'w:r').find(r => kid(r, 'w:t'));
      const rPr = (r0 && kid(r0, 'w:rPr')) || (pPr && kid(pPr, 'w:rPr'));
      if (line) {
        const r = mk(doc, 'w:r');
        if (rPr) r.append(rPr.cloneNode(true));
        line.split('\t').forEach((seg, k) => { if (k) r.append(mk(doc, 'w:tab')); if (seg) r.append(mk(doc, 'w:t', { 'xml:space': 'preserve' }, seg)); });
        p.append(r);
      }
      return p;
    });
    b.replaceChildren(...out);
  }
  const FILLS = /^a:(noFill|solidFill|gradFill|blipFill|pattFill|grpFill)$/;
  /** Remplissage / contour : undefined = inchangé, null = aucun, '#RRGGBB' = couleur */
  function setColors(doc, root, fill, line) {
    const solid = c => mk(doc, 'a:solidFill', {}, [mk(doc, 'a:srgbClr', { val: c.slice(1).toUpperCase() })]);
    for (const sp of desc(root, 'wps:spPr')) {
      if (fill !== undefined) {
        kids(sp).filter(k => FILLS.test(k.nodeName)).forEach(k => k.remove());
        insertBefore(sp, fill ? solid(fill) : mk(doc, 'a:noFill'), ['a:ln', 'a:effectLst', 'a:effectDag', 'a:scene3d', 'a:sp3d', 'a:extLst']);
      }
      if (line !== undefined) {
        let ln = kid(sp, 'a:ln');
        if (!ln) { ln = mk(doc, 'a:ln', { w: 12700 }); insertBefore(sp, ln, ['a:effectLst', 'a:effectDag', 'a:scene3d', 'a:sp3d', 'a:extLst']); }
        kids(ln).filter(k => /^a:(noFill|solidFill|gradFill|pattFill)$/.test(k.nodeName)).forEach(k => k.remove());
        ln.insertBefore(line ? solid(line) : mk(doc, 'a:noFill'), ln.firstChild);
      }
    }
    for (const v of vmlShapes(root)) {
      if (fill !== undefined) {
        if (fill) { v.setAttribute('fillcolor', fill); v.setAttribute('filled', 't'); } else v.setAttribute('filled', 'f');
        kids(v, 'v:fill').forEach(f => f.remove());
      }
      if (line !== undefined) {
        if (line) { v.setAttribute('strokecolor', line); v.setAttribute('stroked', 't'); } else v.setAttribute('stroked', 'f');
        kids(v, 'v:stroke').forEach(s => s.removeAttribute('color'));
      }
    }
  }
  function currentColors(root) {
    const sp = desc(root, 'wps:spPr')[0];
    const get = (n) => { if (!n) return null; if (kid(n, 'a:noFill')) return 'none'; const s = kid(n, 'a:solidFill'); const c = s && kid(s, 'a:srgbClr'); return c ? '#' + c.getAttribute('val') : null; };
    let fill = sp ? get(sp) : null, line = sp ? get(kid(sp, 'a:ln')) : null;
    const v = vmlShapes(root)[0];
    if (v && !fill) fill = v.getAttribute('filled') === 'f' ? 'none' : (v.getAttribute('fillcolor') || null);
    if (v && !line) line = v.getAttribute('stroked') === 'f' ? 'none' : (v.getAttribute('strokecolor') || null);
    const norm = c => c && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : c;
    return { fill: norm(fill), line: norm(line) };
  }
  function colorField(label, cur) {
    const sel = el('select', { class: 'il-in' }, [el('option', { value: 'keep' }, ['Inchangé']), el('option', { value: 'color' }, ['Couleur']), el('option', { value: 'none' }, ['Aucun'])]);
    const col = el('input', { type: 'color', class: 'il-color', value: cur && cur[0] === '#' ? cur : '#FFFFFF' });
    col.addEventListener('input', () => { sel.value = 'color'; });
    return { node: el('label', { class: 'il-lab' }, [label, el('div', { class: 'il-row' }, [sel, col])]), get: () => sel.value === 'keep' ? undefined : sel.value === 'none' ? null : col.value.toUpperCase() };
  }
  function shapePreview(isl, texts, fill) {
    const b = box(isl);
    if (!b) return;
    if (texts) b.innerHTML = texts.map(t => t.split('\n').map(l => `<span class="pl-tbp">${esc(l) || '<br>'}</span>`).join('')).join('<span class="pl-tbp il-sep"></span>');
    if (fill !== undefined) b.style.background = fill || 'transparent';
  }
  async function editShape(isl) {
    const doc = parse(xOf(isl));
    const root = doc.documentElement;
    const { main } = branches(root);
    const boxes = desc(main, 'w:txbxContent').filter(b => !nestedIn(b, 'w:txbxContent', main));
    const hasShape = desc(root, 'wps:spPr').length || vmlShapes(root).length;
    if (!boxes.length && !hasShape) return menu(isl, true);
    const texts = boxes.map(txbxText);
    const complex = boxes.some(b => kids(b).some(k => k.nodeName !== 'w:p'));
    const tas = texts.map(t => { const ta = el('textarea', { class: 'il-ta', rows: Math.min(8, t.split('\n').length + 1) }); ta.value = t; return ta; });
    const cur = currentColors(root);
    const cf = colorField('Remplissage', cur.fill), cl = colorField('Contour', cur.line);
    const body = el('div', { class: 'il-shape' }, [
      ...tas.map((ta, i) => el('label', { class: 'il-lab' }, [tas.length > 1 ? `Texte de la zone ${i + 1}` : 'Texte', ta])),
      complex ? el('p', { class: 'il-note' }, ['Cette zone contient un tableau ou une mise en page complexe : si vous modifiez son texte, il sera remplacé par des paragraphes simples.']) : null,
      hasShape ? el('div', { class: 'il-cols' }, [cf.node, cl.node]) : null
    ]);
    const r = await dialog({ title: boxes.length ? 'Zone de texte' : 'Forme', body, width: 520, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    applyShape(isl, { texts: tas.map((ta, i) => ta.value === texts[i] ? undefined : ta.value), fill: hasShape ? cf.get() : undefined, line: hasShape ? cl.get() : undefined });
  }
  /** Applique texte / couleurs à une forme : {texts:[…|undefined], fill, line} */
  function applyShape(isl, { texts = [], fill, line }) {
    const doc = parse(xOf(isl));
    const root = doc.documentElement;
    const { main, choice, fallback } = branches(root);
    const top = n => desc(n, 'w:txbxContent').filter(b => !nestedIn(b, 'w:txbxContent', n));
    const boxes = top(main);
    const fb = choice && fallback ? top(fallback) : [];
    let changed = false;
    texts.forEach((t, i) => {
      if (t === undefined || !boxes[i]) return;
      setTxbx(doc, boxes[i], t);
      if (fb[i]) setTxbx(doc, fb[i], t);   // branche de repli VML : même texte
      changed = true;
    });
    if (fill !== undefined || line !== undefined) { setColors(doc, root, fill, line); changed = true; }
    if (!changed) return;
    before();
    setX(isl, ser(root));
    shapePreview(isl, texts.some(t => t !== undefined) ? boxes.map(txbxText) : null, fill);
    after(isl);
  }

  /* =====================================================================
     SMARTART (dataN.xml + dessin en cache drawingN.xml)
     ===================================================================== */
  const ptText = p => { const t = kid(p, 'dgm:t'); return t ? kids(t, 'a:p').map(x => desc(x, 'a:t').map(y => y.textContent).join('')).join('\n') : ''; };
  const isNode = p => { const t = p.getAttribute('type'); return !t || t === 'node' || t === 'asst'; };
  const isParOf = c => !c.getAttribute('type') || c.getAttribute('type') === 'parOf';
  /** Nœuds de texte dans l'ordre (parcours en profondeur) */
  function smartNodes(ddoc) {
    const pts = desc(ddoc, 'dgm:pt');
    const byId = new Map(pts.map(p => [p.getAttribute('modelId'), p]));
    const par = desc(ddoc, 'dgm:cxn').filter(isParOf);
    const root = pts.find(p => p.getAttribute('type') === 'doc');
    const out = [];
    const walk = (id, lvl, seen) => {
      if (seen.has(id)) return; seen.add(id);
      par.filter(c => c.getAttribute('srcId') === id).sort((a, b) => +a.getAttribute('srcOrd') - +b.getAttribute('srcOrd')).forEach(c => {
        const p = byId.get(c.getAttribute('destId'));
        if (!p || !isNode(p)) return;
        out.push({ id: c.getAttribute('destId'), level: lvl, text: ptText(p) });
        walk(c.getAttribute('destId'), lvl + 1, seen);
      });
    };
    if (root) walk(root.getAttribute('modelId'), 0, new Set());
    return out;
  }
  function setPtText(ddoc, p, text) {
    let t = kid(p, 'dgm:t');
    if (!t) { t = mk(ddoc, 'dgm:t', {}, [mk(ddoc, 'a:bodyPr'), mk(ddoc, 'a:lstStyle'), mk(ddoc, 'a:p')]); insertBefore(p, t, ['dgm:extLst']); }
    setParas(ddoc, t, text.split('\n'));
    const ps = kid(p, 'dgm:prSet'); if (ps) ps.removeAttribute('phldr');
  }
  /** Renumérote presStyleIdx / presStyleCnt par étiquette de style */
  function renumberStyles(ddoc, order) {
    const groups = {};
    desc(ddoc, 'dgm:prSet').forEach(ps => { if (!ps.hasAttribute('presStyleIdx')) return; (groups[ps.getAttribute('presStyleLbl') || ''] ||= []).push(ps); });
    for (const list of Object.values(groups)) {
      list.sort((a, b) => (order.get(a) ?? +a.getAttribute('presStyleIdx')) - (order.get(b) ?? +b.getAttribute('presStyleIdx')));
      list.forEach((ps, i) => { ps.setAttribute('presStyleIdx', i); ps.setAttribute('presStyleCnt', list.length); });
    }
  }
  function renumberOrd(cxns) {
    const by = {};
    cxns.forEach(c => (by[c.getAttribute('srcId')] ||= []).push(c));
    for (const l of Object.values(by)) l.sort((a, b) => +a.getAttribute('srcOrd') - +b.getAttribute('srcOrd')).forEach((c, i) => c.setAttribute('srcOrd', i));
  }
  /** Supprime un nœud (et ses descendants) du modèle de données */
  function smartDelete(ddoc, id) {
    const pts = desc(ddoc, 'dgm:pt'), cx = desc(ddoc, 'dgm:cxn');
    const gone = new Set();
    const walk = nid => { gone.add(nid); cx.filter(c => isParOf(c) && c.getAttribute('srcId') === nid).forEach(c => walk(c.getAttribute('destId'))); };
    walk(id);
    cx.filter(c => isParOf(c) && gone.has(c.getAttribute('destId'))).forEach(c => { gone.add(c.getAttribute('modelId')); gone.add(c.getAttribute('parTransId')); gone.add(c.getAttribute('sibTransId')); });
    // points de présentation associés (et leurs descendants de présentation)
    const presGone = new Set(pts.filter(p => p.getAttribute('type') === 'pres' && gone.has((kid(p, 'dgm:prSet') || p).getAttribute('presAssocID'))).map(p => p.getAttribute('modelId')));
    let grew = true;
    while (grew) { grew = false; cx.filter(c => c.getAttribute('type') === 'presParOf' && presGone.has(c.getAttribute('srcId')) && !presGone.has(c.getAttribute('destId'))).forEach(c => { presGone.add(c.getAttribute('destId')); grew = true; }); }
    presGone.forEach(x => gone.add(x));
    pts.filter(p => gone.has(p.getAttribute('modelId'))).forEach(p => p.remove());
    cx.filter(c => gone.has(c.getAttribute('modelId')) || gone.has(c.getAttribute('srcId')) || gone.has(c.getAttribute('destId'))).forEach(c => c.remove());
    const left = desc(ddoc, 'dgm:cxn');
    renumberOrd(left.filter(isParOf));
    renumberOrd(left.filter(c => c.getAttribute('type') === 'presParOf'));
    renumberStyles(ddoc, new Map());
  }
  /** Ajoute un nœud frère après `id` (structure et présentation clonées) ; renvoie son identifiant */
  function smartAdd(ddoc, id, text) {
    const pts = desc(ddoc, 'dgm:pt'), cx = desc(ddoc, 'dgm:cxn');
    const byId = new Map(pts.map(p => [p.getAttribute('modelId'), p]));
    const cxn = cx.find(c => isParOf(c) && c.getAttribute('destId') === id);
    const src = byId.get(id);
    if (!cxn || !src) throw new Error('nœud introuvable');
    const ids = { node: guid(), par: guid(), sib: guid(), cxn: guid() };
    const node = src.cloneNode(true); node.setAttribute('modelId', ids.node);
    kids(node, 'dgm:t').forEach(t => t.remove());
    src.after(node);
    setPtText(ddoc, node, text);
    const oldPar = cxn.getAttribute('parTransId'), oldSib = cxn.getAttribute('sibTransId');
    for (const [old, nid] of [[oldPar, ids.par], [oldSib, ids.sib]]) {
      const t = byId.get(old); if (!t) continue;
      const c = t.cloneNode(true); c.setAttribute('modelId', nid); c.setAttribute('cxnId', ids.cxn); node.after(c);
    }
    const ord = +cxn.getAttribute('srcOrd');
    cx.filter(c => isParOf(c) && c.getAttribute('srcId') === cxn.getAttribute('srcId') && +c.getAttribute('srcOrd') > ord).forEach(c => c.setAttribute('srcOrd', +c.getAttribute('srcOrd') + 1));
    const nc = cxn.cloneNode(true);
    nc.setAttribute('modelId', ids.cxn); nc.setAttribute('destId', ids.node); nc.setAttribute('srcOrd', ord + 1); nc.setAttribute('destOrd', 0);
    nc.setAttribute('parTransId', ids.par); nc.setAttribute('sibTransId', ids.sib);
    cxn.after(nc);
    // présentation : on clone celle du nœud source (et de sa transition « frère »)
    const assoc = p => (kid(p, 'dgm:prSet') || p).getAttribute('presAssocID');
    const presOf = a => pts.filter(p => p.getAttribute('type') === 'pres' && assoc(p) === a);
    const map = new Map(), order = new Map();
    const clonePres = (list, newAssoc) => list.forEach(p => {
      const c = p.cloneNode(true); const nid = guid();
      c.setAttribute('modelId', nid);
      const ps = kid(c, 'dgm:prSet'); if (ps) ps.setAttribute('presAssocID', newAssoc);
      kids(c, 'dgm:t').forEach(t => setParas(ddoc, t, ['']));
      p.after(c); map.set(p.getAttribute('modelId'), nid);
      if (ps && ps.hasAttribute('presStyleIdx')) order.set(ps, +ps.getAttribute('presStyleIdx') + 0.5);
    });
    let sibPres = presOf(oldSib);
    if (!sibPres.length) {
      // nœud source en dernière position : sa transition « frère » emprunte la présentation d'un autre frère
      const other = cx.filter(c => isParOf(c) && c.getAttribute('srcId') === cxn.getAttribute('srcId')).map(c => presOf(c.getAttribute('sibTransId'))).find(l => l.length);
      if (other) { clonePres(other, oldSib); sibPres = []; }
      clonePres(presOf(id), ids.node);
    } else { clonePres(presOf(id), ids.node); clonePres(sibPres, ids.sib); }
    // connexions de présentation des clones
    const presCx = cx.filter(c => /^pres(Of|ParOf)$/.test(c.getAttribute('type') || ''));
    const newTop = [];
    for (const c of presCx) {
      const d = map.get(c.getAttribute('destId'));
      if (!d) continue;
      const n = c.cloneNode(true);
      n.setAttribute('modelId', guid()); n.setAttribute('destId', d);
      const s = c.getAttribute('srcId');
      if (c.getAttribute('type') === 'presOf') n.setAttribute('srcId', s === id ? ids.node : s === oldSib ? ids.sib : s);
      else if (map.has(s)) n.setAttribute('srcId', map.get(s));
      else newTop.push(n);
      c.parentNode.append(n);
    }
    // ordre des clones de premier niveau : juste après les présentations du nœud source
    if (newTop.length) {
      const parentId = newTop[0].getAttribute('srcId');
      const sibs = desc(ddoc, 'dgm:cxn').filter(c => c.getAttribute('type') === 'presParOf' && c.getAttribute('srcId') === parentId && !newTop.includes(c));
      const srcPres = new Set([...presOf(id), ...presOf(oldSib)].map(p => p.getAttribute('modelId')));
      const at = Math.max(-1, ...sibs.filter(c => srcPres.has(c.getAttribute('destId'))).map(c => +c.getAttribute('srcOrd')));
      sibs.forEach(c => { if (+c.getAttribute('srcOrd') > at) c.setAttribute('srcOrd', +c.getAttribute('srcOrd') + newTop.length); });
      newTop.forEach((c, i) => c.setAttribute('srcOrd', at + 1 + i));
    }
    renumberStyles(ddoc, order);
    return ids.node;
  }
  async function smartCtx(isl) {
    const x = parse(xOf(isl));
    const ri = desc(x, 'dgm:relIds')[0];
    if (!ri) return null;
    const dmRid = ri.getAttribute('r:dm');
    const own = ownOf(isl) || { rels: {}, parts: {} };
    const z = zip();
    const data = await linked(isl, dmRid, own, z);
    if (!data || !data.xml) return null;
    let drawing = null, drawingRels = [];
    if (data.own) {
      const hr = (data.own.hostRels || []).find(h => h.type === T.dgmDrawing);
      if (hr) {
        if (hr.part && own.parts[hr.part]) { drawing = own.parts[hr.part].xml; drawingRels = own.parts[hr.part].rels || []; }
        else if (hr.src) { drawing = await srcText(z, hr.src); drawingRels = await srcRelList(z, hr.src); }
      }
    } else {
      const ext = desc(parse(data.xml), 'dsp:dataModelExt')[0];
      const rid = ext && ext.getAttribute('relId');
      const host = isl.dataset.part || 'word/document.xml';
      const r = rid && z ? (await srcRels(z, host))[rid] : null;
      if (r && r.mode !== 'External') { const path = resolve(host, r.target); drawing = await srcText(z, path); drawingRels = await srcRelList(z, path); }
    }
    return { own, dmRid, data, drawing, drawingRels };
  }
  /** Applique des modifications : rows = [{id|null, text, after (id du nœud cloné pour un ajout)}], dans l'ordre voulu */
  async function applySmart(isl, rows, ctx) {
    ctx = ctx || await smartCtx(isl);
    const ddoc = parse(ctx.data.xml);
    const before0 = smartNodes(ddoc);
    const keepIds = new Set(rows.filter(r => r.id).map(r => r.id));
    let structural = false;
    for (const n of before0) if (!keepIds.has(n.id) && desc(ddoc, 'dgm:pt').some(p => p.getAttribute('modelId') === n.id)) { smartDelete(ddoc, n.id); structural = true; }
    // ajouts : après le dernier nœud de même niveau qui précède dans la liste
    const lastAt = [];
    for (const r of rows) {
      const lv = r.level || 0;
      if (!r.id) {
        const anchor = lastAt[lv] || r.after;
        if (!anchor) throw new Error('position du nouvel élément introuvable');
        r.id = smartAdd(ddoc, anchor, r.text); r.added = true; structural = true;
      }
      lastAt[lv] = r.id; lastAt.length = lv + 1;
    }
    // textes
    const byId = new Map(desc(ddoc, 'dgm:pt').map(p => [p.getAttribute('modelId'), p]));
    const changedTxt = [];
    for (const r of rows) {
      const p = byId.get(r.id); if (!p || r.added) continue;
      if (ptText(p) !== r.text) { setPtText(ddoc, p, r.text); changedTxt.push(r); }
    }
    if (!structural && !changedTxt.length) return false;
    // dessin en cache : textes mis à jour, ou abandonné si la structure change (Word et LibreOffice recalculent la disposition)
    let drawingXml = null;
    if (ctx.drawing && !structural) {
      const dd = parse(ctx.drawing);
      const shapes = new Map(desc(dd, 'dsp:sp').map(s => [s.getAttribute('modelId'), s]));
      const presOf = desc(ddoc, 'dgm:cxn').filter(c => c.getAttribute('type') === 'presOf');
      for (const r of changedTxt) {
        for (const c of presOf.filter(c => c.getAttribute('srcId') === r.id)) {
          const sp = shapes.get(c.getAttribute('destId')); if (!sp) continue;
          let tb = kid(sp, 'dsp:txBody');
          if (!tb) { tb = mk(dd, 'dsp:txBody', {}, [mk(dd, 'a:bodyPr'), mk(dd, 'a:lstStyle'), mk(dd, 'a:p')]); insertBefore(sp, tb, ['dsp:txXfrm', 'dsp:extLst']); }
          setParas(dd, tb, r.text.split('\n'));
        }
      }
      drawingXml = ser(dd);
    }
    const own = ctx.own;
    const dataKey = newKey();
    const ext = desc(ddoc, 'dsp:dataModelExt')[0];
    const hostRels = [];
    if (ext) {
      if (drawingXml) {
        const dk = newKey();
        own.parts[dk] = { dir: 'word/diagrams', base: 'drawing', ext: 'xml', ct: CT.dgmDrawing, xml: drawingXml, rels: ctx.drawingRels };
        ext.setAttribute('relId', PH_DRAWING);
        hostRels.push({ ph: PH_DRAWING, type: T.dgmDrawing, part: dk });
      } else {
        const a = ext.parentNode, lst = a.parentNode;
        a.remove();
        if (lst && !lst.children.length) lst.remove();
      }
    }
    own.parts[dataKey] = { dir: 'word/diagrams', base: 'data', ext: 'xml', ct: CT.dgmData, xml: ser(ddoc), rels: ctx.data.rels || [], hostRels };
    own.rels[ctx.dmRid] = { type: T.dgmData, part: dataKey };
    before();
    saveOwn(isl, own);
    const b = isl.querySelector('.pl-smart');
    if (b) b.innerHTML = smartNodes(ddoc).slice(0, 12).map(n => `<span>${esc(n.text)}</span>`).join('');
    after(isl);
    return true;
  }
  async function editSmart(isl) {
    const ctx = await smartCtx(isl);
    if (!ctx) return info('SmartArt', 'Les données de ce SmartArt sont introuvables dans le document d’origine.');
    const nodes = smartNodes(parse(ctx.data.xml));
    if (!nodes.length) return info('SmartArt', 'Ce SmartArt ne contient pas de texte modifiable.');
    const rows = nodes.map(n => ({ ...n }));
    const list = el('div', { class: 'il-smart-list' });
    const render = () => {
      list.replaceChildren(...rows.map((r, i) => {
        const ta = el('textarea', { class: 'il-ta il-node', rows: Math.max(1, r.text.split('\n').length), style: { marginLeft: (r.level * 22) + 'px' } });
        ta.value = r.text; ta.addEventListener('input', () => { r.text = ta.value; });
        return el('div', { class: 'il-node-row' }, [ta,
          el('button', { type: 'button', class: 'il-x', title: 'Ajouter un élément après', onclick: () => { let k = i + 1; while (k < rows.length && rows[k].level > r.level) k++; rows.splice(k, 0, { id: null, level: r.level, text: '' }); render(); } }, ['+']),
          el('button', { type: 'button', class: 'il-x', title: 'Supprimer cet élément', disabled: rows.filter(x => x.level === 0).length < 2 && r.level === 0 || null, onclick: () => { const lv = r.level; let k = i + 1; while (k < rows.length && rows[k].level > lv) k++; rows.splice(i, k - i); render(); } }, ['✕'])]);
      }));
    };
    render();
    const body = el('div', {}, [list, el('p', { class: 'il-note' }, ['Ajouter ou supprimer un élément oblige Word et LibreOffice à recalculer la disposition du SmartArt à l’ouverture.'])]);
    const r = await dialog({ title: 'Modifier le texte du SmartArt', body, width: 520, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    await applySmart(isl, rows.map(x => ({ id: x.id, level: x.level, text: x.text })), ctx);
  }

  /* =====================================================================
     ÉQUATIONS : notation linéaire ⇄ AST ⇄ OMML / MathML
     ===================================================================== */
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  const SYM = { pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', partial: '∂', nabla: '∇', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅', angle: '∠', circ: '∘', ldots: '…', cdots: '⋯', prime: '′', perp: '⊥', parallel: '∥', neg: '¬', wedge: '∧', vee: '∨', ast: '∗', hbar: 'ℏ', ell: 'ℓ', mid: '∣', degree: '°', quad: ' ', qquad: ' ' };
  const NARY = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
  const NARY_CH = Object.values(NARY).join('');
  const INTS = '∫∬∭∮';
  const FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'arg', 'dim', 'mod'];
  const LIMFN = ['lim', 'max', 'min', 'sup', 'inf'];
  const ACC = { hat: '̂', bar: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃', check: '̌' };
  const ACC_SHOW = { '̂': '^', '̅': '¯', '̄': '¯', '⃗': '→', '̇': '˙', '̈': '¨', '̃': '~', '̌': 'ˇ' };

  function tokenize(s) {
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '\\') {
        const m = s.slice(i + 1).match(/^[A-Za-z]+/);
        if (m) {
          i += 1 + m[0].length;
          if (['text', 'mathrm', 'textrm'].includes(m[0])) {
            while (s[i] === ' ') i++;
            if (s[i] === '{') { let d = 1, j = i + 1; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } out.push({ k: 'text', v: s.slice(i + 1, d ? j : j - 1) }); i = j; continue; }
          }
          out.push({ k: 'cmd', v: m[0] });
        } else if (i + 1 < s.length) { out.push({ k: 'esc', v: s[i + 1] }); i += 2; }
        else { out.push({ k: 'ch', v: '\\' }); i++; }
        continue;
      }
      if (/[0-9]/.test(c)) { const m = s.slice(i).match(/^[0-9]+(?:[.,][0-9]+)?/)[0]; out.push({ k: 'num', v: m }); i += m.length; continue; }
      if (/[A-Za-z]/.test(c)) {
        const m = s.slice(i).match(/^[A-Za-z]+/)[0];
        if (FUNCS.includes(m)) out.push({ k: 'fn', v: m }); else for (const ch of m) out.push({ k: 'ch', v: ch });
        i += m.length; continue;
      }
      if ('{}()[]^_/'.includes(c)) { out.push({ k: c }); i++; continue; }
      const ch = String.fromCodePoint(s.codePointAt(i));
      out.push({ k: 'ch', v: ch }); i += ch.length;
    }
    return out;
  }
  /** Notation linéaire (LaTeX / UnicodeMath simplifiés) → arbre */
  function parseLinear(s) {
    const tk = tokenize(s); let p = 0;
    const peek = () => tk[p], next = () => tk[p++];
    const CLOSE = { '(': ')', '[': ']' };
    const unwrap = n => !n ? [] : n.t === 'grp' ? n.e : (n.t === 'd' && n.beg === '(' && n.end === ')') ? n.e : [n];
    const delimChar = t => !t ? '' : t.k === 'esc' ? t.v : '()[]'.includes(t.k) ? t.k : t.k === 'ch' ? (t.v === '.' ? '' : t.v) : '';
    function seq(stop) {
      const items = [];
      while (p < tk.length && !stop(peek())) {
        let e = element();
        if (!e) continue;
        while (peek() && peek().k === '/') { next(); e = { t: 'f', num: unwrap(e), den: unwrap(element()) }; }
        items.push(e);
      }
      return items;
    }
    const argOf = () => unwrap(atom());
    function command(v) {
      if (v === 'frac' || v === 'dfrac' || v === 'tfrac') { const a = argOf(); return { t: 'f', num: a, den: argOf() }; }
      if (v === 'sqrt') { let deg = null; if (peek() && peek().k === '[') { next(); deg = seq(x => x.k === ']'); if (peek()) next(); } return { t: 'rad', deg, e: argOf() }; }
      if (NARY[v]) return { t: 'nary', chr: NARY[v], sub: null, sup: null, e: [] };
      if (ACC[v]) return { t: 'acc', chr: ACC[v], e: argOf() };
      if (v === 'overline') return { t: 'bar', e: argOf() };
      if (v === 'underset' || v === 'overset') { const a = argOf(); return { t: v === 'underset' ? 'low' : 'upp', lim: a, e: argOf() }; }
      if (v === 'left') { const beg = delimChar(next()); const e = seq(x => x.k === 'cmd' && x.v === 'right'); let end = ''; if (peek()) { next(); end = delimChar(next()); } return { t: 'd', beg, end, e }; }
      if (v === 'right') return { t: 'r', s: '' };
      if (GREEK[v]) return { t: 'r', s: GREEK[v] };
      if (SYM[v]) return { t: 'r', s: SYM[v] };
      return { t: 'r', s: v, sty: 'p' };
    }
    function atom() {
      const t = peek();
      if (!t) return null;
      switch (t.k) {
        case '{': { next(); const e = seq(x => x.k === '}'); if (peek()) next(); return { t: 'grp', e }; }
        case '(': case '[': { next(); const e = seq(x => x.k === CLOSE[t.k]); const closed = !!peek(); if (closed) next(); return { t: 'd', beg: t.k, end: closed ? CLOSE[t.k] : '', e }; }
        case ')': case ']': case '}': next(); return { t: 'r', s: t.k };
        case '^': case '_': return { t: 'grp', e: [] };
        case '/': next(); return { t: 'r', s: '/' };
        case 'num': next(); return { t: 'r', s: t.v };
        case 'text': next(); return { t: 'r', s: t.v, sty: 'p' };
        case 'fn': next(); return { t: 'r', s: t.v, sty: 'p' };
        case 'esc': next(); return { t: 'r', s: ',; '.includes(t.v) ? ' ' : t.v };
        case 'cmd': next(); return command(t.v);
        default:
          next();
          if (NARY_CH.includes(t.v)) return { t: 'nary', chr: t.v, sub: null, sup: null, e: [] };
          if (t.v === '√') return { t: 'rad', deg: null, e: argOf() };
          return { t: 'r', s: t.v };
      }
    }
    function element() {
      const base = atom();
      if (!base) { if (p < tk.length) next(); return null; }
      let sub = null, sup = null;
      while (peek() && (peek().k === '^' || peek().k === '_')) {
        const k = next().k; const a = unwrap(atom());
        if (k === '^') sup = a; else sub = a;
      }
      if (base.t === 'nary') {
        base.sub = sub; base.sup = sup;
        if (peek() && !['}', ')', ']'].includes(peek().k) && !(peek().k === 'cmd' && peek().v === 'right')) { const e = element(); base.e = e ? (e.t === 'grp' ? e.e : [e]) : []; }
        return base;
      }
      const be = base.t === 'grp' ? base.e : [base];
      if (sub && !sup && base.t === 'r' && base.sty === 'p' && LIMFN.includes(base.s)) return { t: 'low', e: be, lim: sub };
      if (sub && sup) return { t: 'subsup', e: be, sub, sup };
      if (sup) return { t: 'sup', e: be, sup };
      if (sub) return { t: 'sub', e: be, sub };
      return base;
    }
    return seq(() => false);
  }
  /** Fusionne les runs voisins de même style */
  function merge(list) {
    const out = [];
    for (const n of list || []) {
      if (n.t === 'grp') { out.push(...merge(n.e)); continue; }
      const last = out[out.length - 1];
      if (n.t === 'r' && last && last.t === 'r' && (last.sty || null) === (n.sty || null) && !n.sty) last.s += n.s;
      else out.push(n.t === 'r' ? { ...n } : n);
    }
    return out.filter(n => !(n.t === 'r' && n.s === ''));
  }

  const MR = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
  function omml(list) {
    const o = l => omml(l || []);
    return merge(list).map(n => {
      switch (n.t) {
        case 'r': return `<m:r>${n.sty === 'p' ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}${MR}<m:t xml:space="preserve">${esc(n.s)}</m:t></m:r>`;
        case 'f': return `<m:f><m:num>${o(n.num)}</m:num><m:den>${o(n.den)}</m:den></m:f>`;
        case 'sup': return `<m:sSup><m:e>${o(n.e)}</m:e><m:sup>${o(n.sup)}</m:sup></m:sSup>`;
        case 'sub': return `<m:sSub><m:e>${o(n.e)}</m:e><m:sub>${o(n.sub)}</m:sub></m:sSub>`;
        case 'subsup': return `<m:sSubSup><m:e>${o(n.e)}</m:e><m:sub>${o(n.sub)}</m:sub><m:sup>${o(n.sup)}</m:sup></m:sSubSup>`;
        case 'rad': return n.deg && n.deg.length ? `<m:rad><m:deg>${o(n.deg)}</m:deg><m:e>${o(n.e)}</m:e></m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${o(n.e)}</m:e></m:rad>`;
        case 'nary': {
          const pr = (n.chr !== '∫' ? `<m:chr m:val="${esc(n.chr)}"/>` : '') + `<m:limLoc m:val="${INTS.includes(n.chr) ? 'subSup' : 'undOvr'}"/>` + (!n.sub ? '<m:subHide m:val="1"/>' : '') + (!n.sup ? '<m:supHide m:val="1"/>' : '');
          return `<m:nary><m:naryPr>${pr}</m:naryPr><m:sub>${o(n.sub)}</m:sub><m:sup>${o(n.sup)}</m:sup><m:e>${o(n.e)}</m:e></m:nary>`;
        }
        case 'd': {
          const pr = (n.beg !== '(' ? `<m:begChr m:val="${esc(n.beg)}"/>` : '') + (n.end !== ')' ? `<m:endChr m:val="${esc(n.end)}"/>` : '');
          return `<m:d>${pr ? `<m:dPr>${pr}</m:dPr>` : ''}<m:e>${o(n.e)}</m:e></m:d>`;
        }
        case 'acc': return `<m:acc><m:accPr><m:chr m:val="${esc(n.chr)}"/></m:accPr><m:e>${o(n.e)}</m:e></m:acc>`;
        case 'bar': return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${o(n.e)}</m:e></m:bar>`;
        case 'low': return `<m:limLow><m:e>${o(n.e)}</m:e><m:lim>${o(n.lim)}</m:lim></m:limLow>`;
        case 'upp': return `<m:limUpp><m:e>${o(n.e)}</m:e><m:lim>${o(n.lim)}</m:lim></m:limUpp>`;
      }
      return '';
    }).join('');
  }
  function toOmml(ast, display) {
    const body = omml(ast);
    return display ? `<m:oMathPara xmlns:m="${NS.m}" xmlns:w="${NS.w}"><m:oMath>${body}</m:oMath></m:oMathPara>` : `<m:oMath xmlns:m="${NS.m}" xmlns:w="${NS.w}">${body}</m:oMath>`;
  }

  const onOff = e => !!e && !/^(0|off|false)$/.test(e.getAttribute('m:val') || '');
  /** OMML → arbre (warn : ensemble des constructions simplifiées) */
  function fromOmml(node, warn) {
    const k = q => kid(node, q);
    const ch = q => fromKids(k(q), warn);
    switch (node.nodeName) {
      case 'm:r': {
        const t = kids(node).filter(c => c.nodeName === 'm:t' || c.nodeName === 'w:t').map(c => c.textContent).join('');
        const rp = k('m:rPr');
        const sty = rp && (kid(rp, 'm:nor') || (kid(rp, 'm:sty') && kid(rp, 'm:sty').getAttribute('m:val') === 'p')) ? 'p' : null;
        return [{ t: 'r', s: t, sty }];
      }
      case 'w:r': return [{ t: 'r', s: desc(node, 'w:t').map(x => x.textContent).join(''), sty: 'p' }];
      case 'm:f': return [{ t: 'f', num: ch('m:num'), den: ch('m:den') }];
      case 'm:sSup': return [{ t: 'sup', e: ch('m:e'), sup: ch('m:sup') }];
      case 'm:sSub': return [{ t: 'sub', e: ch('m:e'), sub: ch('m:sub') }];
      case 'm:sSubSup': return [{ t: 'subsup', e: ch('m:e'), sub: ch('m:sub'), sup: ch('m:sup') }];
      case 'm:sPre': warn.add('indices à gauche'); return [{ t: 'subsup', e: ch('m:e'), sub: ch('m:sub'), sup: ch('m:sup') }];
      case 'm:rad': { const pr = k('m:radPr'); const deg = ch('m:deg'); return [{ t: 'rad', deg: onOff(pr && kid(pr, 'm:degHide')) || !deg.length ? null : deg, e: ch('m:e') }]; }
      case 'm:nary': {
        const pr = k('m:naryPr'); const c = pr && kid(pr, 'm:chr');
        const sub = ch('m:sub'), sup = ch('m:sup');
        return [{ t: 'nary', chr: (c && c.getAttribute('m:val')) || '∫', sub: onOff(pr && kid(pr, 'm:subHide')) || !sub.length ? null : sub, sup: onOff(pr && kid(pr, 'm:supHide')) || !sup.length ? null : sup, e: ch('m:e') }];
      }
      case 'm:d': {
        const pr = k('m:dPr');
        const g = (q, d) => { const x = pr && kid(pr, q); return x ? (x.getAttribute('m:val') ?? '') : d; };
        const sep = g('m:sepChr', '|');
        const e = kids(node, 'm:e').map(x => fromKids(x, warn)).flatMap((x, i) => i ? [{ t: 'r', s: sep }, ...x] : x);
        return [{ t: 'd', beg: g('m:begChr', '('), end: g('m:endChr', ')'), e }];
      }
      case 'm:acc': { const pr = k('m:accPr'); const c = pr && kid(pr, 'm:chr'); return [{ t: 'acc', chr: c ? c.getAttribute('m:val') : '̂', e: ch('m:e') }]; }
      case 'm:bar': { const pr = k('m:barPr'); const pos = pr && kid(pr, 'm:pos'); if (pos && pos.getAttribute('m:val') === 'bot') warn.add('barre inférieure'); return [{ t: 'bar', e: ch('m:e') }]; }
      case 'm:func': return [...fromKids(k('m:fName'), warn).map(x => x.t === 'r' ? { ...x, sty: 'p' } : x), ...ch('m:e')];
      case 'm:limLow': return [{ t: 'low', e: ch('m:e'), lim: ch('m:lim') }];
      case 'm:limUpp': return [{ t: 'upp', e: ch('m:e'), lim: ch('m:lim') }];
      case 'm:groupChr': warn.add('accolade de groupement'); return ch('m:e');
      case 'm:borderBox': warn.add('encadré'); return ch('m:e');
      case 'm:box': case 'm:phant': return ch('m:e');
      case 'm:m': warn.add('matrice'); return kids(node, 'm:mr').flatMap((r, i) => [...(i ? [{ t: 'r', s: ' ; ' }] : []), ...kids(r, 'm:e').flatMap((e, j) => [...(j ? [{ t: 'r', s: ' ' }] : []), ...fromKids(e, warn)])]);
      case 'm:eqArr': warn.add('système d’équations'); return kids(node, 'm:e').flatMap((e, i) => [...(i ? [{ t: 'r', s: ' ; ' }] : []), ...fromKids(e, warn)]);
      case 'm:oMathPara': { const ms = kids(node, 'm:oMath'); if (ms.length > 1) warn.add('plusieurs lignes'); return ms.flatMap((m, i) => [...(i ? [{ t: 'r', s: ' ' }] : []), ...fromKids(m, warn)]); }
      default: return /Pr$/.test(node.nodeName) ? [] : fromKids(node, warn);
    }
  }
  function fromKids(n, warn) { return n ? kids(n).flatMap(c => fromOmml(c, warn)) : []; }

  /** Arbre → notation linéaire */
  function lin(list) {
    let out = '';
    for (const n of merge(list)) {
      const s = linOne(n);
      if (out && /[A-Za-z]$/.test(out) && /^[A-Za-z]/.test(s)) out += ' ';
      out += s;
    }
    return out;
  }
  const simple = l => { const m = merge(l); return m.length === 1 && m[0].t === 'r' && !m[0].sty && ([...m[0].s].length === 1 || /^[0-9]+$/.test(m[0].s)); };
  const grp = l => simple(l) ? lin(l) : `{${lin(l)}}`;
  const baseLin = l => { const m = merge(l); return simple(l) || (m.length === 1 && m[0].t === 'd') ? lin(l) : `{${lin(l)}}`; };
  const dl = c => c === '' ? '.' : c === '{' ? '\\{' : c === '}' ? '\\}' : c;
  function linOne(n) {
    switch (n.t) {
      case 'r':
        if (n.sty === 'p') return FUNCS.includes(n.s) ? '\\' + n.s : `\\text{${n.s}}`;
        return n.s.replace(/[{}^_/\\]/g, c => '\\' + c);
      case 'f': return `\\frac{${lin(n.num)}}{${lin(n.den)}}`;
      case 'sup': return `${baseLin(n.e)}^${grp(n.sup)}`;
      case 'sub': return `${baseLin(n.e)}_${grp(n.sub)}`;
      case 'subsup': return `${baseLin(n.e)}_${grp(n.sub)}^${grp(n.sup)}`;
      case 'rad': return n.deg ? `\\sqrt[${lin(n.deg)}]{${lin(n.e)}}` : `\\sqrt{${lin(n.e)}}`;
      case 'nary': {
        const name = Object.keys(NARY).find(k => NARY[k] === n.chr);
        const e = merge(n.e);
        return (name ? '\\' + name : n.chr) + (n.sub ? '_' + grp(n.sub) : '') + (n.sup ? '^' + grp(n.sup) : '') + (e.length ? ' ' + (simple(e) || (e.length === 1 && e[0].t !== 'r') ? lin(e) : `{${lin(e)}}`) : '');
      }
      case 'd':
        if (n.beg === '(' && n.end === ')') return `(${lin(n.e)})`;
        if (n.beg === '[' && n.end === ']') return `[${lin(n.e)}]`;
        return `\\left${dl(n.beg)} ${lin(n.e)} \\right${dl(n.end)}`;
      case 'acc': return `\\${Object.keys(ACC).find(k => ACC[k] === n.chr) || 'hat'}{${lin(n.e)}}`;
      case 'bar': return `\\overline{${lin(n.e)}}`;
      case 'low': { const e = merge(n.e); return e.length === 1 && e[0].t === 'r' && e[0].sty === 'p' && LIMFN.includes(e[0].s) ? `\\${e[0].s}_${grp(n.lim)}` : `\\underset{${lin(n.lim)}}{${lin(n.e)}}`; }
      case 'upp': return `\\overset{${lin(n.lim)}}{${lin(n.e)}}`;
    }
    return '';
  }

  /** Arbre → MathML (aperçu natif du navigateur) */
  function mml(list) { return merge(list).map(mmlOne).join(''); }
  const row = l => `<mrow>${mml(l || [])}</mrow>`;
  function mmlOne(n) {
    switch (n.t) {
      case 'r': {
        if (n.sty === 'p') return /^[A-Za-z]+$/.test(n.s) ? `<mi mathvariant="normal">${esc(n.s)}</mi>` : `<mtext>${esc(n.s)}</mtext>`;
        let o = '';
        for (const m of n.s.matchAll(/([0-9]+(?:[.,][0-9]+)?)|(\s+)|([\p{L}])|(.)/gsu)) {
          if (m[1]) o += `<mn>${m[1]}</mn>`;
          else if (m[2]) continue;
          else if (m[3]) o += `<mi>${esc(m[3])}</mi>`;
          else o += `<mo>${esc(m[4])}</mo>`;
        }
        return o;
      }
      case 'f': return `<mfrac>${row(n.num)}${row(n.den)}</mfrac>`;
      case 'sup': return `<msup>${row(n.e)}${row(n.sup)}</msup>`;
      case 'sub': return `<msub>${row(n.e)}${row(n.sub)}</msub>`;
      case 'subsup': return `<msubsup>${row(n.e)}${row(n.sub)}${row(n.sup)}</msubsup>`;
      case 'rad': return n.deg ? `<mroot>${row(n.e)}${row(n.deg)}</mroot>` : `<msqrt>${row(n.e)}</msqrt>`;
      case 'nary': {
        const isInt = INTS.includes(n.chr);
        const op = `<mo largeop="true" movablelimits="false">${esc(n.chr)}</mo>`;
        const tag = n.sub && n.sup ? (isInt ? 'msubsup' : 'munderover') : n.sub ? (isInt ? 'msub' : 'munder') : n.sup ? (isInt ? 'msup' : 'mover') : null;
        return `<mrow>${tag ? `<${tag}>${op}${n.sub ? row(n.sub) : ''}${n.sup ? row(n.sup) : ''}</${tag}>` : op}${mml(n.e)}</mrow>`;
      }
      case 'd': return `<mrow>${n.beg ? `<mo>${esc(n.beg)}</mo>` : ''}${mml(n.e)}${n.end ? `<mo>${esc(n.end)}</mo>` : ''}</mrow>`;
      case 'acc': return `<mover accent="true">${row(n.e)}<mo>${esc(ACC_SHOW[n.chr] || n.chr)}</mo></mover>`;
      case 'bar': return `<mover accent="true">${row(n.e)}<mo stretchy="true">‾</mo></mover>`;
      case 'low': return `<munder>${row(n.e)}${row(n.lim)}</munder>`;
      case 'upp': return `<mover>${row(n.e)}${row(n.lim)}</mover>`;
    }
    return '';
  }
  const mathml = (ast, display) => `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${mml(ast)}</math>`;
  /** Aperçu HTML d'un nœud OMML (utilisé aussi à l'import) */
  function mathPreview(node) {
    const display = node.nodeName === 'm:oMathPara';
    const ast = fromOmml(node, new Set());
    return `<span class="pl-math${display ? ' pl-math-d' : ''}">${mathml(ast, display)}</span>`;
  }
  /** OMML (chaîne) → notation linéaire */
  function ommlToLinear(xml) {
    const warn = new Set();
    const node = parse(xml).documentElement;
    return { lin: lin(fromOmml(node, warn)), warn: [...warn], display: node.nodeName === 'm:oMathPara' };
  }
  const linearToOmml = (s, display) => toOmml(parseLinear(s), display);

  const PALETTE_MATH = [['a/b', '\\frac{a}{b}', 'Fraction'], ['x²', '^{2}', 'Exposant'], ['xᵢ', '_{i}', 'Indice'], ['√', '\\sqrt{x}', 'Racine carrée'], ['ⁿ√', '\\sqrt[n]{x}', 'Racine n-ième'],
    ['∑', '\\sum_{i=1}^{n} ', 'Somme'], ['∫', '\\int_{a}^{b} ', 'Intégrale'], ['lim', '\\lim_{x\\to 0} ', 'Limite'], ['( )', '()', 'Parenthèses'], ['x̂', '\\hat{x}', 'Accent'],
    ...'α β γ δ θ λ μ π σ φ ω Δ Σ Ω ± × ÷ ⋅ ≤ ≥ ≠ ≈ ∞ → ∂ ∈'.split(' ').map(c => [c, c, ''])];
  async function mathDialog(lin0, display, warn, title) {
    const ta = el('textarea', { class: 'il-ta il-math-in', rows: 3, spellcheck: 'false', placeholder: 'Exemple : x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' });
    ta.value = lin0;
    const pv = el('div', { class: 'il-math-pv' });
    const upd = () => { try { pv.innerHTML = ta.value.trim() ? mathml(parseLinear(ta.value), true) : '<span class="il-note">Aperçu</span>'; } catch { pv.textContent = '…'; } };
    ta.addEventListener('input', upd);
    const pal = el('div', { class: 'il-pal' }, PALETTE_MATH.map(([l, snip, t]) => el('button', {
      type: 'button', class: 'il-pal-b', title: t || snip, onclick: () => {
        const s = ta.selectionStart, e = ta.selectionEnd;
        ta.setRangeText(snip, s, e, 'end'); ta.focus(); upd();
      }
    }, [l])));
    const chk = el('input', { type: 'checkbox' }); chk.checked = !!display;
    const body = el('div', { class: 'il-math' }, [pal, ta, pv,
      el('label', { class: 'il-check' }, [chk, ' Équation centrée sur sa propre ligne (affichage)']),
      warn && warn.length ? el('p', { class: 'il-note il-warn' }, ['Éléments simplifiés lors de la modification : ' + warn.join(', ') + '.']) : null,
      el('p', { class: 'il-note' }, ['Notation : a/b, x^2, x_i, \\sqrt{x}, \\sum_{i=1}^{n}, \\int_0^1, \\alpha, \\pm, \\le, \\infty… Les accolades { } regroupent.'])]);
    const r = await dialog({
      title, body, width: 640, onOpen: upd,
      buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok', onClick: () => { if (!ta.value.trim()) { toast('Saisissez une équation.'); return false; } return true; } }]
    });
    return r === 'ok' ? { lin: ta.value, display: chk.checked } : null;
  }
  function applyMath(isl, linear, display) {
    const xml = linearToOmml(linear, display);
    parse(xml);   // contrôle : XML bien formé
    before();
    setX(isl, xml);
    isl.innerHTML = mathPreview(parse(xml).documentElement);
    after(isl);
  }
  async function editMath(isl) {
    const o = ommlToLinear(xOf(isl));
    const r = await mathDialog(o.lin, o.display, o.warn, 'Modifier l’équation');
    if (!r) return;
    if (r.lin === o.lin && r.display === o.display) return;
    applyMath(isl, r.lin, r.display);
  }
  function mathIsland(linear, display) {
    const xml = linearToOmml(linear, display);
    return `<span class="pl-island" contenteditable="false" data-kind="math" data-part="word/document.xml" data-x="${b64(xml)}">${mathPreview(parse(xml).documentElement)}</span>`;
  }
  /** Insertion > Équation */
  async function insertMath(linear, display) {
    if (linear == null) {
      const r = Ed.lastRange;
      const blk = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('p,li,h1,h2,h3,h4,h5,h6,td,th');
      const empty = !!(blk && !blk.textContent.trim() && !blk.querySelector('.pl-island,img'));
      const res = await mathDialog('', empty, null, 'Insérer une équation');
      if (!res) return null;
      linear = res.lin; display = res.display;
    }
    before();
    Ed.insertHTML(mathIsland(linear, display) + '&#8203;');
    return true;
  }

  /* =====================================================================
     PROPRIÉTÉS (taille, habillage) ET REMPLACEMENT D'IMAGE
     ===================================================================== */
  const ptOf = (style, prop) => { const m = (style || '').match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([\\d.]+)pt')); return m ? +m[1] : null; };
  const setPt = (style, prop, v) => new RegExp('(^|;)\\s*' + prop + '\\s*:').test(style || '') ? style.replace(new RegExp('((?:^|;)\\s*' + prop + '\\s*:\\s*)[^;]*'), `$1${v}pt`) : (style ? style + ';' : '') + `${prop}:${v}pt`;
  const setCss = (style, prop, v) => new RegExp('(^|;)\\s*' + prop + '\\s*:').test(style || '') ? style.replace(new RegExp('((?:^|;)\\s*' + prop + '\\s*:\\s*)[^;]*'), `$1${v}`) : (style ? style + ';' : '') + `${prop}:${v}`;
  function geometry(root) {
    const { main, fallback } = branches(root);
    const ext = desc(main, 'wp:extent')[0];
    const vml = vmlShapes(fallback || root).find(v => ptOf(v.getAttribute('style'), 'width') != null);
    const anchor = desc(main, 'wp:anchor')[0];
    let w = null, h = null;
    if (ext) { w = +ext.getAttribute('cx') / 9525; h = +ext.getAttribute('cy') / 9525; }
    else if (vml) { w = ptOf(vml.getAttribute('style'), 'width') / 0.75; h = ptOf(vml.getAttribute('style'), 'height') / 0.75; }
    let wrap = null, align = null;
    if (anchor) {
      wrap = anchor.getAttribute('behindDoc') === '1' && desc(anchor, 'wp:wrapNone').length ? 'behind' : desc(anchor, 'wp:wrapNone').length ? 'front' : desc(anchor, 'wp:wrapTopAndBottom').length ? 'topBottom' : 'square';
      const ph = kid(anchor, 'wp:positionH'); const al = ph && kid(ph, 'wp:align'); align = al ? al.textContent.trim() : null;
    }
    return { w, h, anchor: !!anchor, wrap, align, vml: !!vml };
  }
  /** Taille (px), habillage et alignement d'un objet : {w, h, wrap, align} */
  async function applyProps(isl, { w, h, wrap, align }) {
    const doc = parse(xOf(isl));
    const root = doc.documentElement;
    const { main, fallback } = branches(root);
    const g0 = geometry(root);
    if (w && h) {
      for (const ext of desc(main, 'wp:extent')) { ext.setAttribute('cx', emu(w)); ext.setAttribute('cy', emu(h)); }
      const gd = desc(main, 'a:graphicData')[0];
      const shape = gd && gd.firstElementChild;
      const sp = shape && (kid(shape, 'pic:spPr') || kid(shape, 'wps:spPr') || kid(shape, 'wpg:grpSpPr'));
      const xe = sp && kid(kid(sp, 'a:xfrm'), 'a:ext');
      if (xe) { xe.setAttribute('cx', emu(w)); xe.setAttribute('cy', emu(h)); }
      for (const v of vmlShapes(fallback || root)) {
        if (ptOf(v.getAttribute('style'), 'width') == null || nestedIn(v, 'v:group', root)) continue;
        v.setAttribute('style', setPt(setPt(v.getAttribute('style'), 'width', +(w * 0.75).toFixed(2)), 'height', +(h * 0.75).toFixed(2)));
      }
    }
    const anchor = desc(main, 'wp:anchor')[0];
    if (anchor && wrap && wrap !== g0.wrap) {
      ['wp:wrapNone', 'wp:wrapSquare', 'wp:wrapTight', 'wp:wrapThrough', 'wp:wrapTopAndBottom'].forEach(q => kids(anchor, q).forEach(x => x.remove()));
      const nw = wrap === 'square' ? mk(doc, 'wp:wrapSquare', { wrapText: 'bothSides' }) : wrap === 'topBottom' ? mk(doc, 'wp:wrapTopAndBottom') : mk(doc, 'wp:wrapNone');
      insertBefore(anchor, nw, ['wp:docPr', 'wp:cNvGraphicFramePr', 'a:graphic']);
      anchor.setAttribute('behindDoc', wrap === 'behind' ? '1' : '0');
      for (const v of vmlShapes(fallback || doc.createElement('x'))) {
        kids(v, 'w10:wrap').forEach(x => x.remove());
        if (wrap === 'square' || wrap === 'topBottom') v.append(mk(doc, 'w10:wrap', { type: wrap === 'square' ? 'square' : 'topAndBottom' }));
        const z = Math.abs(parseInt(((v.getAttribute('style') || '').match(/z-index:\s*(-?\d+)/) || [])[1] || '251659264', 10));
        v.setAttribute('style', setCss(v.getAttribute('style'), 'z-index', wrap === 'behind' ? -z : z));
      }
    }
    if (anchor && align && align !== g0.align) {
      const ph = kid(anchor, 'wp:positionH');
      if (ph) { ph.setAttribute('relativeFrom', 'margin'); ph.replaceChildren(mk(doc, 'wp:align', {}, align)); }
      for (const v of vmlShapes(fallback || doc.createElement('x'))) {
        v.setAttribute('style', setCss(setCss(v.getAttribute('style'), 'mso-position-horizontal', align), 'mso-position-horizontal-relative', 'margin'));
      }
    }
    before();
    setX(isl, ser(root));
    // aperçu
    const g = geometry(root);
    const target = box(isl) || isl.querySelector('img');
    if (target && g.w) { target.style.width = Math.round(g.w) + 'px'; target.style[box(isl) && isl.dataset.kind === 'textbox' ? 'minHeight' : 'height'] = Math.round(g.h) + 'px'; }
    if (g.anchor) {
      const fl = g.wrap === 'square' ? (g.align === 'right' ? 'right' : 'left') : null;
      isl.style.float = fl || ''; isl.style.margin = fl ? (fl === 'right' ? '2px 0 6px 10px' : '2px 10px 6px 0') : '';
    }
    if (isl.dataset.kind === 'chart' && w && h) await rerenderChart(isl);
    after(isl);
  }
  async function rerenderChart(isl) {
    const cEl = desc(parse(xOf(isl)), 'c:chart')[0];
    const p = cEl && await linked(isl, cEl.getAttribute('r:id'));
    if (p && p.xml) chartPreview(isl, p.xml);
  }
  async function properties(isl) {
    const root = parse(xOf(isl)).documentElement;
    const g = geometry(root);
    if (!g.w) return info('Propriétés', 'Cet objet n’a pas de taille modifiable dans Plume.');
    const cm = px => (px * 2.54 / 96).toFixed(2).replace('.', ',');
    const num = v => parseFloat(String(v).replace(',', '.'));
    const wi = el('input', { type: 'text', class: 'il-in', value: cm(g.w) }), hi = el('input', { type: 'text', class: 'il-in', value: cm(g.h) });
    const keep = el('input', { type: 'checkbox' }); keep.checked = true;
    const ratio = g.h / g.w;
    wi.addEventListener('input', () => { if (keep.checked && num(wi.value) > 0) hi.value = (num(wi.value) * ratio).toFixed(2).replace('.', ','); });
    hi.addEventListener('input', () => { if (keep.checked && num(hi.value) > 0) wi.value = (num(hi.value) / ratio).toFixed(2).replace('.', ','); });
    const wrapSel = el('select', { class: 'il-in' }, [['square', 'Carré'], ['topBottom', 'Haut et bas'], ['front', 'Devant le texte'], ['behind', 'Derrière le texte']].map(([v, l]) => el('option', { value: v }, [l])));
    const alSel = el('select', { class: 'il-in' }, [['', 'Inchangée'], ['left', 'Gauche'], ['center', 'Centrée'], ['right', 'Droite']].map(([v, l]) => el('option', { value: v }, [l])));
    if (g.wrap) wrapSel.value = g.wrap;
    if (g.align) alSel.value = g.align;
    const body = el('div', { class: 'il-props' }, [
      el('div', { class: 'il-cols' }, [el('label', { class: 'il-lab' }, ['Largeur (cm)', wi]), el('label', { class: 'il-lab' }, ['Hauteur (cm)', hi])]),
      el('label', { class: 'il-check' }, [keep, ' Conserver les proportions']),
      g.anchor ? el('div', { class: 'il-cols' }, [el('label', { class: 'il-lab' }, ['Habillage', wrapSel]), el('label', { class: 'il-lab' }, ['Position horizontale', alSel])])
        : el('p', { class: 'il-note' }, ['Objet aligné sur le texte (habillage non modifiable ici).'])
    ]);
    const r = await dialog({ title: 'Propriétés de l’objet', body, width: 460, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    const w = num(wi.value) * 96 / 2.54, h = num(hi.value) * 96 / 2.54;
    if (!(w > 0 && h > 0)) { toast('Taille invalide.'); return; }
    await applyProps(isl, { w, h, wrap: g.anchor ? wrapSel.value : null, align: g.anchor ? alSel.value || null : null });
  }
  const IMG_EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif' };
  function pickImage() {
    return new Promise(res => {
      const i = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', style: 'display:none' });
      i.addEventListener('change', () => { res(i.files[0] || null); i.remove(); });
      document.body.append(i); i.click();
    });
  }
  const canReplace = root => { const { main } = branches(root); return !desc(root, 'w:object').length && (desc(main, 'pic:pic').length > 0 || (!desc(root, 'w:drawing').length && desc(root, 'v:imagedata').length > 0)); };
  /** Remplace l'image d'un objet (proportions de la nouvelle image, largeur conservée) */
  async function replaceImage(isl, file) {
    file = file || await pickImage();
    if (!file) return;
    if (!IMG_EXT[file.type]) { toast('Formats acceptés : PNG, JPEG, GIF.'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const url = Ed.registerImage(file);
    const img = new Image(); img.src = url; await img.decode().catch(() => { });
    const doc = parse(xOf(isl)); const root = doc.documentElement;
    const own = ownOf(isl) || { rels: {}, parts: {} };
    const key = newKey();
    own.parts[key] = { dir: 'word/media', base: 'image', ext: IMG_EXT[file.type], ct: file.type, bin: btoa(bin) };
    const xml0 = ser(root);
    let n = 1; while (xml0.includes(`"rIdPlImg${n}"`)) n++;
    const rid = 'rIdPlImg' + n;
    for (const b of desc(root, 'a:blip')) { b.removeAttribute('r:link'); b.setAttributeNS(NS.r, 'r:embed', rid); kids(b, 'a:extLst').forEach(x => x.remove()); }
    for (const v of desc(root, 'v:imagedata')) v.setAttributeNS(NS.r, 'r:id', rid);
    own.rels[rid] = { type: T.image, part: key };
    before();
    setX(isl, ser(root));
    saveOwn(isl, own);
    const g = geometry(root);
    if (g.w && img.naturalWidth) applyPropsSilent(isl, g.w, g.w * img.naturalHeight / img.naturalWidth);
    const g2 = geometry(parse(xOf(isl)).documentElement);
    const prev = isl.querySelector('img') || box(isl);
    const ni = el('img', { src: url, alt: '', draggable: 'false', style: `width:${Math.round(g2.w || img.naturalWidth)}px;height:${Math.round(g2.h || img.naturalHeight)}px` });
    if (prev) prev.replaceWith(ni); else isl.append(ni);
    after(isl);
  }
  function applyPropsSilent(isl, w, h) {
    const doc = parse(xOf(isl)); const root = doc.documentElement;
    const { main, fallback } = branches(root);
    for (const ext of desc(main, 'wp:extent')) { ext.setAttribute('cx', emu(w)); ext.setAttribute('cy', emu(h)); }
    const gd = desc(main, 'a:graphicData')[0];
    const shape = gd && gd.firstElementChild;
    const sp = shape && (kid(shape, 'pic:spPr') || kid(shape, 'wps:spPr'));
    const xe = sp && kid(kid(sp, 'a:xfrm'), 'a:ext');
    if (xe) { xe.setAttribute('cx', emu(w)); xe.setAttribute('cy', emu(h)); }
    for (const v of vmlShapes(fallback || root)) if (ptOf(v.getAttribute('style'), 'height') != null) v.setAttribute('style', setPt(v.getAttribute('style'), 'height', +(h * 0.75).toFixed(2)));
    setX(isl, ser(root));
  }

  /* =====================================================================
     Menu, double-clic, aiguillage
     ===================================================================== */
  const NAMES = { chart: 'Graphique', smartart: 'SmartArt', textbox: 'Zone de texte', float: 'Image flottante', image: 'Image', ole: 'Objet incorporé', shape: 'Forme', math: 'Équation' };
  function caps(isl) {
    let root;
    try { root = parse(xOf(isl)).documentElement; } catch { return { edit: null, props: false, replace: false }; }
    const k = isl.dataset.kind;
    let edit = null;
    if (k === 'chart' && desc(root, 'c:chart').length) edit = 'Modifier les données…';
    else if (k === 'smartart' && desc(root, 'dgm:relIds').length) edit = 'Modifier le texte…';
    else if (k === 'math') edit = 'Modifier l’équation…';
    else if ((k === 'textbox' || k === 'shape') && (desc(root, 'w:txbxContent').length || desc(root, 'wps:spPr').length || vmlShapes(root).length)) edit = k === 'textbox' ? 'Modifier le texte et les couleurs…' : 'Modifier les couleurs…';
    return { edit, props: k !== 'math' && !!geometry(root).w, replace: canReplace(root) };
  }
  async function edit(isl) {
    try {
      switch (isl.dataset.kind) {
        case 'chart': return await editChart(isl);
        case 'smartart': return await editSmart(isl);
        case 'math': return await editMath(isl);
        case 'textbox': case 'shape': return await editShape(isl);
        default: return await menu(isl);
      }
    } catch (e) { fail(e); }
  }
  async function menu(isl, noEdit) {
    const c = caps(isl);
    const name = NAMES[isl.dataset.kind] || 'Élément Office';
    const btns = [];
    if (c.edit && !noEdit) btns.push({ label: c.edit, value: 'edit', primary: true });
    if (c.props) btns.push({ label: 'Propriétés…', value: 'props' });
    if (c.replace) btns.push({ label: 'Remplacer l’image…', value: 'replace' });
    btns.push({ label: 'Supprimer', value: 'del' }, { label: 'Fermer', value: null, primary: !btns.some(b => b.primary) });
    const msg = c.edit ? 'Double-cliquez sur l’élément pour le modifier directement.' : 'Plume l’affiche en aperçu et le <b>réenregistre à l’identique</b> dans le fichier .docx : il restera modifiable dans Word.';
    const r = await dialog({ title: name, body: `<p style="line-height:1.5">Cet élément Office est conservé tel quel à l’enregistrement, avec vos modifications.</p><p style="color:var(--ui-fg-2);line-height:1.5">${msg}</p>`, buttons: btns });
    try {
      if (r === 'edit') await edit(isl);
      else if (r === 'props') await properties(isl);
      else if (r === 'replace') await replaceImage(isl);
      else if (r === 'del') { before(); const h = isl.closest('.hf'); isl.remove(); if (h) Ed.onHFInput(h); Ed.changed(false); }
    } catch (e) { fail(e); }
  }
  let clickTimer = null;
  /** Clic : sélection puis menu ; double-clic : modification directe */
  function click(isl, e) {
    const h = isl.closest('.hf');
    if (h && h.contentEditable === 'false') return;   // en-tête de première page : conservé tel quel
    select(isl);
    clearTimeout(clickTimer);
    if (e && e.detail >= 2) { edit(isl); return; }
    clickTimer = setTimeout(() => menu(isl), 320);
  }
  document.addEventListener('click', e => {
    const isl = e.target.closest && e.target.closest('.hf .pl-island');
    if (isl) click(isl, e);
    else if (!(e.target.closest && e.target.closest('.pl-island'))) $$('.pl-island.il-sel').forEach(x => x.classList.remove('il-sel'));
  });

  /** Export .docx : parties propres de l'îlot (et lien du dessin SmartArt d'origine rétabli) */
  async function exportOwn(isl, z) {
    let own = ownOf(isl);
    if (isl.dataset.kind !== 'smartart' || !z) return own;
    try {
      const ri = desc(parse(xOf(isl)), 'dgm:relIds')[0];
      const dm = ri && ri.getAttribute('r:dm');
      if (!dm || (own && own.rels[dm])) return own;
      const data = await linked(isl, dm, own, z);
      if (!data || !data.xml) return own;
      const m = data.xml.match(/<(\w+:)?dataModelExt\b[^>]*\brelId="([^"]*)"/);
      const host = isl.dataset.part || 'word/document.xml';
      const r = m && (await srcRels(z, host))[m[2]];
      if (!r || r.mode === 'External' || !/diagramDrawing$/.test(r.type)) return own;
      own = own || { rels: {}, parts: {} };
      const k = newKey();
      own.parts[k] = { dir: 'word/diagrams', base: 'data', ext: 'xml', ct: CT.dgmData, xml: data.xml.replace(/(<(?:\w+:)?dataModelExt\b[^>]*\brelId=")[^"]*"/, `$1${PH_DRAWING}"`), rels: data.rels, hostRels: [{ ph: PH_DRAWING, type: r.type, src: resolve(host, r.target) }] };
      own.rels[dm] = { type: T.dgmData, part: k };
    } catch (e) { console.warn('SmartArt : dessin non relié', e); }
    return own;
  }

  // Icônes du ruban (tracés Lucide, licence ISC)
  if (window.ICONS) {
    window.ICONS['chart-column'] = '<path d="M3 3v16a2 2 0 0 0 2 2h16" /> <path d="M18 17V9" /> <path d="M13 17V5" /> <path d="M8 17v-3" />';
    window.ICONS['sigma'] = '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2" />';
  }

  return {
    click, edit, menu, properties, replaceImage, exportOwn, mathPreview, caps,
    insertChart, insertMath, applyChart, chartData, applyShape, applySmart, smartCtx, smartNodes: async isl => { const c = await smartCtx(isl); return c ? smartNodes(parse(c.data.xml)) : []; },
    applyMath, applyProps, parseLinear, linearToOmml, ommlToLinear, mathml,
    _: { readChart, writeChart, buildXlsx, fromOmml, lin, ownOf }
  };
})();
