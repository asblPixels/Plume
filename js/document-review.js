/* Complément local de relecture. Le document reste inchangé. */
'use strict';
const DocumentReview = (() => {
  function findings(root) {
    const issues = [];
    let previousLevel = 0;
    for (const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const level = Number(heading.tagName.slice(1));
      const label = heading.textContent.trim();
      if (!label) issues.push({ node: heading, message: 'Titre vide' });
      if (level > previousLevel + 1) issues.push({ node: heading, message: 'Niveau de titre à vérifier · ' + (label.slice(0, 80) || 'titre vide') });
      previousLevel = level;
    }
    for (const image of root.querySelectorAll('img')) {
      if (!image.hasAttribute('alt') && !['presentation','none'].includes(image.getAttribute('role'))) {
        issues.push({ node: image, message: 'Image sans attribut de texte alternatif' });
      }
    }
    for (const link of root.querySelectorAll('a[href]')) {
      const label = link.getAttribute('aria-label') || link.textContent || '';
      if (!label.trim() && !link.querySelector('img[alt]:not([alt=""])')) issues.push({ node: link, message: 'Lien sans libellé' });
    }
    return issues;
  }
  async function open() {
    if (PdfEditor.active) return toast('La relecture porte sur les documents texte.');
    const issues = findings(Ed.editor);
    const body = el('div', {}, [el('p', {}, [issues.length ? issues.length + ' point(s) à examiner dans le corps du document.' : 'Aucun problème détecté sur les titres, les descriptions d’images et les libellés des liens.'])]);
    if (issues.length) {
      const select = el('select', { size: Math.min(8, issues.length), 'aria-label': 'Points à examiner', style: 'max-width:100%' });
      issues.forEach(({ message }, i) => select.append(el('option', { value: String(i) }, [(i + 1) + '. ' + message])));
      select.selectedIndex = 0;
      body.append(select);
      const result = await dialog({ title: 'Relecture du document', body, buttons: [{ label: 'Fermer' }, { label: 'Afficher dans le document', primary: true, value: 'show' }] });
      if (result === 'show') {
        const node = issues[select.selectedIndex]?.node;
        if (!node?.isConnected) return;
        Ed.editor.focus();
        const range = document.createRange();
        range.selectNode(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        node.scrollIntoView({ block: 'center' });
      }
    } else await dialog({ title: 'Relecture du document', body, buttons: [{ label: 'Fermer', primary: true }] });
  }
  return { open, findings };
})();
