"""Démarrage : page blanche + accueil, jamais de réouverture du dernier document, mode confidentiel."""
import asyncio, base64, os
from playwright.async_api import async_playwright
URL = os.environ.get('PLUME_URL', 'http://localhost:8765') + '/'
ok = fail = 0
def check(c, m):
    global ok, fail
    print(('  OK   ' if c else '  ÉCHEC ') + m); ok += bool(c); fail += (not c)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 1300, 'height': 850})
        await ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>false}); localStorage.setItem('plume-guide-vu','1');")
        pg = await ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(900)
        check(await pg.evaluate("document.getElementById('backstage').classList.contains('open')"), 'accueil affiché au démarrage')
        check('Document vierge' in await pg.inner_text('#backstage') and 'Ouvrir un fichier' in await pg.inner_text('#backstage'), 'choix « Document vierge » et « Ouvrir un fichier »')
        await pg.click('text=Document vierge'); await pg.wait_for_timeout(300)
        check(not await pg.evaluate("document.getElementById('backstage').classList.contains('open')"), 'document vierge ouvert')
        await pg.click('#editor'); await pg.keyboard.type('Texte secret de test'); await pg.wait_for_timeout(2200)
        n = await pg.evaluate("Store.listDocs().then(d=>d.length)")
        check(n == 0, f'mode confidentiel : aucune copie gardée sur l’appareil ({n})')
        pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(URL); await pg.wait_for_timeout(900)
        check('Texte secret' not in await pg.evaluate("Ed.editor.innerText"), 'relance : le dernier document n’est PAS rouvert')
        check(await pg.evaluate("document.getElementById('backstage').classList.contains('open')"), 'relance : accueil affiché')
        d = base64.b64encode(open('/home/claude/test/fmt/complexe.docx', 'rb').read()).decode()
        await pg.evaluate("""async d=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'complexe.docx'));}""", d)
        await pg.wait_for_timeout(600)
        check(not await pg.evaluate("document.getElementById('backstage').classList.contains('open')") and 'Rapport annuel' in await pg.evaluate("Ed.editor.innerText"), 'ouverture d’un fichier depuis l’accueil')
        d2 = base64.b64encode(open('/home/claude/test/fmt/complexe.odt', 'rb').read()).decode()
        await pg.evaluate("""async d=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'deuxieme.odt'));}""", d2)
        await pg.wait_for_timeout(600)
        check(await pg.evaluate("document.getElementById('docTitle').value") == 'deuxieme', 'deuxième document ouvert alors qu’un document est déjà ouvert')
        await pg.evaluate("App.setKeepLocal(true)"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("Store.listDocs().then(d=>d.length)") >= 1, 'copie de secours activable')
        await pg.evaluate("App.setKeepLocal(false)"); await pg.wait_for_timeout(300)
        check(await pg.evaluate("Store.listDocs().then(d=>d.length)") == 0, 'désactivation : copies effacées')
        await pg.goto(URL); await pg.wait_for_timeout(800)
        await pg.screenshot(path='/tmp/accueil.png')
        check(not errs, f'aucune erreur console {errs[:3]}')
        await b.close()
    print(f'\n{ok} réussis, {fail} échecs')
asyncio.run(main())
