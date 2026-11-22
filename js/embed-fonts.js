/* =====================================================================
   Plume — incorporation des polices scolaires dans les fichiers .docx
   Un document écrit en Marelle, Borel, Playwrite FR… s'affiche
   correctement dans Word même si la police n'est pas installée sur
   l'ordinateur : la police est jointe au fichier (police « obscurcie »
   .odttf, norme ECMA-376 partie 1, § 17.8.1), comme le fait Word avec
   « Fichier > Options > Enregistrement > Incorporer les polices ».
   ===================================================================== */
'use strict';

const EmbedFonts = (() => {
  const DIR = 'vendor/fonts/ttf/';
  // nom de police → fichiers TrueType (variantes disponibles)
  const FONTS = {
    'Marelle': { family: 'script', regular: 'Marelle-Regular.ttf' },
    'Borel': { family: 'script', regular: 'Borel-Regular.ttf' },
    'Playwrite FR Moderne': { family: 'script', regular: 'PlaywriteFRModerne-Regular.ttf' },
    'Playwrite FR Trad': { family: 'script', regular: 'PlaywriteFRTrad-Regular.ttf' },
    'Andika': { family: 'swiss', regular: 'Andika-Regular.ttf', bold: 'Andika-Bold.ttf', italic: 'Andika-Italic.ttf', boldItalic: 'Andika-BoldItalic.ttf' },
    'Comic Neue': { family: 'script', regular: 'ComicNeue-Regular.ttf', bold: 'ComicNeue-Bold.ttf' },
    'Atkinson Hyperlegible': { family: 'swiss', regular: 'AtkinsonHyperlegible-Regular.ttf', bold: 'AtkinsonHyperlegible-Bold.ttf' },
    'Lexend': { family: 'swiss', regular: 'Lexend-Regular.ttf', bold: 'Lexend-Bold.ttf' }
  };
  const VARIANTS = [['regular', 'embedRegular'], ['bold', 'embedBold'], ['italic', 'embedItalic'], ['boldItalic', 'embedBoldItalic']];
  const REL_FONT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
  const REL_TABLE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const cache = {};

  function guid() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return `{${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}}`;
  }
  /** Obscurcissement : les 32 premiers octets sont combinés (XOR) avec la clé lue à l'envers */
  function obfuscate(bytes, key) {
    const hex = key.replace(/[{}-]/g, '');
    const k = Array.from({ length: 16 }, (_, i) => parseInt(hex.substr(i * 2, 2), 16));
    const out = new Uint8Array(bytes);
    for (let i = 0; i < 32; i++) out[i] ^= k[15 - (i % 16)];
    return out;
  }
  async function load(file) {
    if (!cache[file]) cache[file] = fetch(DIR + file).then(r => { if (!r.ok) throw new Error(file); return r.arrayBuffer(); });
    return new Uint8Array(await cache[file]);
  }

  /** Polices scolaires utilisées dans le document (texte, styles, en-têtes…) */
  async function usedFonts(zip) {
    const used = new Set();
    const names = Object.keys(FONTS);
    for (const path of Object.keys(zip.files)) {
      if (!/^word\/(document|styles|header\d*|footer\d*|footnotes|endnotes|comments|numbering)\.xml$/.test(path)) continue;
      const xml = await zip.file(path).async('string');
      for (const n of names) if (!used.has(n) && new RegExp(`w:(ascii|hAnsi|cs|eastAsia)="${n}"`).test(xml)) used.add(n);
    }
    return [...used];
  }

  /** Ajoute <w:embedTrueTypeFonts/> à sa place réglementaire dans settings.xml */
  function patchSettings(xml) {
    if (/<w:embedTrueTypeFonts\b/.test(xml)) return xml;
    const before = ['writeProtection', 'view', 'zoom', 'removePersonalInformation', 'removeDateAndTime', 'doNotDisplayPageBoundaries', 'displayBackgroundShape', 'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData'];
    let at = -1;
    for (const t of before) {
      const re = new RegExp(`<w:${t}\\b[^>]*?(/>|>[\\s\\S]*?</w:${t}>)`, 'g');
      let m; while ((m = re.exec(xml))) at = Math.max(at, m.index + m[0].length);
    }
    if (at < 0) { const m = /<w:settings\b[^>]*>/.exec(xml); if (!m) return xml; at = m.index + m[0].length; }
    return xml.slice(0, at) + '<w:embedTrueTypeFonts/>' + xml.slice(at);
  }

  /**
   * Incorpore dans l'archive .docx les polices scolaires utilisées.
   * Ne fait rien si aucune n'est utilisée ou si une police manque.
   */
  async function apply(zip) {
    try {
      const used = await usedFonts(zip);
      if (!used.length) return [];
      const ctPath = '[Content_Types].xml', relsPath = 'word/_rels/document.xml.rels';
      let docRels = await zip.file(relsPath).async('string');
      // partie fontTable : existante (reprise du document d'origine) ou à créer
      let tablePath = 'word/fontTable.xml';
      const m = /<Relationship\b[^>]*Type="[^"]*\/fontTable"[^>]*>/.exec(docRels);
      if (m) {
        const t = /Target="([^"]+)"/.exec(m[0])[1].replace(/^\//, '');
        tablePath = t.startsWith('word/') ? t : 'word/' + t;
      }
      let table = zip.file(tablePath) ? await zip.file(tablePath).async('string')
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts ${NS}></w:fonts>`;
      if (!/xmlns:r=/.test(table)) table = table.replace(/<w:fonts\b/, '<w:fonts xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"');
      const tRelsPath = tablePath.replace(/([^/]+)$/, '_rels/$1.rels');
      let tRels = zip.file(tRelsPath) ? await zip.file(tRelsPath).async('string')
        : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      let n = Object.keys(zip.files).filter(p => /^word\/fonts\/font\d+\.odttf$/.test(p)).length;
      let rid = 900;
      while (tRels.includes(`Id="rIdF${rid}"`)) rid++;
      const done = [];
      for (const name of used) {
        const def = FONTS[name];
        let embeds = '';
        for (const [v, tag] of VARIANTS) {
          if (!def[v]) continue;
          const key = guid();
          const data = obfuscate(await load(def[v]), key);
          while (zip.file(`word/fonts/font${n + 1}.odttf`)) n++;
          const file = `fonts/font${++n}.odttf`;
          zip.file('word/' + file, data);
          while (tRels.includes(`Id="rIdF${rid}"`)) rid++;
          const id = 'rIdF' + (rid++);
          tRels = tRels.replace('</Relationships>', `<Relationship Id="${id}" Type="${REL_FONT}" Target="${file}"/></Relationships>`);
          embeds += `<w:${tag} r:id="${id}" w:fontKey="${key}"/>`;
        }
        // remplace une éventuelle déclaration sans police jointe
        table = table.replace(new RegExp(`<w:font w:name="${name}"[^>]*?(/>|>[\\s\\S]*?</w:font>)`), '');
        table = table.replace('</w:fonts>', `<w:font w:name="${esc(name)}"><w:charset w:val="00"/><w:family w:val="${def.family}"/><w:pitch w:val="variable"/>${embeds}</w:font></w:fonts>`);
        done.push(name);
      }
      zip.file(tablePath, table);
      zip.file(tRelsPath, tRels);
      if (!m) {
        docRels = docRels.replace('</Relationships>', `<Relationship Id="rIdFontTable" Type="${REL_TABLE}" Target="fontTable.xml"/></Relationships>`);
        zip.file(relsPath, docRels);
      }
      let ct = await zip.file(ctPath).async('string');
      if (!/Extension="odttf"/.test(ct)) ct = ct.replace(/(<Types\b[^>]*>)/, '$1<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>');
      if (!ct.includes(`PartName="/${tablePath}"`))
        ct = ct.replace('</Types>', `<Override PartName="/${tablePath}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>`);
      zip.file(ctPath, ct);
      const sp = 'word/settings.xml';
      if (zip.file(sp)) zip.file(sp, patchSettings(await zip.file(sp).async('string')));
      return done;
    } catch (e) {
      console.warn('Incorporation des polices impossible :', e);
      return [];
    }
  }

  /**
   * Polices jointes à un .docx ouvert (enregistrées par Word avec « Incorporer
   * les polices ») : elles sont déchiffrées et chargées pour un affichage fidèle.
   */
  async function loadFrom(zip) {
    const loaded = [];
    try {
      const rels = zip.file('word/_rels/document.xml.rels');
      if (!rels) return loaded;
      const m = /<Relationship\b[^>]*Type="[^"]*\/fontTable"[^>]*>/.exec(await rels.async('string'));
      if (!m) return loaded;
      const t = /Target="([^"]+)"/.exec(m[0])[1].replace(/^\//, '');
      const tablePath = t.startsWith('word/') ? t : 'word/' + t;
      const tf = zip.file(tablePath), rf = zip.file(tablePath.replace(/([^/]+)$/, '_rels/$1.rels'));
      if (!tf || !rf) return loaded;
      const doc = new DOMParser().parseFromString(await tf.async('string'), 'application/xml');
      const targets = {};
      for (const r of new DOMParser().parseFromString(await rf.async('string'), 'application/xml').getElementsByTagName('Relationship'))
        targets[r.getAttribute('Id')] = r.getAttribute('Target');
      const STY = { embedRegular: ['normal', 'normal'], embedBold: ['bold', 'normal'], embedItalic: ['normal', 'italic'], embedBoldItalic: ['bold', 'italic'] };
      for (const f of doc.getElementsByTagName('w:font')) {
        const name = f.getAttribute('w:name');
        for (const e of f.children) {
          const sty = STY[e.localName];
          if (!sty) continue;
          const target = targets[e.getAttribute('r:id')];
          const key = e.getAttribute('w:fontKey');
          if (!target) continue;
          const path = target.startsWith('/') ? target.slice(1) : tablePath.replace(/[^/]+$/, '') + target;
          const part = zip.file(path);
          if (!part) continue;
          let bytes = await part.async('uint8array');
          if (key && /\.odttf$/i.test(path)) bytes = obfuscate(bytes, key);
          try {
            const face = new FontFace(name, bytes.buffer, { weight: sty[0], style: sty[1] });
            await face.load();
            document.fonts.add(face);
            loaded.push(name);
          } catch (err) { console.warn('Police jointe illisible :', name, err); }
        }
      }
    } catch (e) { console.warn('Lecture des polices jointes impossible :', e); }
    return [...new Set(loaded)];
  }

  /** Même service pour l'OpenDocument (.odt) : polices dans Fonts/, lues par LibreOffice */
  async function applyOdt(zip) {
    try {
      const parts = ['content.xml', 'styles.xml'];
      const xml = {};
      for (const p of parts) xml[p] = await zip.file(p).async('string');
      const used = Object.keys(FONTS).filter(n => parts.some(p => xml[p].includes(`style:name="${n}"`)));
      if (!used.length) return [];
      let manifest = await zip.file('META-INF/manifest.xml').async('string');
      const VAR = { regular: ['normal', 'normal'], bold: ['bold', 'normal'], italic: ['normal', 'italic'], boldItalic: ['bold', 'italic'] };
      for (const name of used) {
        const def = FONTS[name];
        let src = '';
        for (const [v] of VARIANTS) {
          if (!def[v]) continue;
          const path = 'Fonts/' + def[v];
          zip.file(path, await load(def[v]), { createFolders: false });
          manifest = manifest.replace('</manifest:manifest>', `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="application/x-font-ttf"/></manifest:manifest>`);
          src += `<svg:font-face-uri xlink:href="${path}" xlink:type="simple" loext:font-style="${VAR[v][1]}" loext:font-weight="${VAR[v][0]}"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri>`;
        }
        const re = new RegExp(`<style:font-face style:name="${name}"([^>]*?)/>`);
        for (const p of parts) xml[p] = xml[p].replace(re, `<style:font-face style:name="${name}"$1><svg:font-face-src>${src}</svg:font-face-src></style:font-face>`);
      }
      for (const p of parts) {
        if (!/xmlns:loext=/.test(xml[p])) xml[p] = xml[p].replace(/<office:document-(content|styles)\b/, '$& xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"');
        zip.file(p, xml[p], { createFolders: false });
      }
      zip.file('META-INF/manifest.xml', manifest, { createFolders: false });
      // réglage LibreOffice « Incorporer les polices dans le document »
      const sp = await zip.file('settings.xml').async('string');
      if (!/EmbedFonts/.test(sp)) zip.file('settings.xml', sp.replace('<office:settings/>', '<office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="EmbedFonts" config:type="boolean">true</config:config-item></config:config-item-set></office:settings>'), { createFolders: false });
      return used;
    } catch (e) {
      console.warn('Incorporation des polices (ODT) impossible :', e);
      return [];
    }
  }

  return { apply, applyOdt, loadFrom, FONTS, obfuscate };
})();
