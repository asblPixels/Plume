import asyncio
import os
from pathlib import Path
import shutil
from playwright.async_api import async_playwright
async def main():
    browser_path = os.environ.get('PLUME_CHROME') or shutil.which('google-chrome') or shutil.which('chromium')
    url = os.environ.get('PLUME_URL', 'http://localhost:8765')
    captures = Path(__file__).resolve().parent.parent / 'test'
    captures.mkdir(exist_ok=True)
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path=browser_path)
        pg=await b.new_page(viewport={'width':1440,'height':900})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto(url + '/?new=1'); await pg.wait_for_timeout(700)
        await pg.click('#editor'); await pg.keyboard.type('Bonjour le monde')
        # suivi des modifications
        await pg.evaluate("Track.toggle()")
        await pg.keyboard.type(' ajout'); await pg.keyboard.press('Home'); 
        for _ in range(3): await pg.keyboard.press('Delete')
        await pg.wait_for_timeout(200)
        print('TRACK', await pg.evaluate("Ed.editor.innerHTML.replace(/data-date=\"[^\"]*\"/g,'')"))
        await pg.evaluate("Track.toggle()")
        # correction auto
        await pg.keyboard.press('End'); await pg.keyboard.press('Enter')
        await pg.keyboard.type('Il dit "oui" et c\'est vrai : ok !')
        print('AUTO', await pg.evaluate("[...Ed.editor.querySelectorAll('p')].pop().textContent.replace(/\\u202F/g,'⍽').replace(/\\u00A0/g,'·')"))
        # légende + filigrane
        await pg.evaluate("Ed.settings.watermark='BROUILLON';Watermark.render()")
        print('WM', await pg.evaluate("document.querySelectorAll('.pl-watermark').length"))
        # publipostage
        await pg.evaluate("""Merge.data={cols:['Nom','Ville'],rows:[['Ana','Mons'],['Léo','Boussu']]};Ed.focus();Merge.insertField('Nom');""")
        await pg.evaluate("Merge.togglePreview()"); 
        print('MERGE preview', await pg.evaluate("document.querySelector('.pl-merge').textContent"))
        await pg.evaluate("Merge.finish()"); await pg.wait_for_timeout(500)
        print('MERGE result pages', await pg.evaluate("Ed.pageCount"), await pg.evaluate("Ed.editor.innerText.includes('Léo') && Ed.editor.innerText.includes('Ana')"))
        # protection
        await pg.evaluate("Protect.toggle()"); print('PROTECT', await pg.evaluate("Ed.editor.contentEditable")); await pg.evaluate("Protect.toggle()")
        # export docx avec révisions -> relire
        o=await pg.evaluate("""async()=>{const bl=await Formats.build('docx', App.exportCtx());return bl.size}""")
        print('DOCX size', o)
        # tous les onglets s'affichent sans erreur
        for t in ['accueil','insertion','creation','miseenpage','references','publipostage','revision','affichage','aide']:
            await pg.click(f'[data-tab={t}]'); await pg.wait_for_timeout(80)
        await pg.click('[data-tab=publipostage]'); await pg.screenshot(path=captures / 'pub.png')
        await pg.evaluate("App.openBackstage('export')"); await pg.wait_for_timeout(300); await pg.screenshot(path=captures / 'export.png')
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
