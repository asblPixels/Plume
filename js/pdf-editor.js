/* Plume — PDF fidèle : visualisation native et édition ciblée, sans conversion HTML.
 * PDF.js conserve la représentation d'origine à l'écran. Une ouverture suivie
 * d'un enregistrement sans édition restitue exactement les octets d'entrée.
 * Annotations : objets PDF vectoriels. Modification/suppression de texte :
 * seule la page modifiée est aplatie en image pour supprimer le texte source.
 * Licence Plume inchangée ; dépendances : PDF.js (Apache-2.0), pdf-lib (MIT).
 */
'use strict';
const PdfEditor = (() => {
  let original = null, pdf = null, lib = null, edits = [], mode = 'read', pageNodes = [];
  let root = null, toolBar = null, busy = false;
  const MIME = 'application/pdf';
  const $new = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const clean = str => String(str || '').replace(/[\u0000-\u001F]/g, '').trim();
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const PDF_COLORS = {
    note: [0.06, 0.33, 0.72],
    highlight: [1, 0.83, 0.25]
  };
  function setStatus(message) {
    const el = root && root.querySelector('.pdf-status');
    if (el) el.textContent = message;
  }
  function canEdit() { return !!original && !busy; }
  async function inputText(title, initial = '') {
    const field = $new('textarea', 'pdf-input');
    field.value = initial;
    field.rows = 3;
    field.style.cssText = 'display:block;width:100%;min-width:250px;resize:vertical;font:inherit;padding:10px';
    const value = await dialog({ title, body: field, width: 480,
      buttons: [{ label:'Annuler', value:null }, { label:'Valider', value:'ok', primary:true }] });
    return value === 'ok' ? field.value : null;
  }
  async function confirmChange(title, text) {
    return await dialog({ title, body: $new('p', '', text),
      buttons: [{ label:'Annuler', value:false }, { label:'Confirmer', value:true, primary:true }] }) === true;
  }
  function selectMode(value) {
    mode = value;
    if (!toolBar) return;
    toolBar.querySelectorAll('[data-tool]').forEach(btn => {
      const selected = btn.dataset.tool === mode;
      btn.classList.toggle('on', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
    const labels = {
      read: 'Lecture : texte sélectionnable, document original inchangé.',
      note: 'Annotation : cliquez sur une page pour ajouter du texte.',
      highlight: 'Surlignage : cliquez sur un fragment de texte.',
      replace: 'Modifier : cliquez sur un fragment de texte à remplacer.',
      erase: 'Supprimer : cliquez sur le texte à retirer.'
    };
    setStatus(labels[mode]);
  }
  function bboxForItem(item, viewport) {
    const tr = lib.Util.transform(viewport.transform, item.transform);
    const size = Math.hypot(tr[2], tr[3]) || 12;
    const width = Math.max(2, (item.width || 0) * viewport.scale);
    const height = Math.max(4, (item.height || size / viewport.scale) * viewport.scale);
    return { x: tr[4], y: tr[5] - height, w: width, h: height, font: size };
  }
  async function selection(pageIndex, bbox, text) {
    if (!canEdit() || mode === 'read') return;
    const pageNode = pageNodes[pageIndex];
    if (!pageNode) return;
    const width = pageNode.viewport.width, height = pageNode.viewport.height;
    const box = {
      x: clamp(bbox.x / width, 0, 1),
      y: clamp(bbox.y / height, 0, 1),
      w: clamp(bbox.w / width, .004, 1),
      h: clamp(bbox.h / height, .004, 1),
      font: Math.max(8, bbox.font / pageNode.viewport.scale)
    };
    if (mode === 'highlight') {
      edits.push({ kind: 'highlight', page: pageIndex, ...box });
    } else if (mode === 'erase') {
      if (!await confirmChange('Supprimer du texte', 'Le texte sélectionné sera effacé lors de l’enregistrement. La page concernée deviendra une image non sélectionnable. Ne pas utiliser pour masquer des données sensibles sans vérification.')) return;
      edits.push({ kind: 'redact', page: pageIndex, ...box, value: '' });
    } else if (mode === 'replace') {
      const value = await inputText('Modifier le texte du PDF (vide = supprimer)', text);
      if (value === null || value === text) return;
      edits.push({ kind: 'redact', page: pageIndex, ...box, value: clean(value) });
    } else if (mode === 'note') {
      const value = await inputText('Ajouter une annotation');
      if (value === null || !clean(value)) return;
      edits.push({ kind: 'note', page: pageIndex, ...box, value: clean(value) });
    }
    showEdits(pageIndex);
    markChanged();
  }
  function markChanged() {
    if (typeof App !== 'undefined') {
      App.dirty = edits.length > 0;
      App.setSaveState(App.dirty ? 'PDF modifié' : 'PDF original');
    }
    setStatus(edits.length + ' modification(s) non enregistrée(s). Ctrl+S pour enregistrer en PDF.');
  }
  function placePreview(layer, item, view) {
    const box = $new('div', 'pdf-edit-preview ' + item.kind);
    box.style.left = (item.x * 100) + '%';
    box.style.top = (item.y * 100) + '%';
    box.style.width = (item.w * 100) + '%';
    box.style.minHeight = (item.h * 100) + '%';
    if (item.kind === 'note' || (item.kind === 'redact' && item.value)) {
      box.textContent = item.value;
      box.style.fontSize = Math.max(9, item.font * view.scale) + 'px';
    }
    box.title = 'Double-cliquez pour retirer cette modification.';
    box.addEventListener('dblclick', async event => {
      event.stopPropagation();
      if (!await confirmChange('Annuler cette modification', 'Retirer cette modification du PDF en cours ?')) return;
      edits.splice(edits.indexOf(item), 1);
      showEdits(item.page);
      markChanged();
    });
    layer.append(box);
  }
  function showEdits(index) {
    const node = pageNodes[index];
    if (!node) return;
    node.preview.replaceChildren();
    edits.filter(x => x.page === index).forEach(item => placePreview(node.preview, item, node.viewport));
  }
  async function pageClick(event, pageIndex) {
    if (mode !== 'note' || !canEdit() || event.target.closest('.pdf-edit-preview')) return;
    const node = pageNodes[pageIndex];
    const rect = node.frame.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, .98);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, .98);
    const value = await inputText('Ajouter une annotation');
    if (value === null || !clean(value)) return;
    edits.push({ kind: 'note', page: pageIndex, x, y, w: .25, h: .03, font: 12, value: clean(value) });
    showEdits(pageIndex);
    markChanged();
  }
  async function renderPage(index, page, wrap) {
    const viewport = page.getViewport({ scale: 1.3 });
    const frame = $new('section', 'pdf-page');
    frame.setAttribute('aria-label', 'Page ' + (index + 1));
    frame.style.width = viewport.width + 'px';
    frame.style.height = viewport.height + 'px';
    const canvas = $new('canvas', 'pdf-original-canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    frame.append(canvas);
    const context = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: context, canvas, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }).promise;
    const textLayer = $new('div', 'pdf-text-hitboxes');
    const preview = $new('div', 'pdf-preview-layer');
    frame.append(textLayer, preview);
    // Les annotations vectorielles seraient décalées sur les pages tournées
    // ou dont la boîte de découpe ne commence pas à zéro. Leur export
    // utilise alors le rendu PDF natif de cette seule page.
    const view = page.view || [0, 0];
    const needsFlatten = (viewport.rotation % 360 !== 0) || view[0] !== 0 || view[1] !== 0;
    pageNodes[index] = { frame, page, viewport, preview, needsFlatten };
    try {
      const text = await page.getTextContent();
      for (const item of text.items) {
        if (!item.str || !item.str.trim()) continue;
        const box = bboxForItem(item, viewport);
        const span = $new('span', 'pdf-selectable-text', item.str);
        span.style.left = box.x + 'px';
        span.style.top = box.y + 'px';
        span.style.width = box.w + 'px';
        span.style.height = box.h + 'px';
        span.style.fontSize = box.font + 'px';
        span.style.lineHeight = box.h + 'px';
        span.addEventListener('click', event => {
          if (mode === 'read') return;
          event.preventDefault(); event.stopPropagation();
          selection(index, box, item.str);
        });
        textLayer.append(span);
      }
    } catch (err) {
      console.warn('PDF : couche de sélection indisponible sur cette page', err);
    }
    frame.addEventListener('click', event => pageClick(event, index));
    wrap.append(frame);
  }
  async function open(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    // PDF.js peut transférer son Uint8Array au worker ; conserver une copie intacte.
    const candidate = new Uint8Array(bytes);
    const moduleUrl = new URL('vendor/pdfjs/pdf.min.mjs', document.baseURI).href;
    lib = lib || await import(moduleUrl);
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', document.baseURI).href;
    const opened = await lib.getDocument({ data: new Uint8Array(candidate), isEvalSupported: false, enableXfa: true }).promise;
    close();
    original = candidate;
    pdf = opened; edits = []; pageNodes = []; mode = 'read';
    root = $new('div', 'pdf-workspace');
    toolBar = $new('div', 'pdf-tools');
    toolBar.setAttribute('role', 'toolbar');
    toolBar.setAttribute('aria-label', 'Outils de modification PDF');
    const tools = [['read','Lire'],['note','Annoter'],['highlight','Surligner'],['replace','Modifier le texte'],['erase','Supprimer du texte']];
    for (const [tool, label] of tools) {
      const btn = $new('button', 'pdf-tool', label);
      btn.type = 'button'; btn.dataset.tool = tool;
      btn.addEventListener('click', () => selectMode(tool));
      toolBar.append(btn);
    }
    const open = $new('button', 'pdf-tool', 'Ouvrir un autre document');
    open.addEventListener('click', () => App.openPicker());
    const create = $new('button', 'pdf-tool', 'Nouveau document');
    create.addEventListener('click', () => App.newDoc('blank'));
    toolBar.append(open, create);
    const undo = $new('button', 'pdf-tool', 'Annuler le dernier changement');
    undo.addEventListener('click', () => {
      if (!edits.length) return;
      const last = edits.pop();
      showEdits(last.page);
      markChanged();
    });
    const save = $new('button', 'pdf-tool pdf-save', 'Enregistrer le PDF');
    save.addEventListener('click', () => App.save());
    toolBar.append(undo, save);
    const status = $new('div', 'pdf-status', 'Document original, sans simplification. Sélectionnez du texte ou utilisez les outils.');
    status.setAttribute('role', 'status');
    const pages = $new('div', 'pdf-pages');
    root.append(toolBar, status, pages);
    document.querySelector('#main').append(root);
    document.body.classList.add('pdf-mode');
    selectMode('read');
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1);
      await renderPage(index, page, pages);
    }
    setStatus(pdf.numPages + ' page(s) PDF chargée(s) sans reconstitution de mise en page.');
  }
  function close() {
    if (pdf) try { pdf.destroy(); } catch { /* document déjà fermé */ }
    if (root) root.remove();
    document.body.classList.remove('pdf-mode');
    original = null; pdf = null; edits = []; pageNodes = []; root = null; toolBar = null; busy = false;
  }
  function pageXY(edit, width, height) {
    return {
      x: edit.x * width,
      y: height - (edit.y + edit.h) * height,
      w: edit.w * width,
      h: edit.h * height
    };
  }
  function applyVector(page, note, font) {
    const { rgb } = window.PDFLib;
    const { width, height } = page.getSize();
    const r = pageXY(note, width, height);
    if (note.kind === 'highlight') {
      page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h,
        color: rgb(...PDF_COLORS.highlight), opacity: .32, borderWidth: 0 });
    } else if (note.kind === 'note') {
      const fontSize = clamp(note.font, 6, 36);
      page.drawText(note.value, { x: r.x, y: r.y, font, size: fontSize,
        maxWidth: Math.max(30, width - r.x - 8), lineHeight: fontSize * 1.2,
        color: rgb(...PDF_COLORS.note) });
    }
  }
  function canvasText(ctx, value, x, y, size, maxWidth) {
    ctx.font = Math.max(9, size) + 'px sans-serif';
    ctx.textBaseline = 'top';
    const lines = String(value).split('\\n');
    let lineY = y;
    for (const line of lines) {
      const words = line.split(/\\s+/);
      let current = '';
      for (const word of words) {
        const joined = current ? current + ' ' + word : word;
        if (current && ctx.measureText && ctx.measureText(joined).width > maxWidth) {
          ctx.fillText(current, x, lineY); lineY += size * 1.25; current = word;
        } else current = joined;
      }
      ctx.fillText(current, x, lineY, maxWidth);
      lineY += size * 1.25;
    }
  }
  function supportsFont(font, value) {
    try { font.encodeText(value); return true; } catch { return false; }
  }
  // Page modifiée : son contenu est reconstruit visuellement, sans texte source
  // caché dessous. Les autres pages restent des pages PDF natives.
  async function flattenedPage(doc, index, sourcePage, changes) {
    const view = sourcePage.getViewport({ scale: 3 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(view.width));
    canvas.height = Math.max(1, Math.round(view.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    await sourcePage.render({ canvasContext: ctx, canvas, viewport: view }).promise;
    for (const item of changes) {
      const x = item.x * canvas.width, y = item.y * canvas.height;
      const w = item.w * canvas.width, h = item.h * canvas.height;
      if (item.kind === 'redact') {
        // Opaque, pas une simple annotation masquant le texte d'origine.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
        if (item.value) {
          ctx.fillStyle = '#111111';
          canvasText(ctx, item.value, x, y, item.font * view.scale, Math.max(1, canvas.width - x - 5));
        }
      } else if (item.kind === 'highlight') {
        ctx.fillStyle = 'rgba(255,211,64,.32)';
        ctx.fillRect(x,y,w,h);
      } else if (item.kind === 'note') {
        ctx.fillStyle = '#1155b8';
        canvasText(ctx, item.value, x, y, item.font * view.scale, Math.max(1, canvas.width - x - 5));
      }
    }
    const png = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Impossible de rasteriser la page PDF')), 'image/png'));
    const image = await doc.embedPng(await png.arrayBuffer());
    const originalSize = sourcePage.getViewport({ scale: 1 });
    const page = doc.addPage([originalSize.width, originalSize.height]);
    page.drawImage(image, { x: 0, y: 0, width: originalSize.width, height: originalSize.height });
    return page;
  }
  async function exportPdf() {
    if (!canEdit()) throw new Error('Aucun PDF ouvert');
    if (!edits.length) return new Blob([original], { type: MIME });
    if (!window.PDFLib || !window.PDFLib.PDFDocument) {
      const e = new Error('pdf-lib non disponible');
      e.userMessage = 'Le module d’édition PDF hors ligne est absent. Le document original n’a pas été modifié.';
      throw e;
    }
    busy = true;
    try {
      const { PDFDocument, StandardFonts } = window.PDFLib;
      const source = await PDFDocument.load(original, { ignoreEncryption: false });
      const probeFont = await source.embedFont(StandardFonts.Helvetica);
      const mustFlatten = edits.some(x => x.kind === 'redact' ||
        (x.kind === 'note' && !supportsFont(probeFont, x.value)) ||
        (pageNodes[x.page] && pageNodes[x.page].needsFlatten));
      let result;
      if (!mustFlatten) {
        // Conserve les pages, polices, images et dessins existants ; ajoute
        // seulement les annotations vectorielles sélectionnées.
        result = source;
        const font = await result.embedFont(StandardFonts.Helvetica);
        edits.forEach(e => applyVector(result.getPage(e.page), e, font));
      } else {
        // Une vraie suppression ne peut pas consister à peindre un rectangle
        // blanc par-dessus le texte : il resterait extractible. On remplace
        // uniquement la page concernée par son rendu corrigé.
        result = await PDFDocument.create();
        const font = await result.embedFont(StandardFonts.Helvetica);
        for (let i = 0; i < pdf.numPages; i++) {
          const here = edits.filter(x => x.page === i);
          if (here.some(x => x.kind === 'redact' ||
            (x.kind === 'note' && !supportsFont(probeFont, x.value)) ||
            (pageNodes[x.page] && pageNodes[x.page].needsFlatten))) {
            await flattenedPage(result, i, await pdf.getPage(i + 1), here);
          } else {
            const [copied] = await result.copyPages(source, [i]);
            const page = result.addPage(copied);
            here.forEach(e => applyVector(page, e, font));
          }
        }
      }
      const bytes = await result.save();
      return new Blob([bytes], { type: MIME });
    } finally {
      busy = false;
    }
  }
  return { open, close, exportPdf, get active() { return !!original; }, get edited() { return edits.length > 0; } };
})();
