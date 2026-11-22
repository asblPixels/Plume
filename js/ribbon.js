/* =====================================================================
   Plume — ruban, commandes, menus, mini barre
   ===================================================================== */
'use strict';

const SCHOOL_FONTS = [['Playwrite FR Moderne', 'cursive scolaire'], ['Playwrite FR Trad', 'cursive traditionnelle'], ['Andika', 'lecture débutante'], ['OpenDyslexic', 'dyslexie'], ['Comic Neue', 'manuscrite simple'], ['Atkinson Hyperlegible', 'malvoyance'], ['Lexend', 'lisibilité']];
const FONTS = ['Calibri', 'Aptos', 'Arial', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Segoe UI', 'Trebuchet MS', 'Tahoma', 'Garamond', 'Courier New', 'Consolas', 'Comic Sans MS', 'Liberation Sans', 'Liberation Serif', 'DejaVu Sans', 'Noto Sans', 'Open Sans', 'Roboto'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const PALETTE = ['#000000', '#262626', '#595959', '#7F7F7F', '#A6A6A6', '#D9D9D9', '#FFFFFF', '#0B7A64', '#26EFC5', '#C7F9EC',
  '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0',
  '#F4B183', '#F8CBAD', '#FFE699', '#E2F0D9', '#DDEBF7', '#BDD7EE', '#D9D2E9', '#FCE4D6', '#EDEDED', '#FFF2CC'];
const HIGHLIGHTS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0', '#000000'];

/* ---------- Registre des commandes (aussi utilisé par la recherche Alt+Q) ---------- */
const CMD = {};
function cmd(id, label, icon, run, extra = {}) { CMD[id] = { id, label, icon, run, ...extra }; }

function registerCommands() {
  const E = Ed;
  cmd('undo', 'Annuler', 'undo-2', () => E.undo(), { kbd: 'Ctrl+Z' });
  cmd('redo', 'Rétablir', 'redo-2', () => E.redo(), { kbd: 'Ctrl+Y' });
  cmd('save', 'Enregistrer', 'save', () => App.save(), { kbd: 'Ctrl+S' });
  cmd('saveAs', 'Enregistrer sous…', 'download', () => App.save(true), { kbd: 'F12' });
  cmd('new', 'Nouveau document', 'file-plus', () => App.newDoc(), { kbd: 'Ctrl+N' });
  cmd('open', 'Ouvrir…', 'folder-open', () => App.openPicker(), { kbd: 'Ctrl+O' });
  cmd('print', 'Imprimer', 'printer', () => App.print(), { kbd: 'Ctrl+P' });
  cmd('exportPdf', 'Exporter en PDF', 'file-down', () => App.saveAs('pdf'), { kbd: 'Ctrl+Maj+P' });
  cmd('paste', 'Coller', 'clipboard-paste', async () => {
    try { const t = await navigator.clipboard.readText(); E.insertText(t); }
    catch { toast('Utilisez <b>Ctrl+V</b> pour coller (le navigateur bloque l’accès au presse-papiers).'); }
  }, { kbd: 'Ctrl+V' });
  cmd('cut', 'Couper', 'scissors', () => { E.focus(); if (!document.execCommand('cut')) toast('Utilisez <b>Ctrl+X</b>'); E.afterCmd(); }, { kbd: 'Ctrl+X' });
  cmd('copy', 'Copier', 'copy', () => { E.focus(); if (!document.execCommand('copy')) toast('Utilisez <b>Ctrl+C</b>'); }, { kbd: 'Ctrl+C' });
  cmd('painter', 'Reproduire la mise en forme', 'paintbrush', () => Painter.start());
  cmd('bold', 'Gras', 'bold', () => E.exec('bold'), { kbd: 'Ctrl+B', state: 'bold' });
  cmd('italic', 'Italique', 'italic', () => E.exec('italic'), { kbd: 'Ctrl+I', state: 'italic' });
  cmd('underline', 'Souligné', 'underline', () => E.exec('underline'), { kbd: 'Ctrl+U', state: 'underline' });
  cmd('strike', 'Barré', 'strikethrough', () => E.exec('strikeThrough'), { state: 'strikeThrough' });
  cmd('sub', 'Indice', 'subscript', () => E.exec('subscript'), { kbd: 'Ctrl+=', state: 'subscript' });
  cmd('sup', 'Exposant', 'superscript', () => E.exec('superscript'), { kbd: 'Ctrl+Maj+=', state: 'superscript' });
  cmd('grow', 'Augmenter la taille de police', 'a-arrow-up', () => E.growFont(1), { kbd: 'Ctrl+>' });
  cmd('shrink', 'Réduire la taille de police', 'a-arrow-down', () => E.growFont(-1), { kbd: 'Ctrl+<' });
  cmd('clear', 'Effacer toute la mise en forme', 'remove-formatting', () => E.clearFormatting(), { kbd: 'Ctrl+Espace' });
  cmd('color', 'Couleur de police', 'baseline', c => E.exec('foreColor', c || Ribbon.lastColor));
  cmd('highlight', 'Couleur de surlignage', 'highlighter', c => E.exec('hiliteColor', c === undefined ? Ribbon.lastHl : (c || 'transparent')));
  cmd('bullets', 'Puces', 'list', t => E.list('ul', t), { state: 'insertUnorderedList' });
  cmd('numbers', 'Numérotation', 'list-ordered', t => E.list('ol', t), { state: 'insertOrderedList' });
  cmd('indent', 'Augmenter le retrait', 'indent-increase', () => E.indent(1));
  cmd('outdent', 'Diminuer le retrait', 'indent-decrease', () => E.indent(-1));
  cmd('left', 'Aligner à gauche', 'align-left', () => E.align('left'), { kbd: 'Ctrl+L', align: 'left' });
  cmd('center', 'Centrer', 'align-center', () => E.align('center'), { kbd: 'Ctrl+E', align: 'center' });
  cmd('right', 'Aligner à droite', 'align-right', () => E.align('right'), { kbd: 'Ctrl+R', align: 'right' });
  cmd('justify', 'Justifier', 'align-justify', () => E.align('justify'), { kbd: 'Ctrl+J', align: 'justify' });
  cmd('marks', 'Afficher tout (¶)', 'pilcrow', () => { document.body.classList.toggle('show-marks'); Ribbon.refresh(); }, { kbd: 'Ctrl+*' });
  cmd('find', 'Rechercher', 'search', () => App.openNav('results'), { kbd: 'Ctrl+F' });
  cmd('replace', 'Remplacer', 'replace', () => Dialogs.replace(), { kbd: 'Ctrl+H' });
  cmd('selectAll', 'Sélectionner tout', 'text-select', () => { E.editor.focus(); document.execCommand('selectAll'); }, { kbd: 'Ctrl+A' });
  cmd('fontDlg', 'Police…', 'type', () => Dialogs.font(), { kbd: 'Ctrl+D' });
  cmd('paraDlg', 'Paragraphe…', 'pilcrow', () => Dialogs.paragraph());
  // Insertion
  cmd('cover', 'Page de garde', 'file', () => App.insertCover());
  cmd('blankPage', 'Page vierge', 'file-plus', () => { E.pageBreak(); E.pageBreak(); });
  cmd('pageBreak', 'Saut de page', 'separator-horizontal', () => E.pageBreak(), { kbd: 'Ctrl+Entrée' });
  cmd('table', 'Tableau', 'table', () => Dialogs.table());
  cmd('image', 'Images', 'image', () => App.pickImage());
  cmd('link', 'Lien', 'link', () => Dialogs.link(), { kbd: 'Ctrl+K' });
  cmd('bookmark', 'Signet', 'hash', () => Dialogs.bookmark());
  cmd('textbox', 'Zone de texte', 'square-pen', () => E.insertHTML('<div class="pl-textbox"><p>Zone de texte</p></div><p><br></p>'));
  cmd('hr', 'Ligne horizontale', 'minus', () => E.insertHTML('<hr class="pl-line"><p><br></p>'));
  cmd('header', 'En-tête', 'panel-top', () => App.editHF('header'));
  cmd('footer', 'Pied de page', 'panel-bottom', () => App.editHF('footer'));
  cmd('pageNum', 'Numéro de page', 'hash', () => App.pageNumber());
  cmd('date', 'Date et heure', 'calendar', () => Dialogs.date());
  cmd('symbol', 'Symbole', 'omega', () => {});
  cmd('chart', 'Graphique', 'chart-column', () => Ilots.insertChart());
  cmd('equation', 'Équation', 'sigma', () => Ilots.insertMath());
  // Création
  cmd('docFont', 'Police du document', 'type', f => { const fn = f || 'Calibri'; Ed.settings.fontCss = DocxImport.cssFont(fn); Ed.applySettings(); Ed.changed(false); });
  cmd('docSpacing', 'Espacement des paragraphes', 'list-collapse', v => { Object.assign(Ed.settings, v); Ed.applySettings(); Ed.changed(false); });
  cmd('docHeading', 'Couleur des titres', 'heading', c => { Ed.settings.heading = c; Ed.applySettings(); Ed.changed(false); });
  cmd('pageDark', 'Page sombre (affichage)', 'moon', () => { document.documentElement.classList.toggle('page-dark'); Ribbon.refresh(); });
  // Mise en page
  cmd('margins', 'Marges', 'frame', m => App.setMargins(m));
  cmd('orientation', 'Orientation', 'rectangle-vertical', o => App.setOrientation(o));
  cmd('size', 'Taille', 'file', s => App.setSize(s));
  cmd('pageSetup', 'Mise en page…', 'frame', () => Dialogs.pageSetup());
  // Références
  cmd('toc', 'Table des matières', 'list-tree', () => E.insertToc());
  cmd('footnote', 'Insérer une note de bas de page', 'superscript', () => E.insertFootnote(), { kbd: 'Ctrl+Alt+F' });
  // Révision
  cmd('spell', 'Orthographe', 'spell-check', () => { E.editor.spellcheck = !E.editor.spellcheck; toast('Vérification orthographique ' + (E.editor.spellcheck ? '<b>activée</b>' : '<b>désactivée</b>')); Ribbon.refresh(); });
  cmd('language', 'Langue', 'type', l => App.setLang(l));
  cmd('wordCount', 'Statistiques', 'hash', () => Dialogs.stats());
  cmd('speak', 'Lecture à voix haute', 'volume-2', () => App.speak());
  cmd('comment', 'Nouveau commentaire', 'message-square-plus', () => Comments.add(), { kbd: 'Ctrl+Alt+M' });
  cmd('showComments', 'Afficher les commentaires', 'messages-square', () => App.openNav('comments'));
  cmd('delComments', 'Supprimer tous les commentaires', 'trash-2', () => Comments.removeAll());
  cmd('acceptAll', 'Accepter toutes les modifications', 'check', () => Revisions.apply(true));
  cmd('rejectAll', 'Refuser toutes les modifications', 'x', () => Revisions.apply(false));
  cmd('track', 'Suivi des modifications', 'square-pen', () => Track.toggle(), { kbd: 'Ctrl+Maj+E' });
  cmd('protect', 'Restreindre la modification', 'lock', () => Protect.toggle());
  cmd('autocorrect', 'Correction automatique', 'spell-check', () => AutoCorrect.toggle());
  cmd('dictate', 'Dicter', 'mic', () => Dictation.toggle());
  cmd('addFont', 'Ajouter une police', 'type', () => CustomFonts.add());
  cmd('myFonts', 'Mes polices', 'type', () => CustomFonts.manage());
  cmd('caption', 'Insérer une légende', 'text-quote', () => Captions.insert());
  cmd('watermark', 'Filigrane', 'droplet', () => Watermark.set());
  cmd('mergeRecipients', 'Destinataires', 'users', () => Merge.pickRecipients());
  cmd('mergeField', 'Insérer un champ', 'braces', () => {});
  cmd('mergePreview', 'Aperçu', 'eye', () => Merge.togglePreview());
  cmd('mergePrev', 'Destinataire précédent', 'chevron-left', () => Merge.move(-1));
  cmd('mergeNext', 'Destinataire suivant', 'chevron-right', () => Merge.move(1));
  cmd('mergeFinish', 'Fusionner', 'files', () => Merge.finish());
  cmd('finalView', 'Affichage « Final » (masquer les marques)', 'eye', () => { document.body.classList.toggle('final-view'); Ribbon.refresh(); });
  // Affichage
  cmd('reading', 'Mode Lecture', 'book-open', () => App.setReading(true));
  cmd('ruler', 'Règle', 'ruler', () => { document.body.classList.toggle('no-ruler'); Ribbon.refresh(); App.drawRuler(); });
  cmd('nav', 'Volet de navigation', 'panel-left', () => App.toggleNav());
  cmd('zoom100', 'Zoom 100 %', 'zoom-in', () => App.setZoom(1));
  cmd('onePage', 'Une page', 'file-text', () => App.fitPage());
  cmd('pageWidth', 'Largeur de la page', 'columns-2', () => App.fitWidth());
  cmd('dark', 'Thème sombre', 'moon', () => App.toggleTheme());
  cmd('fullscreen', 'Plein écran', 'maximize', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { }), { kbd: 'F11' });
  // Tableau
  cmd('rowAbove', 'Insérer au-dessus', 'between-horizontal-start', () => E.tableOp('rowAbove'));
  cmd('rowBelow', 'Insérer en dessous', 'between-horizontal-start', () => E.tableOp('rowBelow'));
  cmd('colLeft', 'Insérer à gauche', 'between-vertical-start', () => E.tableOp('colLeft'));
  cmd('colRight', 'Insérer à droite', 'between-vertical-start', () => E.tableOp('colRight'));
  cmd('delRow', 'Supprimer la ligne', 'trash-2', () => E.tableOp('delRow'));
  cmd('delCol', 'Supprimer la colonne', 'trash-2', () => E.tableOp('delCol'));
  cmd('delTable', 'Supprimer le tableau', 'trash-2', () => E.tableOp('delTable'));
  cmd('merge', 'Fusionner avec la cellule de droite', 'table-columns-split', () => E.tableOp('mergeRight'));
  cmd('split', 'Fractionner la cellule', 'table-columns-split', () => E.tableOp('split'));
  cmd('tBorders', 'Bordures du tableau', 'table', () => E.tableOp('borders'));
  cmd('tHeader', 'Ligne d’en-tête répétée', 'table-rows-split', () => E.tableOp('header'));
  cmd('distribute', 'Uniformiser les colonnes', 'columns-2', () => E.tableOp('distribute'));
  cmd('shade', 'Trame de fond', 'paintbrush', c => E.cellShade(c));
  // Aide
  cmd('guide', 'Bien démarrer', 'book-open', () => Guide.open());
  cmd('shortcuts', 'Raccourcis clavier', 'keyboard', () => Dialogs.shortcuts());
  cmd('about', 'À propos de Plume', 'info', () => App.openBackstage('about'));
  // Styles
  const ST = [['p', 'Normal'], ['h1', 'Titre 1', 'Ctrl+Alt+1'], ['h2', 'Titre 2', 'Ctrl+Alt+2'], ['h3', 'Titre 3', 'Ctrl+Alt+3'], ['h1.title', 'Titre'], ['p.subtitle', 'Sous-titre'], ['blockquote', 'Citation'], ['pre', 'Code']];
  ST.forEach(([k, l, kb]) => cmd('style:' + k, 'Style ' + l, 'heading', () => { const [t, c] = k.split('.'); E.setStyle(t, c || ''); }, { kbd: kb }));
  Ribbon.STYLES = ST;
}

/* ---------- Construction du ruban ---------- */
const Ribbon = {
  lastColor: '#C00000', lastHl: '#FFFF00',
  tabs: [],

  build() {
    registerCommands();
    const T = (id, label, groups, extra = {}) => ({ id, label, groups, ...extra });
    const G = (label, items, launcher) => ({ label, items, launcher });
    this.tabs = [
      T('accueil', 'Accueil', [
        G('Presse-papiers', [{ big: 'paste' }, { col: ['cut', 'copy', 'painter'] }]),
        G('Police', [{ col: [{ row: ['#fontFamily', '#fontSize', 'grow', 'shrink', '#case', 'clear'] }, { row: ['bold', 'italic', 'underline', 'strike', 'sub', 'sup', '#color', '#highlight'] }] }], 'fontDlg'),
        G('Paragraphe', [{ col: [{ row: ['#bullets', '#numbers', 'outdent', 'indent', 'marks'] }, { row: ['left', 'center', 'right', 'justify', '#spacing'] }] }], 'paraDlg'),
        G('Styles', [{ custom: 'gallery' }]),
        G('Modification', [{ col: ['find', 'replace', 'selectAll'] }]),
        G('Voix', [{ big: 'dictate' }])
      ]),
      T('insertion', 'Insertion', [
        G('Pages', [{ col: ['cover', 'blankPage', 'pageBreak'] }]),
        G('Tableaux', [{ bigMenu: 'table', menu: 'tableGrid' }]),
        G('Illustrations', [{ big: 'image' }, { big: 'chart' }]),
        G('Liens', [{ big: 'link' }, { col: ['bookmark'] }]),
        G('En-tête et pied', [{ col: ['header', 'footer', 'pageNum'] }]),
        G('Texte', [{ col: ['textbox', 'hr', 'date'] }]),
        G('Symboles', [{ big: 'equation' }, { bigMenu: 'symbol', menu: 'symbols' }])
      ]),
      T('creation', 'Création', [
        G('Mise en forme du document', [{ bigMenu: 'docFont', menu: 'docFonts' }, { bigMenu: 'docSpacing', menu: 'docSpacings' }, { bigMenu: 'docHeading', menu: 'headingColors' }]),
        G('Polices', [{ big: 'addFont' }, { col: ['myFonts'] }]),
        G('Arrière-plan', [{ big: 'watermark' }, { big: 'pageDark' }])
      ]),
      T('miseenpage', 'Mise en page', [
        G('Mise en page', [{ bigMenu: 'margins', menu: 'margins' }, { bigMenu: 'orientation', menu: 'orient' }, { bigMenu: 'size', menu: 'sizes' }, { col: ['pageBreak'] }], 'pageSetup'),
        G('Paragraphe', [{ custom: 'paraFields' }], 'paraDlg')
      ]),
      T('references', 'Références', [
        G('Table des matières', [{ big: 'toc' }]),
        G('Notes de bas de page', [{ big: 'footnote' }]),
        G('Légendes', [{ big: 'caption' }])
      ]),
      T('publipostage', 'Publipostage', [
        G('Démarrer', [{ big: 'mergeRecipients' }]),
        G('Champs', [{ bigMenu: 'mergeField', menu: 'mergeFields' }]),
        G('Aperçu', [{ big: 'mergePreview' }, { col: ['mergePrev', 'mergeNext'] }]),
        G('Terminer', [{ big: 'mergeFinish' }])
      ]),
      T('revision', 'Révision', [
        G('Vérification', [{ big: 'spell' }, { col: ['wordCount', 'autocorrect'] }]),
        G('Commentaires', [{ big: 'comment' }, { col: ['showComments', 'delComments'] }]),
        G('Suivi', [{ big: 'track' }, { big: 'acceptAll' }, { col: ['rejectAll', 'finalView'] }]),
        G('Protéger', [{ big: 'protect' }]),
        G('Voix', [{ big: 'speak' }]),
        G('Langue', [{ bigMenu: 'language', menu: 'langs' }])
      ]),
      T('affichage', 'Affichage', [
        G('Affichages', [{ big: 'reading' }, { col: ['fullscreen'] }]),
        G('Afficher', [{ col: ['ruler', 'nav', 'marks'] }]),
        G('Zoom', [{ big: 'zoom100' }, { col: ['onePage', 'pageWidth'] }]),
        G('Apparence', [{ big: 'dark' }, { col: ['pageDark'] }])
      ]),
      T('aide', 'Aide', [G('Aide', [{ big: 'guide' }, { big: 'shortcuts' }, { big: 'about' }])]),
      T('tableau', 'Tableau', [
        G('Lignes et colonnes', [{ col: ['rowAbove', 'rowBelow'] }, { col: ['colLeft', 'colRight'] }, { col: ['delRow', 'delCol', 'delTable'] }]),
        G('Fusionner', [{ col: ['merge', 'split', 'distribute'] }]),
        G('Style', [{ big: 'tBorders' }, { bigMenu: 'shade', menu: 'shades' }, { col: ['tHeader'] }])
      ], { contextual: true })
    ];

    const bar = $('#tabbar'), rib = $('#ribbon');
    bar.append(el('button', { class: 'tab file', onclick: () => App.openBackstage() }, ['Fichier']));
    for (const t of this.tabs) {
      bar.append(el('button', { class: 'tab' + (t.contextual ? ' contextual' : ''), 'data-tab': t.id, role: 'tab', style: t.contextual ? 'display:none' : null, onclick: () => this.select(t.id) }, [t.label]));
      const panel = el('div', { class: 'rpanel', 'data-panel': t.id });
      for (const g of t.groups) {
        const body = el('div', { class: 'rgroup-body' }, g.items.map(it => this.item(it)));
        const grp = el('div', { class: 'rgroup' }, [body, el('div', { class: 'rgroup-label' }, [g.label])]);
        if (g.launcher) grp.append(el('button', { class: 'launcher', title: CMD[g.launcher].label, onmousedown: e => e.preventDefault(), onclick: () => CMD[g.launcher].run() }, [icon('arrow-left', '')]));
        panel.append(grp);
      }
      rib.append(panel);
    }
    $$('.launcher .ic').forEach(i => { i.style.transform = 'rotate(-135deg)'; });
    bar.append(el('span', { class: 'tab-spacer' }), el('button', { id: 'ribbonToggle', title: 'Réduire le ruban (Ctrl+F1)', onclick: () => document.body.classList.toggle('ribbon-collapsed') }, [icon('chevron-down')]));
    $('#ribbonToggle .ic').style.transform = 'rotate(180deg)';
    // Barre d'accès rapide
    const qat = $('#qat');
    for (const id of ['save', 'exportPdf', 'undo', 'redo']) qat.append(el('button', { title: `${CMD[id].label} (${CMD[id].kbd})`, 'data-cmd': id, onmousedown: e => e.preventDefault(), onclick: () => CMD[id].run() }, [icon(CMD[id].icon)]));
    this.select('accueil');
    // Garder la sélection du document lors des clics dans le ruban
    rib.addEventListener('mousedown', e => { if (!e.target.closest('input,select')) e.preventDefault(); });
  },

  select(id) {
    this.current = id;
    $$('#tabbar .tab[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    $$('#ribbon .rpanel').forEach(p => p.classList.toggle('active', p.dataset.panel === id));
    document.body.classList.remove('ribbon-collapsed');
  },

  btn(id, big) {
    const c = CMD[id];
    const b = el('button', { class: 'rbtn' + (big ? ' big' : ''), 'data-cmd': id, title: c.label + (c.kbd ? ` (${c.kbd})` : ''), onclick: () => c.run() }, [icon(c.icon), big ? el('span', {}, [c.label]) : null]);
    if (!big && ['cut', 'copy', 'painter', 'find', 'replace', 'selectAll', 'cover', 'blankPage', 'pageBreak', 'header', 'footer', 'pageNum', 'textbox', 'hr', 'date', 'bookmark', 'wordCount', 'fullscreen', 'ruler', 'nav', 'onePage', 'pageWidth', 'rowAbove', 'rowBelow', 'colLeft', 'colRight', 'delRow', 'delCol', 'delTable', 'merge', 'split', 'distribute', 'tHeader', 'pageDark', 'showComments', 'delComments', 'rejectAll', 'finalView', 'autocorrect', 'mergePrev', 'mergeNext', 'myFonts'].includes(id)) {
      b.append(el('span', {}, [c.label.replace(' avec la cellule de droite', '')]));
    }
    return b;
  },

  item(it) {
    if (typeof it === 'string') return it.startsWith('#') ? this.special(it.slice(1)) : this.btn(it);
    if (it.big) return this.btn(it.big, true);
    if (it.bigMenu) {
      const c = CMD[it.bigMenu];
      const b = el('button', { class: 'rbtn big', 'data-cmd': it.bigMenu, title: c.label, onclick: e => Menus.open(it.menu, b) }, [icon(c.icon), el('span', {}, [c.label, ' ▾'])]);
      return b;
    }
    if (it.col) return el('div', { class: 'rcol' }, it.col.map(x => this.item(x)));
    if (it.row) return el('div', { class: 'rrow' }, it.row.map(x => this.item(x)));
    if (it.custom === 'gallery') return this.gallery();
    if (it.custom === 'paraFields') return this.paraFields();
  },

  special(name) {
    const split = (id, menuName, cls = '') => {
      const c = CMD[id];
      const main = el('button', { class: 'rbtn ' + cls, 'data-cmd': id, title: c.label, onclick: () => c.run() }, [icon(c.icon)]);
      const arrow = el('button', { class: 'rbtn arrow', title: c.label + ' — options', onclick: () => Menus.open(menuName, arrow) }, [el('span', { class: 'caret' }, ['▾'])]);
      return el('span', { class: 'split' }, [main, arrow]);
    };
    switch (name) {
      case 'fontFamily': {
        const b = el('button', { class: 'rsel', id: 'fontFamily', title: 'Police', style: 'text-align:left;display:flex;align-items:center;justify-content:space-between', onclick: () => Menus.open('fonts', b) }, [el('span', { id: 'fontName', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, ['Calibri']), el('span', { class: 'caret' }, ['▾'])]);
        return b;
      }
      case 'fontSize': {
        const wrap = el('span', { style: 'display:inline-flex;position:relative' });
        const inp = el('input', { class: 'rsel', id: 'fontSize', value: '11', title: 'Taille de police', inputmode: 'decimal' });
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); Ed.fontSize(inp.value.replace(',', '.')); } });
        inp.addEventListener('change', () => Ed.fontSize(inp.value.replace(',', '.')));
        const arrow = el('button', { class: 'rbtn arrow', style: 'position:absolute;right:1px;top:0;min-width:16px', onclick: () => Menus.open('sizes', arrow) }, [el('span', { class: 'caret' }, ['▾'])]);
        wrap.append(inp, arrow);
        return wrap;
      }
      case 'case': { const b = el('button', { class: 'rbtn', title: 'Modifier la casse', onclick: () => Menus.open('case', b) }, [icon('case-sensitive'), el('span', { class: 'caret' }, ['▾'])]); return b; }
      case 'color': { const s = split('color', 'colors', 'color-bar'); s.firstChild.style.setProperty('--swatch', this.lastColor); s.firstChild.id = 'colorBtn'; return s; }
      case 'highlight': { const s = split('highlight', 'highlights', 'color-bar'); s.firstChild.style.setProperty('--swatch', this.lastHl); s.firstChild.id = 'hlBtn'; return s; }
      case 'bullets': return split('bullets', 'bulletTypes');
      case 'numbers': return split('numbers', 'numberTypes');
      case 'spacing': { const b = el('button', { class: 'rbtn', title: 'Interligne et espacement', onclick: () => Menus.open('lineSpacing', b) }, [icon('list-collapse'), el('span', { class: 'caret' }, ['▾'])]); return b; }
    }
  },

  gallery() {
    const g = el('div', { class: 'gallery', id: 'styleGallery' });
    const preview = {
      'p': 'font-size:12px', 'h1': 'font-size:16px;color:var(--brand-ink);font-weight:600', 'h2': 'font-size:14px;color:var(--brand-ink);font-weight:600',
      'h3': 'font-size:13px;color:var(--brand-ink);font-weight:600', 'h1.title': 'font-size:18px', 'p.subtitle': 'font-size:12px;color:#777;letter-spacing:.5px',
      'blockquote': 'font-size:12px;font-style:italic;color:#555', 'pre': 'font-size:11px;font-family:monospace'
    };
    for (const [k, l] of this.STYLES) {
      g.append(el('button', { class: 'gitem', 'data-style': k, title: 'Style ' + l, onclick: () => CMD['style:' + k].run() }, [
        el('span', { class: 'gs', style: preview[k] }, ['AaBbCc']), el('span', { class: 'gl' }, [l])]));
    }
    return g;
  },

  paraFields() {
    const f = (label, id, unit) => el('label', { style: 'display:flex;align-items:center;gap:6px;justify-content:space-between;height:26px' }, [
      el('span', { style: 'color:var(--ui-fg-2);min-width:70px' }, [label]),
      el('input', { class: 'rsel', id, type: 'number', step: id.startsWith('pf-i') ? '0.1' : '1', min: '0', style: 'width:72px' }),
      el('span', { style: 'color:var(--ui-fg-2);width:18px' }, [unit])]);
    const wrap = el('div', { style: 'display:grid;grid-template-columns:auto auto;gap:2px 18px;padding-top:2px' }, [
      el('div', { class: 'mh', style: 'font-size:11px;color:var(--ui-fg-2)' }, ['Retrait']), el('div', { class: 'mh', style: 'font-size:11px;color:var(--ui-fg-2)' }, ['Espacement']),
      f('Gauche', 'pf-il', 'cm'), f('Avant', 'pf-sb', 'pt'), f('Droite', 'pf-ir', 'cm'), f('Après', 'pf-sa', 'pt')]);
    const apply = id => {
      const v = parseFloat($('#' + id).value || '0');
      Ed.blockStyle(b => {
        if (id === 'pf-il') b.style.marginLeft = v ? (v * 28.3465).toFixed(1) + 'pt' : '';
        if (id === 'pf-ir') b.style.marginRight = v ? (v * 28.3465).toFixed(1) + 'pt' : '';
        if (id === 'pf-sb') b.style.marginTop = v + 'pt';
        if (id === 'pf-sa') b.style.marginBottom = v + 'pt';
      });
    };
    wrap.querySelectorAll('input').forEach(i => i.addEventListener('change', () => apply(i.id)));
    return wrap;
  },

  /** Met à jour l'état des boutons selon la sélection */
  refresh() {
    const qs = c => { try { return document.queryCommandState(c); } catch { return false; } };
    $$('#ribbon [data-cmd], #mini [data-cmd]').forEach(b => {
      const c = CMD[b.dataset.cmd];
      if (!c) return;
      let on = false;
      if (c.state) on = qs(c.state);
      if (c.align) { const bl = Ed.selectedBlocks()[0]; const a = bl ? getComputedStyle(bl).textAlign : 'left'; on = (a === 'start' ? 'left' : a) === c.align; }
      if (b.dataset.cmd === 'marks') on = document.body.classList.contains('show-marks');
      if (b.dataset.cmd === 'ruler') on = !document.body.classList.contains('no-ruler');
      if (b.dataset.cmd === 'nav') on = document.body.classList.contains('nav-open');
      if (b.dataset.cmd === 'spell') on = Ed.editor.spellcheck;
      if (b.dataset.cmd === 'dark') on = document.documentElement.dataset.theme === 'dark';
      if (b.dataset.cmd === 'pageDark') on = document.documentElement.classList.contains('page-dark');
      if (b.dataset.cmd === 'finalView') on = document.body.classList.contains('final-view');
      if (b.dataset.cmd === 'track') on = Track.on;
      if (b.dataset.cmd === 'protect') on = Protect.on;
      if (b.dataset.cmd === 'autocorrect') on = AutoCorrect.on;
      if (b.dataset.cmd === 'dictate') on = !!Dictation.rec;
      if (b.dataset.cmd === 'mergePreview') on = Merge.preview;
      b.classList.toggle('on', !!on);
    });
    const a = Ed.anchorEl();
    if (a && (Ed.editor.contains(a) || Ed.inHF(a))) {
      const fam = (getComputedStyle(a).fontFamily.split(',')[0] || '').replace(/["']/g, '').trim();
      $('#fontName').textContent = fam;
      const fs = $('#fontSize');
      if (document.activeElement !== fs) fs.value = String(Ed.currentFontPt()).replace('.', ',');
    }
    const key = Ed.currentStyleKey();
    $$('#styleGallery .gitem').forEach(g => g.classList.toggle('on', g.dataset.style === key));
    // onglet contextuel Tableau
    const inTable = !!Ed.cellCtx();
    const tt = $('#tabbar [data-tab="tableau"]');
    tt.style.display = inTable ? '' : 'none';
    if (!inTable && this.current === 'tableau') this.select('accueil');
    // champs Paragraphe (Mise en page)
    const bl = Ed.selectedBlocks()[0];
    if (bl && document.activeElement && !document.activeElement.id.startsWith('pf-')) {
      const cs = getComputedStyle(bl);
      $('#pf-il').value = (U.pxToCm(parseFloat(cs.marginLeft) || 0)).toFixed(1);
      $('#pf-ir').value = (U.pxToCm(parseFloat(cs.marginRight) || 0)).toFixed(1);
      $('#pf-sb').value = Math.round(U.pxToPt(parseFloat(cs.marginTop) || 0));
      $('#pf-sa').value = Math.round(U.pxToPt(parseFloat(cs.marginBottom) || 0));
    }
    $$('#qat [data-cmd="undo"]').forEach(b => b.style.opacity = Ed.canUndo() ? 1 : .45);
    $$('#qat [data-cmd="redo"]').forEach(b => b.style.opacity = Ed.canRedo() ? 1 : .45);
  }
};

/* ---------- Menus déroulants ---------- */
const Menus = {
  el: null,
  close() { if (this.el) { this.el.remove(); this.el = null; } },
  open(name, anchor) {
    if (this.el && this.el.dataset.name === name) { this.close(); return; }
    this.close();
    const m = el('div', { class: 'menu open', 'data-name': name });
    m.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
    const item = (label, fn, opts = {}) => el('button', { class: 'mi' + (opts.on ? ' on' : ''), style: opts.style || null, onclick: () => { this.close(); fn(); } }, [opts.icon ? icon(opts.icon) : null, label, opts.kbd ? el('span', { class: 'kbd' }, [opts.kbd]) : null]);
    const swatches = (list, fn, none) => {
      const g = el('div', { class: 'swatches' });
      for (const c of list) g.append(el('button', { title: c, style: { background: c }, onclick: () => { this.close(); fn(c); } }));
      m.append(g);
      if (none) m.append(item(none, () => fn(null)));
      const inp = el('input', { type: 'color', style: 'width:100%;height:28px;border:0;background:none' });
      m.append(el('hr'), el('div', { class: 'mh' }, ['Autres couleurs']), inp);
      inp.addEventListener('change', () => { this.close(); fn(inp.value); });
    };
    switch (name) {
      case 'fonts': {
        const font = (f, note) => item(note ? `${f}  ·  ${note}` : f, () => Ed.fontName(DocxImport.cssFont(f)), { style: `font-family:${DocxImport.cssFont(f)};font-size:15px` });
        const mine = CustomFonts.list();
        if (mine.length) { m.append(el('div', { class: 'mh' }, ['Mes polices'])); mine.forEach(f => m.append(font(f))); }
        m.append(el('div', { class: 'mh' }, ['Polices scolaires et accessibilité']));
        SCHOOL_FONTS.forEach(([f, n]) => m.append(font(f, n)));
        m.append(el('div', { class: 'mh' }, ['Polices']));
        FONTS.forEach(f => m.append(font(f)));
        m.append(el('hr'), item('Ajouter une police (.ttf, .otf, .woff)…', () => CustomFonts.add(), { icon: 'plus' }));
        if (mine.length) m.append(item('Gérer mes polices…', () => CustomFonts.manage(), { icon: 'type' }));
        break;
      }
      case 'sizes': SIZES.forEach(s => m.append(item(String(s).replace('.', ','), () => Ed.fontSize(s)))); break;
      case 'case':
        [['Majuscule en début de phrase.', 'sentence'], ['minuscules', 'lower'], ['MAJUSCULES', 'upper'], ['Mettre En Majuscules Chaque Mot', 'title'], ['iNVERSER lA cASSE', 'toggle']].forEach(([l, k]) => m.append(item(l, () => Ed.changeCase(k))));
        break;
      case 'colors':
        m.append(item('Automatique', () => CMD.color.run('#000000'), { icon: 'baseline' }));
        swatches(PALETTE, c => { Ribbon.lastColor = c; $('#colorBtn').style.setProperty('--swatch', c); CMD.color.run(c); });
        break;
      case 'highlights':
        swatches(HIGHLIGHTS, c => { if (c) { Ribbon.lastHl = c; $('#hlBtn').style.setProperty('--swatch', c); } CMD.highlight.run(c); }, 'Aucune couleur');
        break;
      case 'shades': swatches(PALETTE, c => CMD.shade.run(c), 'Aucune couleur'); break;
      case 'headingColors': swatches(PALETTE, c => CMD.docHeading.run(c || '#0B5E4E'), 'Couleur par défaut'); break;
      case 'bulletTypes':
        [['● Puce ronde', 'disc'], ['○ Puce cercle', 'circle'], ['■ Puce carrée', 'square'], ['– Tiret', '"– "']].forEach(([l, t]) => m.append(item(l, () => CMD.bullets.run(t))));
        break;
      case 'numberTypes':
        [['1. 2. 3.', 'decimal'], ['a. b. c.', 'lower-alpha'], ['A. B. C.', 'upper-alpha'], ['i. ii. iii.', 'lower-roman'], ['I. II. III.', 'upper-roman']].forEach(([l, t]) => m.append(item(l, () => CMD.numbers.run(t))));
        break;
      case 'lineSpacing':
        m.append(el('div', { class: 'mh' }, ['Interligne']));
        ['1,0', '1,15', '1,5', '2,0', '2,5', '3,0'].forEach(v => m.append(item(v, () => Ed.lineSpacing(v.replace(',', '.')))));
        m.append(el('hr'), item('Ajouter un espace avant le paragraphe', () => Ed.paraSpace('before', 12)), item('Supprimer l’espace après le paragraphe', () => Ed.paraSpace('after', 0)), item('Options d’interligne…', () => Dialogs.paragraph()));
        break;
      case 'tableGrid': {
        const tg = el('div', { class: 'tablegrid' });
        const grid = el('div', { class: 'tg' });
        const lbl = el('div', { class: 'tgl' }, ['Insérer un tableau']);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) {
          const s = el('span', { dataset: { r, c } });
          s.addEventListener('mouseenter', () => { $$('span', grid).forEach(x => x.classList.toggle('hl', +x.dataset.r <= r && +x.dataset.c <= c)); lbl.textContent = `Tableau ${c + 1} × ${r + 1}`; });
          s.addEventListener('click', () => { this.close(); Ed.insertTable(r + 1, c + 1); });
          grid.append(s);
        }
        tg.append(grid, lbl);
        m.append(tg, el('hr'), item('Insérer un tableau…', () => Dialogs.table(), { icon: 'table' }));
        break;
      }
      case 'symbols': {
        const g = el('div', { class: 'symgrid' });
        '€£$¥©®™§¶°±×÷≠≈≤≥∞√∑π∆Ωαβγµ←→↑↓↔•…«»‹›—–‘’“”✓✗★☆♥☎✉☀⚠½¼¾²³'.split('').forEach(s => g.append(el('button', { onclick: () => { this.close(); Ed.insertText(s); } }, [s])));
        m.append(g);
        break;
      }
      case 'mergeFields':
        if (!Merge.data) m.append(el('div', { class: 'mh' }, ['Choisissez d’abord les destinataires']), item('Sélectionner un fichier CSV…', () => Merge.pickRecipients(), { icon: 'users' }));
        else Merge.data.cols.forEach(c => m.append(item('«' + c + '»', () => Merge.insertField(c))));
        break;
      case 'docFonts': [...CustomFonts.list(), ...SCHOOL_FONTS.map(x => x[0]), 'Calibri', 'Aptos', 'Arial', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Segoe UI', 'Garamond'].forEach(f => m.append(item(f, () => CMD.docFont.run(f), { style: `font-family:${DocxImport.cssFont(f)};font-size:14px` }))); break;
      case 'docSpacings':
        [['Compact', { lineHeight: 1, after: 4 }], ['Normal (par défaut)', { lineHeight: 1.15, after: 8 }], ['Aéré', { lineHeight: 1.3, after: 10 }], ['Ouvert', { lineHeight: 1.5, after: 12 }], ['Double', { lineHeight: 2, after: 8 }]].forEach(([l, v]) => m.append(item(l, () => CMD.docSpacing.run(v))));
        break;
      case 'margins':
        [['Normales — 2,5 cm partout', [2.5, 2.5, 2.5, 2.5]], ['Étroites — 1,27 cm', [1.27, 1.27, 1.27, 1.27]], ['Modérées — 2,54 / 1,91 cm', [2.54, 1.91, 2.54, 1.91]], ['Larges — 2,54 / 5,08 cm', [2.54, 5.08, 2.54, 5.08]], ['Word US — 2,54 cm', [2.54, 2.54, 2.54, 2.54]]].forEach(([l, v]) => m.append(item(l, () => App.setMargins(v))));
        m.append(el('hr'), item('Marges personnalisées…', () => Dialogs.pageSetup()));
        break;
      case 'orient': m.append(item('Portrait', () => App.setOrientation('portrait'), { icon: 'rectangle-vertical' }), item('Paysage', () => App.setOrientation('landscape'), { icon: 'rectangle-horizontal' })); break;
      case 'sizes': break;
      case 'langs': [['Français (Belgique)', 'fr-BE'], ['Français (France)', 'fr-FR'], ['Néerlandais (Belgique)', 'nl-BE'], ['Anglais (Royaume-Uni)', 'en-GB'], ['Anglais (États-Unis)', 'en-US'], ['Allemand', 'de-DE'], ['Espagnol', 'es-ES'], ['Italien', 'it-IT'], ['Arabe', 'ar']].forEach(([l, c]) => m.append(item(l, () => App.setLang(c, l), { on: Ed.editor.lang === c }))); break;
    }
    if (name === 'sizes' && anchor.closest('.rgroup') && anchor.closest('[data-panel="miseenpage"]')) {
      m.innerHTML = '';
      Object.entries(PAGE_SIZES).forEach(([k, v]) => m.append(item(`${k} — ${v[0]} × ${v[1]} cm`, () => App.setSize(k))));
    }
    document.body.append(m);
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(innerWidth - mw - 4, r.left)) + 'px';
    m.style.top = (r.bottom + mh + 4 > innerHeight ? Math.max(4, r.top - mh - 4) : r.bottom + 4) + 'px';
    this.el = m;
  }
};
document.addEventListener('mousedown', e => { if (Menus.el && !Menus.el.contains(e.target) && !e.target.closest('.rbtn,.rsel')) Menus.close(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') Menus.close(); });

const PAGE_SIZES = { A4: [21, 29.7], A5: [14.8, 21], A3: [29.7, 42], Lettre: [21.59, 27.94], Légal: [21.59, 35.56], B5: [17.6, 25] };

/* ---------- Reproduire la mise en forme ---------- */
const Painter = {
  fmt: null,
  start() {
    const a = Ed.anchorEl();
    if (!a) return;
    const c = getComputedStyle(a);
    this.fmt = { fontFamily: c.fontFamily, fontSize: c.fontSize, fontWeight: c.fontWeight, fontStyle: c.fontStyle, color: c.color, textDecoration: c.textDecorationLine, bg: rgbToHex(c.backgroundColor) };
    document.body.style.cursor = 'copy';
    toast('Sélectionnez le texte auquel appliquer la mise en forme');
    const once = () => {
      Ed.editor.removeEventListener('mouseup', once);
      setTimeout(() => {
        document.body.style.cursor = '';
        const r = Ed.range();
        if (!r || r.collapsed) return;
        Ed.lastRange = r.cloneRange();
        const f = this.fmt;
        Ed.focus();
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('removeFormat');
        document.execCommand('fontName', false, f.fontFamily);
        document.execCommand('foreColor', false, f.color);
        if (parseInt(f.fontWeight) >= 600) document.execCommand('bold');
        if (f.fontStyle === 'italic') document.execCommand('italic');
        if (f.textDecoration.includes('underline')) document.execCommand('underline');
        if (f.bg) document.execCommand('hiliteColor', false, f.bg);
        Ed.fontSize(parseFloat(f.fontSize) * 0.75);
      }, 10);
    };
    Ed.editor.addEventListener('mouseup', once);
  }
};

/* ---------- Mini barre flottante ---------- */
const Mini = {
  init() {
    const m = $('#mini');
    const b = id => el('button', { class: 'rbtn', 'data-cmd': id, title: CMD[id].label, onclick: () => CMD[id].run() }, [icon(CMD[id].icon)]);
    m.append(b('grow'), b('shrink'), b('bold'), b('italic'), b('underline'), b('color'), b('highlight'), b('bullets'), b('numbers'), b('link'));
    m.addEventListener('mousedown', e => e.preventDefault());
    Ed.editor.addEventListener('mouseup', () => setTimeout(() => this.show(), 0));
    Ed.editor.addEventListener('keydown', () => this.hide());
    $('#canvas').addEventListener('scroll', () => this.hide());
  },
  show() {
    const r = Ed.range();
    if (!r || r.collapsed || !Ed.editor.contains(r.commonAncestorContainer) || !r.toString().trim()) { this.hide(); return; }
    const rect = r.getBoundingClientRect();
    const m = $('#mini');
    m.classList.add('open');
    m.style.left = Math.max(6, Math.min(innerWidth - m.offsetWidth - 6, rect.left)) + 'px';
    m.style.top = Math.max(6, rect.top - m.offsetHeight - 10) + 'px';
    Ribbon.refresh();
  },
  hide() { $('#mini').classList.remove('open'); }
};
