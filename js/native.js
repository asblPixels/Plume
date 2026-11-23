/* =====================================================================
   Plume — intégration mobile (Android / iOS via Capacitor)
   Enregistrement dans les Documents du téléphone + partage, ouverture
   des fichiers reçus d'autres applications (« Ouvrir avec Plume »).
   Sans effet dans un navigateur ou dans l'application de bureau.
   ===================================================================== */
'use strict';

const Native = {
  get on() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); },
  plugin(name) { return window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null; },

  blobToBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
  },

  /** Enregistre le fichier dans Documents/Plume puis propose de le partager */
  async save(blob, name) {
    const FS = this.plugin('Filesystem'), Share = this.plugin('Share');
    if (!FS) { toast('Enregistrement impossible sur cet appareil.'); return; }
    const data = await this.blobToBase64(blob);
    const path = 'Plume/' + name;
    let uri;
    try {
      const r = await FS.writeFile({ path, data, directory: 'DOCUMENTS', recursive: true });
      uri = r.uri;
    } catch {
      const r = await FS.writeFile({ path, data, directory: 'CACHE', recursive: true });   // repli si l'accès aux Documents est refusé
      uri = r.uri;
    }
    toast(`<b>${htmlEsc(name)}</b> enregistré dans <b>Documents › Plume</b>`, 4000);
    if (Share) { try { await Share.share({ title: name, files: [uri], dialogTitle: 'Envoyer ou enregistrer ailleurs' }); } catch { /* partage annulé */ } }
  },

  /** Ouvre un fichier transmis par une autre application (content:// ou file://) */
  async openUrl(url) {
    if (!url || !/^(content|file):/.test(url)) return;
    const FS = this.plugin('Filesystem');
    try {
      const r = await FS.readFile({ path: url });
      const bytes = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
      let name = decodeURIComponent(url.split('/').pop().split('?')[0]) || 'document';
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.docx';
      await App.openFile(new File([bytes], name));
    } catch (e) { console.error(e); toast('Impossible d’ouvrir ce fichier depuis l’autre application.'); }
  },

  init() {
    if (!this.on) return;
    document.documentElement.classList.add('native', 'native-' + window.Capacitor.getPlatform());
    const AppPlugin = this.plugin('App');
    if (AppPlugin) {
      AppPlugin.addListener('appUrlOpen', e => this.openUrl(e.url));
      AppPlugin.getLaunchUrl().then(r => r && r.url && this.openUrl(r.url)).catch(() => { });
      // bouton « retour » Android : ferme menus et dialogues avant de quitter
      AppPlugin.addListener('backButton', () => {
        const d = $('.dlg-back'); if (d) { d.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return; }
        if ($('#backstage.open')) { Backstage.close(); return; }
        if (Menus.el) { Menus.close(); return; }
        App.requestQuit();
      });
    }
  }
};
