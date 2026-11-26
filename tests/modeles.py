"""Vérifie les modèles pour l’administration et l’enseignement, puis leur export Word.

Usage : python3 tests/modeles.py (serveur sur PLUME_URL ou http://localhost:8765).
"""
import asyncio
import io
import os
import shutil
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from playwright.async_api import async_playwright, expect


URL = os.environ.get('PLUME_URL', 'http://localhost:8765') + '/'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
MODELS = [
    ('Courrier administratif', '[Numéro de dossier, si applicable]', False),
    ('Préparation de cours', 'Activité et consignes', True),
    ('Fiche d’exercices', 'Exercice 3', False),
]


async def main():
    browser_path = os.environ.get('PLUME_CHROME') or shutil.which('google-chrome') or shutil.which('chromium')
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=browser_path)
        page = await browser.new_page()
        await page.goto(URL)
        await page.get_by_role('button', name='Fichier', exact=True).click()
        backstage = page.locator('#backstage')
        editor = page.locator('#editor')
        await expect(backstage.get_by_role('heading', name='Administration')).to_be_visible()
        await expect(backstage.get_by_role('heading', name='Enseignement')).to_be_visible()
        await expect(backstage.get_by_role('button', name='Document vierge')).to_have_count(1)
        for index, (name, content, has_table) in enumerate(MODELS):
            if index > 0:
                await page.get_by_role('button', name='Fichier', exact=True).click()
                await backstage.get_by_role('button', name='Nouveau', exact=True).click()
                await expect(backstage.get_by_role('button', name='Document vierge', exact=True)).to_be_visible()
            await backstage.get_by_role('button', name=name, exact=True).click()
            await expect(editor).to_contain_text(content)
            await expect(page.locator('#docTitle')).to_have_value(name)
            assert await editor.get_attribute('contenteditable') == 'true'
            data = await page.evaluate("""async () =>
              Array.from(new Uint8Array(await (await App.buildDocx()).arrayBuffer()))
            """)
            with ZipFile(io.BytesIO(bytes(data))) as docx:
                xml = ET.fromstring(docx.read('word/document.xml'))
                assert content in ''.join(t.text or '' for t in xml.iter(W + 't')), name
                assert (xml.find(f'.//{W}tbl') is not None) == has_table, name
            if has_table:
                await page.evaluate("""async bytes =>
                  App.openFile(new File([new Uint8Array(bytes)], 'Cours.docx'))
                """, data)
                await expect(editor.get_by_role('table')).to_contain_text(content)
        mobile = await browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        await mobile.goto(URL)
        await mobile.get_by_role('button', name='Fichier', exact=True).click()
        await mobile.locator('#backstage').get_by_role('button', name='Nouveau', exact=True).click()
        await mobile.get_by_role('button', name='Fiche d’exercices', exact=True).tap()
        await expect(mobile.locator('#editor')).to_contain_text('Exercice 3')
        await browser.close()
    print('Les trois modèles s’ouvrent dans Plume et s’exportent en DOCX.')


if __name__ == '__main__':
    asyncio.run(main())
