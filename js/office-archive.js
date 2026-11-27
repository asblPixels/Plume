/* Validation commune des paquets Word et OpenDocument, avant tout décodage XML. */
'use strict';

const OfficeArchive = (() => {
  const MiB = 1024 * 1024;
  const limits = Object.freeze({
    compressed: 128 * MiB, entry: 64 * MiB, expanded: 256 * MiB,
    directory: 8 * MiB, count: 12000, milliseconds: 60000
  });
  const invalid = () => new Error('Archive Office invalide ou incomplète.');
  const exceeded = () => new Error('Le document dépasse les limites de lecture des archives de Plume.');

  // Vérifie le vrai nombre de notices avant que JSZip ne crée ses objets.
  // Les paquets multi-disques et ZIP64 ne sont pas pris en charge par ce lecteur.
  function inspect(bytes, policy) {
    if (bytes.byteLength > policy.compressed) throw exceeded();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = pos => view.getUint16(pos, true);
    const u32 = pos => view.getUint32(pos, true);
    const last = bytes.length - 22;
    let end = last;
    while (end >= Math.max(0, last - 65535) && u32(end) !== 0x06054b50) end--;
    if (end < Math.max(0, last - 65535) || end + 22 + u16(end + 20) !== bytes.length) throw invalid();
    const count = u16(end + 10), directory = u32(end + 12);
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) throw invalid();
    if (count > policy.count || directory > policy.directory) throw exceeded();
    let pos = u32(end + 16);
    if (pos + directory !== end) throw invalid();
    let expanded = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > end || u32(pos) !== 0x02014b50) throw invalid();
      const size = u32(pos + 24);
      expanded += size;
      if (size > policy.entry || expanded > policy.expanded) throw exceeded();
      pos += 46 + u16(pos + 28) + u16(pos + 30) + u16(pos + 32);
    }
    if (pos !== end) throw invalid();
  }

  async function verify(bytes, policy = limits) {
    inspect(bytes, policy);
    const deadline = Date.now() + policy.milliseconds;
    const zip = await JSZip.loadAsync(bytes);
    let total = 0;
    for (const file of Object.values(zip.files)) {
      if (Date.now() > deadline) throw exceeded();
      if (file.dir) continue;
      // Compte également la sortie réelle du décompresseur, par blocs, sans
      // concaténer le contenu. La taille déclarée dans le ZIP ne suffit pas.
      await new Promise((resolve, reject) => {
        let size = 0;
        const stream = file.internalStream('uint8array');
        stream.on('data', chunk => {
          size += chunk.length;
          total += chunk.length;
          if (size > policy.entry || total > policy.expanded || Date.now() > deadline) {
            stream.pause();
            reject(exceeded());
          }
        }).on('error', reject).on('end', resolve).resume();
      });
    }
    return zip;
  }

  async function load(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength > limits.compressed) throw exceeded();
    // Une page locale autonome peut être ouverte en file://, où les navigateurs
    // interdisent généralement le chargement d'un worker adjacent.
    if (typeof Worker === 'undefined' || location.protocol === 'file:') return verify(bytes);
    const worker = new Worker(new URL('js/office-archive-worker.js', document.baseURI));
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(exceeded()), limits.milliseconds);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          if (data.ok) resolve();
          else reject(new Error(data.error));
        };
        worker.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Impossible de vérifier l’archive du document.'));
        };
        try { worker.postMessage(bytes); }
        catch (error) { clearTimeout(timer); reject(error); }
      });
    } finally {
      worker.terminate();
    }
    return JSZip.loadAsync(bytes);
  }

  return { load, verify, limits, exceeded };
})();
