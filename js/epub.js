/* Plume — lecture et création de livres EPUB sans connexion. */
'use strict';

const Epub = (() => {
  const MIME = 'application/epub+zip';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const IMAGE_EXT = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'], ['image/webp', 'webp']]);

  async function importEpub(buf, registerImage) {
    const zip = await JSZip.loadAsync(buf);
    const parser = new DOMParser();
    const elements = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
    const readXml = async path => {
      const file = path && zip.file(path);
      return file ? parser.parseFromString(await file.async('string'), 'application/xml') : null;
    };
    const container = await readXml('META-INF/container.xml');
    const packPath = container && elements(container, 'rootfile')[0]?.getAttribute('full-path');
    const pack = await readXml(packPath);
    const manifest = pack && elements(pack, 'manifest')[0];
    const spine = pack && elements(pack, 'spine')[0];
    if (!manifest || !spine) throw Object.assign(new Error('EPUB_PACKAGE'), {
      userMessage: 'Ce fichier EPUB est incomplet. Plume n’a pas trouvé la liste de ses chapitres.'
    });

    const origin = 'https://epub.invalid';
    const resolve = (base, href) => {
      if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href.trim())) return null;
      try {
        const baseUrl = origin + '/' + base.split('/').map(encodeURIComponent).join('/');
        const url = new URL(href, baseUrl);
        return url.origin === origin ? {
          path: decodeURIComponent(url.pathname.slice(1)), id: decodeURIComponent(url.hash.slice(1))
        } : null;
      } catch { return null; }
    };
    const items = new Map(elements(manifest, 'item').map(item => [
      item.getAttribute('id'), {
        path: resolve(packPath, item.getAttribute('href'))?.path,
        type: item.getAttribute('media-type')
      }
    ]));
    const images = new Map([...items.values()].filter(item => item.path && IMAGE_EXT.has(item.type))
      .map(item => [item.path, item.type]));
    const chapters = [...new Set(elements(spine, 'itemref').filter(ref => ref.getAttribute('linear') !== 'no')
      .map(ref => items.get(ref.getAttribute('idref')))
      .filter(item => item?.path && ['application/xhtml+xml', 'text/html'].includes(item.type) && zip.file(item.path))
      .map(item => item.path))];
    const anchors = new Map(chapters.map((path, index) => [path, `epub-${index + 1}`]));
    const imageUrls = new Map();
    const content = [];

    for (const path of chapters) {
      const chapter = document.createElement('template');
      chapter.innerHTML = await zip.file(path).async('string');
      const root = chapter.content;
      // Les chapitres restent dans un fragment inerte pendant le nettoyage.
      root.querySelectorAll('head,script,style,meta,title,link,base').forEach(n => n.remove());
      const prefix = anchors.get(path);
      for (const node of root.querySelectorAll('[id]')) node.id = prefix + '-' + node.id;
      for (const link of root.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href').trim();
        if (/^(https?:|mailto:)/i.test(href)) continue;
        const to = resolve(path, href);
        if (to && anchors.has(to.path)) {
          link.setAttribute('href', '#' + encodeURIComponent(anchors.get(to.path) + (to.id ? '-' + to.id : '')));
        } else link.removeAttribute('href');
      }
      for (const img of root.querySelectorAll('img')) {
        const imagePath = resolve(path, img.getAttribute('src'))?.path;
        const entry = imagePath && images.has(imagePath) && zip.file(imagePath);
        if (!entry) { img.replaceWith(img.getAttribute('alt') || ''); continue; }
        if (!imageUrls.has(imagePath)) {
          const blob = new Blob([await entry.async('uint8array')], { type: images.get(imagePath) });
          imageUrls.set(imagePath, registerImage ? registerImage(blob) : URL.createObjectURL(blob));
        }
        img.setAttribute('src', imageUrls.get(imagePath));
      }
      Sanitize.clean(root);
      content.push(`<div id="${prefix}">${chapter.innerHTML}</div>`);
    }
    if (!content.length) throw Object.assign(new Error('EPUB_EMPTY'), {
      userMessage: 'Plume n’a trouvé aucun chapitre EPUB au format HTML.'
    });
    return { html: content.join(''), props: { title: elements(pack, 'title')[0]?.textContent || '' }, simplified: true };
  }

  async function exportEpub({ editor, props }) {
    const title = String(props?.title || App.name() || 'Document sans titre');
    const author = props?.author || '';
    const book = new JSZip();
    // OCF : le type MIME doit être la première entrée et rester non compressé.
    book.file('mimetype', MIME, { compression: 'STORE', createFolders: false });
    let imageCount = 0;
    const assets = new Map();
    const content = document.createElement('template');
    content.innerHTML = editor.innerHTML;
    content.content.querySelectorAll('.pl-toc,.pl-cref,.pl-pagebreak,.pl-colbreak,.pl-section').forEach(node => node.remove());
    Sanitize.clean(content.content);
    content.content.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'));

    for (const link of content.content.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      if (!/^(#|https?:|mailto:)/i.test(href)) link.removeAttribute('href');
    }
    for (const img of content.content.querySelectorAll('img')) {
      const source = img.getAttribute('src');
      if (!assets.has(source)) {
        let asset = null;
        if (/^(blob:|data:image\/)/i.test(source)) {
          try {
            const blob = await (await fetch(source)).blob();
            if (IMAGE_EXT.has(blob.type)) {
              const id = 'image-' + ++imageCount;
              const path = 'images/' + id + '.' + IMAGE_EXT.get(blob.type);
              book.file('OEBPS/' + path, await blob.arrayBuffer());
              asset = { id, path, type: blob.type };
            }
          } catch { /* garde le texte de remplacement */ }
        }
        assets.set(source, asset);
      }
      const asset = assets.get(source);
      const alt = img.getAttribute('alt') || '';
      if (asset) { img.setAttribute('src', asset.path); img.setAttribute('alt', alt); }
      else img.replaceWith(alt);
    }

    const usedIds = new Set(Array.from(content.content.querySelectorAll('[id]'), el => el.id));
    const links = [];
    for (const heading of content.content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const label = heading.textContent.trim();
      if (!label) continue;
      if (!heading.id) {
        let i = links.length + 1;
        while (usedIds.has('titre-' + i)) i++;
        heading.id = 'titre-' + i;
        usedIds.add(heading.id);
      }
      links.push(`<li><a href="texte.xhtml#${encodeURIComponent(heading.id)}">${xmlEsc(label)}</a></li>`);
    }
    if (!links.length) links.push(`<li><a href="texte.xhtml">${xmlEsc(title)}</a></li>`);

    const story = document.implementation.createDocument(XHTML, 'html');
    const e = (name, text) => {
      const node = story.createElementNS(XHTML, name);
      if (text) node.textContent = text;
      return node;
    };
    story.documentElement.setAttribute('lang', 'fr');
    const head = e('head'), body = e('body');
    head.append(e('title', title), e('style', 'img{max-width:100%;height:auto}table{border-collapse:collapse}th,td{border:1px solid;padding:.25em}'));
    body.append(story.importNode(content.content, true));
    story.documentElement.append(head, body);

    book.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/livre.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    book.file('OEBPS/texte.xhtml', new XMLSerializer().serializeToString(story));
    book.file('OEBPS/sommaire.xhtml', `<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr"><head><title>Sommaire</title></head><body><nav epub:type="toc"><h1>Sommaire</h1><ol>${links.join('')}</ol></nav></body></html>`);
    const identifier = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const pictures = Array.from(assets.values()).filter(Boolean)
      .map(({ id, path, type }) => `<item id="${id}" href="${path}" media-type="${type}"/>`).join('');
    book.file('OEBPS/livre.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:plume:${identifier}</dc:identifier><dc:title>${xmlEsc(title)}</dc:title><dc:language>fr</dc:language>${author ? `<dc:creator>${xmlEsc(author)}</dc:creator>` : ''}<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="texte" href="texte.xhtml" media-type="application/xhtml+xml"/><item id="sommaire" href="sommaire.xhtml" media-type="application/xhtml+xml" properties="nav"/>${pictures}</manifest>
<spine><itemref idref="texte"/></spine></package>`);
    return book.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
  }

  return { importEpub, exportEpub };
})();
