/* =====================================================================
   Plume — menu Fichier (backstage), modèles et boîtes de dialogue
   ===================================================================== */
'use strict';

const TEMPLATES = {
  blank: { name: 'Document vierge', html: '<p><br></p>' },
  letter: {
    name: 'Lettre', html:
      '<p style="text-align:right">Boussu, le ' + new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p>' +
      '<p><b>Expéditeur</b><br>Nom Prénom<br>Rue, numéro<br>Code postal Localité</p><p><br></p>' +
      '<p style="margin-left:240pt"><b>Destinataire</b><br>Nom Prénom<br>Rue, numéro<br>Code postal Localité</p><p><br></p>' +
      '<p><b>Objet :</b> objet de votre courrier</p><p><br></p><p>Madame, Monsieur,</p>' +
      '<p style="text-align:justify">Rédigez ici le corps de votre lettre. Présentez la raison de votre courrier dans un premier paragraphe, puis développez vos arguments.</p>' +
      '<p style="text-align:justify">Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.</p><p><br></p><p style="margin-left:240pt">Signature</p>'
  },
  cv: {
    name: 'Curriculum vitae', html:
      '<h1 class="title">Prénom Nom</h1><p class="subtitle">Intitulé du poste recherché</p>' +
      '<p>📍 Ville · ✉ adresse@exemple.be · ☎ 04xx xx xx xx</p>' +
      '<h1>Profil</h1><p>Deux ou trois phrases qui résument vos compétences et ce que vous recherchez.</p>' +
      '<h1>Expérience</h1><h2>Poste — Employeur</h2><p><i>Janvier 2022 – aujourd’hui</i></p><ul><li>Réalisation principale</li><li>Réalisation chiffrée</li></ul>' +
      '<h1>Formation</h1><h2>Diplôme — Établissement</h2><p><i>2018 – 2021</i></p>' +
      '<h1>Compétences</h1><ul><li>Compétence 1</li><li>Compétence 2</li><li>Langues : français (maternel), néerlandais (B1)</li></ul>'
  },
  report: {
    name: 'Rapport', html:
      '<h1 class="title">Titre du rapport</h1><p class="subtitle">Sous-titre ou service — ' + new Date().getFullYear() + '</p>' +
      '<h1>Introduction</h1><p>Présentez le contexte et l’objectif du rapport.</p><h1>Analyse</h1><h2>Premier point</h2><p>Développement.</p>' +
      '<table data-borders="all" style="width:600px"><colgroup><col style="width:300px"><col style="width:300px"></colgroup><tbody><tr data-header="1"><td style="background-color:#C7F9EC"><p><b>Indicateur</b></p></td><td style="background-color:#C7F9EC"><p><b>Valeur</b></p></td></tr><tr><td><p>Exemple</p></td><td><p>42</p></td></tr></tbody></table>' +
      '<h1>Conclusion</h1><p>Résumez les enseignements et les recommandations.</p>'
  },
  minutes: {
    name: 'Compte rendu de réunion', html:
      '<h1 class="title">Compte rendu de réunion</h1><p><b>Date :</b> ' + new Date().toLocaleDateString('fr-BE') + '<br><b>Lieu :</b> <br><b>Présents :</b> <br><b>Excusés :</b> </p>' +
      '<h1>Ordre du jour</h1><ol><li>Point 1</li><li>Point 2</li><li>Divers</li></ol><h1>Décisions</h1><ul><li>Décision prise</li></ul>' +
      '<h1>Actions</h1><table data-borders="all" style="width:600px"><colgroup><col style="width:300px"><col style="width:150px"><col style="width:150px"></colgroup><tbody><tr data-header="1"><td><p><b>Action</b></p></td><td><p><b>Responsable</b></p></td><td><p><b>Échéance</b></p></td></tr><tr><td><p><br></p></td><td><p><br></p></td><td><p><br></p></td></tr></tbody></table>'
  }
};

const Backstage = {
  open(section = 'home') {
    const bs = $('#backstage');
    bs.innerHTML = '';
    const side = el('div', { class: 'bs-side' });
    const main = el('div', { class: 'bs-main' });
    const nav = [['home', 'Accueil', 'feather'], ['new', 'Nouveau', 'file-plus'], ['open', 'Ouvrir', 'folder-open'], ['info', 'Informations', 'info'],
      ['save', 'Enregistrer', 'save'], ['export', 'Exporter / Télécharger', 'file-down'], ['print', 'Imprimer', 'printer']];
    side.append(el('button', { class: 'bs-back', onclick: () => this.close(), title: 'Retour au document (Échap)' }, [icon('arrow-left'), el('span', { class: 't' }, ['Retour'])]));
    for (const [id, l, ic] of nav) side.append(el('button', { class: section === id ? 'on' : '', onclick: () => this.go(id) }, [icon(ic), el('span', { class: 't' }, [l])]));
    side.append(el('div', { class: 'sp' }), el('button', { class: section === 'about' ? 'on' : '', onclick: () => this.go('about') }, [icon('sparkles'), el('span', { class: 't' }, ['À propos'])]));
    bs.append(side, main);
    bs.classList.add('open');
    this.render(section, main);
    this._esc = e => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this._esc);
  },
  go(id) {
    if (id === 'save') { this.close(); App.save(); return; }
    if (id === 'print') { this.close(); App.print(); return; }
    this.open(id);
  },
  close() { $('#backstage').classList.remove('open'); document.removeEventListener('keydown', this._esc); Ed.focus(); },

  tplGrid() {
    const g = el('div', { class: 'tpl-grid' });
    for (const [k, t] of Object.entries(TEMPLATES)) {
      const th = el('div', { class: 'thumb' }, [el('div', { class: 'np-tpl', html: t.html })]);
      g.append(el('button', { class: 'tpl', onclick: () => { this.close(); App.newDoc(k); } }, [th, t.name]));
    }
    return g;
  },
  async recent(limit = 20) {
    const list = el('div', { class: 'recent-list' });
    const docs = (await Store.listDocs().catch(() => [])).slice(0, limit);
    if (!docs.length) list.append(el('div', { class: 'np-empty' }, ['Aucun document récent sur cet appareil.']));
    for (const d of docs) {
      const row = el('button', { class: 'rec', onclick: () => { this.close(); App.openStored(d.id); } }, [icon('file-text'), d.name || 'Sans titre', el('span', { class: 'meta' }, [fmtDate(d.updated)])]);
      const del = el('span', { class: 'del', title: 'Retirer de la liste', onclick: async e => { e.stopPropagation(); if (d.id === App.docId) { toast('Document ouvert : impossible de le retirer'); return; } await Store.delDoc(d.id); row.remove(); } }, [icon('trash-2')]);
      row.append(del);
      list.append(row);
    }
    return list;
  },

  /** Mode confidentiel : réglage visible sur l'accueil */
  privacyBox() {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = App.keepLocal();
    cb.addEventListener('change', async () => { await App.setKeepLocal(cb.checked); this.open('home'); });
    return el('label', { class: 'bs-privacy' }, [cb, el('span', {}, [
      el('b', {}, ['Garder une copie de secours de mes documents sur cet appareil']),
      el('br'), el('span', {}, [App.keepLocal() ? 'Activé : vos documents sont aussi gardés dans Plume sur cet appareil. Déconseillé sur un ordinateur partagé.' : 'Désactivé (recommandé à l’école et sur un ordinateur partagé) : rien n’est gardé sur l’appareil. Enregistrez vos documents sur l’ordinateur ou une clé USB.'])])]);
  },

  async render(id, main) {
    switch (id) {
      case 'home':
        main.append(el('h1', {}, ['Bonjour']),
          el('div', { class: 'bs-actions bs-start' }, [
            el('button', { class: 'bs-card', onclick: () => { this.close(); App.newDoc('blank'); } }, [icon('file-plus', 'lg'), el('b', {}, ['Document vierge']), el('span', {}, ['Une page blanche, prête à écrire.'])]),
            el('button', { class: 'bs-card', onclick: () => { this.close(); App.openPicker(); } }, [icon('folder-open', 'lg'), el('b', {}, ['Ouvrir un fichier…']), el('span', {}, ['Depuis l’ordinateur, une clé USB ou un disque : Word, OpenDocument, PDF, texte…'])])
          ]),
          el('h2', {}, ['Modèles']), this.tplGrid());
        const docs = await Store.listDocs().catch(() => []);
        if (App.keepLocal()) main.append(el('h2', {}, ['Documents récents (sur cet appareil)']), await this.recent(8));
        else if (docs.length) main.append(el('h2', {}, ['Copies gardées sur cet appareil par une version précédente']), await this.recent(8),
          el('button', { class: 'btn', onclick: async () => { await App.purgeLocal(); toast('Copies effacées de cet appareil.'); this.open('home'); } }, [icon('trash-2'), ' Tout effacer de cet appareil']));
        main.append(this.privacyBox());
        break;
      case 'new': main.append(el('h1', {}, ['Nouveau']), this.tplGrid()); break;
      case 'open':
        main.append(el('h1', {}, ['Ouvrir']),
          el('div', { class: 'bs-actions' }, [
            el('button', { class: 'bs-card', onclick: () => { this.close(); App.openPicker(); } }, [icon('folder-open', 'lg'), el('b', {}, ['Parcourir…']), el('span', {}, ['Word (.docx, .doc), OpenDocument (.odt), RTF, PDF, Google Docs exportés, Markdown, HTML, texte…'])])
          ]), el('h2', {}, ['Documents récents (sur cet appareil)']), await this.recent());
        break;
      case 'info': {
        const s = Ed.stats();
        const t = el('table', { class: 'props' });
        const row = (l, v) => t.append(el('tr', {}, [el('td', {}, [l]), el('td', {}, [v])]));
        const title = el('input', { value: Ed.props.title || '' }); title.addEventListener('change', () => { Ed.props.title = title.value; Ed.changed(false); });
        const author = el('input', { value: Ed.props.author || '' }); author.addEventListener('change', () => { Ed.props.author = author.value; App.setUser(author.value); Ed.changed(false); });
        row('Titre', title); row('Auteur', author);
        row('Pages', String(s.pages)); row('Mots', String(s.words)); row('Caractères', String(s.chars));
        row('Format de page', `${U.pxToCm(Ed.page.w).toFixed(1)} × ${U.pxToCm(Ed.page.h).toFixed(1)} cm`);
        row('Enregistrement', App.fileHandle || App.desktopPath ? 'Fichier sur l’appareil (Ctrl+S réenregistre)' : App.keepLocal() ? 'Copie de secours automatique sur cet appareil ; enregistrez un fichier pour le garder' : 'Rien n’est gardé sur l’appareil : enregistrez le fichier (ordinateur ou clé USB)');
        main.append(el('h1', {}, ['Informations']), el('h2', {}, [App.name()]), t);
        break;
      }
      case 'export': {
        const icons = { docm: 'file-text', dotx: 'file-text', dotm: 'file-text', docx: 'file-text', odt: 'file-text', pdf: 'printer', rtf: 'file', doc: 'file', html: 'file-down', md: 'file-down', txt: 'file' };
        const grid = el('div', { class: 'bs-actions' });
        for (const [k, f] of Object.entries(Formats.EXPORT)) {
          if (f.desktop && !window.plumeDesktop) continue;
          if (f.macros && !App.hasMacros()) continue;   // .docm / .dotm : seulement si le document d'origine a des macros
          grid.append(el('button', { class: 'bs-card', onclick: () => { this.close(); App.saveAs(k); } }, [icon(icons[k] || 'file', 'lg'), el('b', {}, [f.label]), el('span', {}, [f.desc])]));
        }
        main.append(el('h1', {}, ['Exporter / Télécharger']), grid);
        if (window.plumeDesktop) {
          const st = el('p', { style: 'color:var(--ui-fg-2);margin-top:22px' }, ['Module de conversion LibreOffice : vérification…']);
          main.append(st);
          Formats.converterAvailable().then(ok => { st.innerHTML = ok ? '✅ Module de conversion LibreOffice détecté : ouverture des .doc, .wpd, .wps, .pages… et exports .doc, .fodt et Word 2003 XML disponibles.' : 'ℹ️ Installez <a href="https://fr.libreoffice.org/download/telecharger-libreoffice/" target="_blank" rel="noopener">LibreOffice</a> (gratuit) pour ouvrir les formats anciens (.doc avec mise en forme, WordPerfect, Works, Pages…) et exporter en .doc, .fodt ou Word 2003 XML.'; });
        }
        break;
      }
      case 'about':
        main.append(el('h1', {}, ['À propos de Plume']), el('div', {
          html: `<div style="display:flex;gap:18px;align-items:center;margin-bottom:18px"><svg viewBox="0 0 512 512" width="72" height="72"><use href="#plume-logo"/></svg>
          <div><img src="icons/plume-wordmark-${document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'}.svg" alt="Plume" height="34" style="display:block;margin-bottom:6px"><div style="color:var(--ui-fg-2)">Traitement de texte libre de <b>Pixel's ASBL</b> — Boussu</div><div style="color:var(--ui-fg-2)">Version ${App.VERSION}</div></div></div>
          <p style="max-width:640px;line-height:1.6">Plume fonctionne dans le navigateur, hors ligne, sur Windows, macOS, Linux, Android et iOS. Vos documents restent sur votre appareil : rien n'est envoyé sur Internet.</p>
          <p style="line-height:1.6">Contact : <a href="mailto:info@asblpixels.be">info@asblpixels.be</a> · <a href="https://facebook.com/asblpixels" target="_blank" rel="noopener">facebook.com/asblpixels</a></p>
          <h2>Composants libres</h2><ul style="line-height:1.7"><li>JSZip — licence MIT (Stuart Knightley et contributeurs)</li><li>PDF.js — licence Apache 2.0 (Mozilla et contributeurs)</li><li>jsPDF et html2canvas — licence MIT</li><li>Polices scolaires Marelle (Ministère de l’Éducation nationale, L. Bourcellier, J. Fabreguettes, R. Wagner), Borel (R. Wagner), Playwrite FR, Andika, OpenDyslexic, Comic Neue, Atkinson Hyperlegible, Lexend — SIL Open Font License 1.1</li><li>Tracés d’icônes Lucide — licence ISC, restylés pour Plume</li><li>Police du logotype Outfit — SIL Open Font License 1.1</li></ul>
          <p style="color:var(--ui-fg-2);font-size:12px">Microsoft Word et Office 365 sont des marques de Microsoft Corporation. Plume est un logiciel indépendant, sans lien avec Microsoft.</p>`
        }));
        break;
    }
  }
};

/* ---------- Boîtes de dialogue ---------- */
const Dialogs = {
  async link() {
    const a = Ed.anchorEl() && Ed.anchorEl().closest('a');
    const sel = Ed.lastRange ? Ed.lastRange.toString() : '';
    const body = el('div', {}, [
      el('div', { class: 'fld' }, [el('label', {}, ['Texte à afficher']), el('input', { type: 'text', id: 'lkText', value: a ? a.textContent : sel })]),
      el('div', { class: 'fld' }, [el('label', {}, ['Adresse']), el('input', { type: 'url', id: 'lkUrl', value: a ? a.getAttribute('href') : 'https://', placeholder: 'https://… ou #signet' })])
    ]);
    const r = await dialog({ title: a ? 'Modifier le lien' : 'Insérer un lien', body, buttons: [...(a ? [{ label: 'Supprimer le lien', value: 'rm' }] : []), { label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r === 'rm' && a) { a.replaceWith(...a.childNodes); Ed.changed(false); return; }
    if (r !== 'ok') return;
    let url = $('#lkUrl', body).value.trim(); const text = $('#lkText', body).value || url;
    if (!url || url === 'https://') return;
    if (/^www\./.test(url)) url = 'https://' + url;
    if (/^[^\s@]+@[^\s@]+$/.test(url)) url = 'mailto:' + url;
    if (/^\s*javascript:/i.test(url)) return;
    if (a) { a.setAttribute('href', url); a.textContent = text; Ed.changed(false); return; }
    Ed.insertHTML(`<a href="${htmlEsc(url)}">${htmlEsc(text)}</a>`);
  },
  async bookmark() {
    const inp = el('input', { type: 'text', placeholder: 'Nom du signet (sans espaces)' });
    const r = await dialog({ title: 'Signet', body: el('div', { class: 'fld' }, [el('label', {}, ['Nom']), inp]), buttons: [{ label: 'Annuler', value: null }, { label: 'Ajouter', primary: true, value: 'ok' }] });
    if (r !== 'ok' || !inp.value.trim()) return;
    Ed.insertHTML(`<span class="pl-anchor" id="${htmlEsc(inp.value.trim().replace(/\s+/g, '_'))}"></span>`);
    toast('Signet ajouté — liez-le avec l’adresse <b>#' + htmlEsc(inp.value.trim().replace(/\s+/g, '_')) + '</b>');
  },
  async table() {
    const body = el('div', {}, [
      el('div', { class: 'fld' }, [el('label', {}, ['Nombre de colonnes']), el('input', { type: 'number', id: 'tc', value: 3, min: 1, max: 63 })]),
      el('div', { class: 'fld' }, [el('label', {}, ['Nombre de lignes']), el('input', { type: 'number', id: 'tr', value: 3, min: 1, max: 500 })])]);
    const r = await dialog({ title: 'Insérer un tableau', body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r === 'ok') Ed.insertTable(Math.max(1, +$('#tr', body).value), Math.max(1, Math.min(63, +$('#tc', body).value)));
  },
  async date() {
    const d = new Date();
    const formats = [
      d.toLocaleDateString('fr-BE'), d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' }),
      d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      d.toISOString().slice(0, 10), d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }),
      d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })];
    const sel = el('select', { size: formats.length, style: 'width:100%;height:auto' }, formats.map((f, i) => el('option', { value: f, selected: i === 1 }, [f])));
    const r = await dialog({ title: 'Date et heure', body: sel, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r === 'ok') Ed.insertText(sel.value);
  },
  async replace() {
    const body = el('div', {}, [
      el('div', { class: 'fld' }, [el('label', {}, ['Rechercher']), el('input', { type: 'text', id: 'rf', value: Ed.lastRange && !Ed.lastRange.collapsed ? Ed.lastRange.toString().slice(0, 100) : '' })]),
      el('div', { class: 'fld' }, [el('label', {}, ['Remplacer par']), el('input', { type: 'text', id: 'rr' })]),
      el('div', { class: 'checks' }, [el('label', {}, [el('input', { type: 'checkbox', id: 'rc' }), ' Respecter la casse']), el('label', {}, [el('input', { type: 'checkbox', id: 'rw' }), ' Mot entier'])]),
      el('div', { id: 'rinfo', style: 'color:var(--ui-fg-2);margin-top:10px;min-height:18px' })]);
    let idx = -1, ranges = [];
    const opts = () => ({ matchCase: $('#rc', body).checked, wholeWord: $('#rw', body).checked });
    const next = () => {
      ranges = Ed.find($('#rf', body).value, opts());
      if (!ranges.length) { $('#rinfo', body).textContent = 'Aucun résultat.'; return false; }
      idx = (idx + 1) % ranges.length;
      Ed.showMatches(ranges, idx); Ed.selectRange(ranges[idx]);
      $('#rinfo', body).textContent = `Résultat ${idx + 1} sur ${ranges.length}`;
      return false;
    };
    await dialog({
      title: 'Rechercher et remplacer', body, width: 520, buttons: [
        { label: 'Suivant', onClick: next },
        { label: 'Remplacer', onClick: () => { if (ranges[idx]) { Ed.selectRange(ranges[idx]); Ed.exec('insertText', $('#rr', body).value); idx--; } next(); return false; } },
        { label: 'Remplacer tout', onClick: () => { const n = Ed.replaceAll($('#rf', body).value, $('#rr', body).value, opts()); $('#rinfo', body).textContent = `${n} remplacement(s) effectué(s).`; return false; } },
        { label: 'Fermer', primary: true, value: null }]
    });
    Ed.showMatches([]);
  },
  async font() {
    const a = Ed.anchorEl(); const cs = a ? getComputedStyle(a) : null;
    const fam = cs ? cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() : 'Calibri';
    const fontSel = el('select', { id: 'df' }, FONTS.map(f => el('option', { selected: f === fam }, [f])));
    const size = el('input', { type: 'number', id: 'ds', value: Ed.currentFontPt(), step: 0.5, min: 1 });
    const color = el('input', { type: 'color', id: 'dc', value: cs ? rgbToHex(cs.color) || '#000000' : '#000000' });
    const chk = (id, l) => el('label', {}, [el('input', { type: 'checkbox', id }), ' ' + l]);
    const prev = el('div', { class: 'preview' }, ['AaBbCc — Plume']);
    const body = el('div', {}, [
      el('div', { class: 'fld' }, [el('label', {}, ['Police']), fontSel]),
      el('div', { class: 'fld' }, [el('label', {}, ['Taille (pt)']), size]),
      el('div', { class: 'fld' }, [el('label', {}, ['Couleur']), color]),
      el('fieldset', {}, [el('legend', {}, ['Attributs']), el('div', { class: 'checks' }, [chk('db', 'Gras'), chk('di', 'Italique'), chk('du', 'Souligné'), chk('dst', 'Barré'), chk('dsup', 'Exposant'), chk('dsub', 'Indice'), chk('dcaps', 'Majuscules'), chk('dsc', 'Petites majuscules')])]),
      prev]);
    const upd = () => {
      Object.assign(prev.style, {
        fontFamily: DocxImport.cssFont(fontSel.value), fontSize: size.value + 'pt', color: color.value,
        fontWeight: $('#db', body).checked ? 'bold' : 'normal', fontStyle: $('#di', body).checked ? 'italic' : 'normal',
        textDecoration: [$('#du', body).checked && 'underline', $('#dst', body).checked && 'line-through'].filter(Boolean).join(' ') || 'none',
        textTransform: $('#dcaps', body).checked ? 'uppercase' : 'none', fontVariant: $('#dsc', body).checked ? 'small-caps' : 'normal'
      });
    };
    body.addEventListener('input', upd); body.addEventListener('change', upd);
    if (cs) { $('#db', body).checked = parseInt(cs.fontWeight) >= 600; $('#di', body).checked = cs.fontStyle === 'italic'; }
    upd();
    const r = await dialog({ title: 'Police', body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    Ed.focus();
    const r0 = Ed.range(); if (!r0 || r0.collapsed) return;
    const s = el('span', { style: prev.getAttribute('style') });
    s.style.removeProperty('display');
    ['alignItems', 'justifyContent', 'height', 'overflow'].forEach(k => s.style[k] = '');
    if (!$('#dsup', body).checked && !$('#dsub', body).checked) s.style.verticalAlign = '';
    try {
      const frag = r0.extractContents();
      let inner = frag;
      if ($('#dsup', body).checked || $('#dsub', body).checked) { const v = el($('#dsup', body).checked ? 'sup' : 'sub'); v.append(frag); inner = v; }
      s.append(inner);
      r0.insertNode(s);
      $$('span', s).forEach(x => ['fontFamily', 'fontSize', 'color', 'fontWeight', 'fontStyle', 'textDecoration'].forEach(k => x.style[k] = ''));
      Ed.cleanupSpans(Ed.activeRoot());
    } catch { }
    Ed.afterCmd();
  },
  async paragraph() {
    const b = Ed.selectedBlocks()[0];
    const cs = b ? getComputedStyle(b) : null;
    const num = (id, v, step = 0.1) => el('input', { type: 'number', id, value: v, step });
    const align = el('select', { id: 'pa' }, [['left', 'Gauche'], ['center', 'Centré'], ['right', 'Droite'], ['justify', 'Justifié']].map(([v, l]) => el('option', { value: v, selected: cs && (cs.textAlign === v || (v === 'left' && cs.textAlign === 'start')) }, [l])));
    const lh = b && b.style.lineHeight && /^[\d.]+$/.test(b.style.lineHeight) ? b.style.lineHeight : String(Ed.settings.lineHeight);
    const fi = cs ? U.pxToCm(parseFloat(cs.textIndent) || 0) : 0;
    const body = el('div', {}, [
      el('div', { class: 'fld' }, [el('label', {}, ['Alignement']), align]),
      el('fieldset', {}, [el('legend', {}, ['Retrait (cm)']),
        el('div', { class: 'fld' }, [el('label', {}, ['Gauche']), num('pl', cs ? U.pxToCm(parseFloat(cs.marginLeft) || 0).toFixed(2) : 0)]),
        el('div', { class: 'fld' }, [el('label', {}, ['Droite']), num('pr', cs ? U.pxToCm(parseFloat(cs.marginRight) || 0).toFixed(2) : 0)]),
        el('div', { class: 'fld' }, [el('label', {}, ['1re ligne (négatif = suspendu)']), num('pf', fi.toFixed(2))])]),
      el('fieldset', {}, [el('legend', {}, ['Espacement']),
        el('div', { class: 'fld' }, [el('label', {}, ['Avant (pt)']), num('pb', cs ? Math.round(U.pxToPt(parseFloat(cs.marginTop) || 0)) : 0, 1)]),
        el('div', { class: 'fld' }, [el('label', {}, ['Après (pt)']), num('pa2', cs ? Math.round(U.pxToPt(parseFloat(cs.marginBottom) || 0)) : 8, 1)]),
        el('div', { class: 'fld' }, [el('label', {}, ['Interligne (multiple)']), num('plh', lh, 0.05)])])]);
    const r = await dialog({ title: 'Paragraphe', body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    const cm = v => (parseFloat(v) || 0) * 28.3465;
    Ed.blockStyle(x => {
      x.style.textAlign = align.value === 'left' ? '' : align.value;
      x.style.marginLeft = cm($('#pl', body).value) ? cm($('#pl', body).value).toFixed(1) + 'pt' : '';
      x.style.marginRight = cm($('#pr', body).value) ? cm($('#pr', body).value).toFixed(1) + 'pt' : '';
      x.style.textIndent = cm($('#pf', body).value) ? cm($('#pf', body).value).toFixed(1) + 'pt' : '';
      x.style.marginTop = ($('#pb', body).value || 0) + 'pt';
      x.style.marginBottom = ($('#pa2', body).value || 0) + 'pt';
      x.style.lineHeight = $('#plh', body).value || '';
    });
  },
  async pageSetup() {
    const si = Ed.curSectIndex(), nS = Ed.sections().length;
    const p = Ed.sections()[si], cm = v => U.pxToCm(v).toFixed(2);
    const n = (id, v) => el('input', { type: 'number', id, value: v, step: 0.01, min: 0 });
    const body = el('div', {}, [
      el('fieldset', {}, [el('legend', {}, ['Marges (cm)']),
        el('div', { class: 'fld' }, [el('label', {}, ['Haut']), n('mt', cm(p.mt))]), el('div', { class: 'fld' }, [el('label', {}, ['Bas']), n('mb', cm(p.mb))]),
        el('div', { class: 'fld' }, [el('label', {}, ['Gauche']), n('ml', cm(p.ml))]), el('div', { class: 'fld' }, [el('label', {}, ['Droite']), n('mr', cm(p.mr))]),
        el('div', { class: 'fld' }, [el('label', {}, ['En-tête depuis le bord']), n('mh', cm(p.mh))]), el('div', { class: 'fld' }, [el('label', {}, ['Pied depuis le bord']), n('mf', cm(p.mf))])]),
      el('fieldset', {}, [el('legend', {}, ['Papier (cm)']),
        el('div', { class: 'fld' }, [el('label', {}, ['Largeur']), n('pw', cm(p.w))]), el('div', { class: 'fld' }, [el('label', {}, ['Hauteur']), n('ph', cm(p.h))])]),
      el('fieldset', {}, [el('legend', {}, ['Colonnes']),
        el('div', { class: 'fld' }, [el('label', {}, ['Nombre']), el('input', { type: 'number', id: 'ncol', value: (p.cols && p.cols.n) || 1, min: 1, max: 6, step: 1 })]),
        el('div', { class: 'fld' }, [el('label', {}, ['Espacement (cm)']), n('scol', cm(p.cols && p.cols.space != null ? p.cols.space : U.cmToPx(1.25)))]),
        el('div', { class: 'fld' }, [el('label', {}, ['Ligne séparatrice']), el('input', { type: 'checkbox', id: 'sepcol', checked: !!(p.cols && p.cols.sep) })])]),
      nS > 1 ? el('div', { class: 'fld' }, [el('label', {}, ['Appliquer à']), el('select', { id: 'applyTo' }, [el('option', { value: 'sect' }, [`Cette section (${si + 1} sur ${nS})`]), el('option', { value: 'all' }, ['Tout le document'])])]) : null]);
    const r = await dialog({ title: 'Mise en page', body, buttons: [{ label: 'Annuler', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
    if (r !== 'ok') return;
    const g = id => U.cmToPx(parseFloat($('#' + id, body).value) || 0);
    const nc = Math.max(1, Math.min(6, parseInt($('#ncol', body).value, 10) || 1));
    const apply = sp => {
      Object.assign(sp, { mt: g('mt'), mb: g('mb'), ml: g('ml'), mr: g('mr'), mh: g('mh'), mf: g('mf'), w: Math.max(U.cmToPx(5), g('pw')), h: Math.max(U.cmToPx(5), g('ph')) });
      const same = sp.cols && sp.cols.n === nc && sp.cols.eq === false;
      sp.cols = same ? Object.assign(sp.cols, { space: g('scol'), sep: $('#sepcol', body).checked }) : { n: nc, space: g('scol'), eq: true, sep: $('#sepcol', body).checked };
    };
    const all = $('#applyTo', body) && $('#applyTo', body).value === 'all';
    for (let k = 0; k < nS; k++) if (all || k === si) Ed.updateSect(k, apply);
    App.pageChanged();
  },
  async stats() {
    const s = Ed.stats();
    const sw = Ed.selectionWords();
    const t = el('table', { class: 'stat-table' }, [['Pages', s.pages], ['Mots', s.words], ['Caractères (espaces non compris)', s.charsNoSpace], ['Caractères (espaces compris)', s.chars], ['Paragraphes', s.paras], ['Lignes de texte', s.lines]].concat(sw != null ? [['Mots dans la sélection', sw]] : []).map(([l, v]) => el('tr', {}, [el('td', {}, [l]), el('td', {}, [String(v)])])));
    await dialog({ title: 'Statistiques', body: t, buttons: [{ label: 'Fermer', primary: true }] });
  },
  async shortcuts() {
    const list = Object.values(CMD).filter(c => c.kbd).map(c => el('tr', {}, [el('td', {}, [c.label]), el('td', { style: 'text-align:right;color:var(--ui-fg-2)' }, [c.kbd])]));
    await dialog({ title: 'Raccourcis clavier', body: el('table', { class: 'stat-table', style: 'width:100%' }, list), buttons: [{ label: 'Fermer', primary: true }] });
  }
};
