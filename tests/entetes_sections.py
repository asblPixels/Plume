"""Aller-retour DOCX des en-têtes et pieds de page par section.

Démarrer Plume sur le port 8765, puis lancer ce script avec Playwright et python-docx.
CHROME permet de sélectionner un navigateur installé.
"""
import asyncio
import base64
from io import BytesIO
import os
import shutil
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from docx import Document
from docx.enum.section import WD_SECTION
from playwright.async_api import async_playwright

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'


def fixture(multiple):
    doc = Document()
    doc.settings.odd_and_even_pages_header_footer = True
    doc.add_paragraph('Première section')
    first = doc.sections[0]
    first.different_first_page_header_footer = True
    for name, content in {
        'first_page_header': 'En-tête première page',
        'even_page_header': 'En-tête pair',
        'header': 'En-tête section 1',
        'first_page_footer': 'Pied première page',
        'footer': 'Pied section 1',
    }.items():
        getattr(first, name).paragraphs[0].text = content
    if multiple:
        doc.add_section(WD_SECTION.NEW_PAGE).different_first_page_header_footer = False
        doc.add_paragraph('Deuxième section, liée à la précédente')
        last = doc.add_section(WD_SECTION.NEW_PAGE)
        last.header.is_linked_to_previous = False
        last.header.paragraphs[0].text = 'En-tête section 3'
        doc.add_paragraph('Troisième section')
    if multiple:
        last.start_type = WD_SECTION.NEW_COLUMN
        margins = last._sectPr.find(W + 'pgMar')
        margins.set(W + 'top', '-720')
        margins.set(W + 'bottom', '-840')
        margins.set(W + 'gutter', '360')
    output = BytesIO()
    doc.save(output)
    return base64.b64encode(output.getvalue()).decode()


async def open_word(page, data):
    await page.evaluate("""async data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      await App.openFile(new File([bytes], 'sections.docx'));
    }""", data)


async def save_word(page):
    data = await page.evaluate("""async () => {
      const blob = await App.buildDocx();
      return await new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }""")
    return base64.b64decode(data)


def section_stories(docx):
    with ZipFile(BytesIO(docx)) as zip_file:
        rels = ET.fromstring(zip_file.read('word/_rels/document.xml.rels'))
        targets = {rel.get('Id'): rel.get('Target') for rel in rels}
        doc = ET.fromstring(zip_file.read('word/document.xml'))
        sections = []
        for section in doc.iter(W + 'sectPr'):
            stories = {}
            for kind in ('header', 'footer'):
                for ref in section.findall(W + kind + 'Reference'):
                    key = f'{kind}-{ref.get(W + "type")}'
                    assert key not in stories, (key, stories)
                    target = targets[ref.get(R + 'id')]
                    path = target.lstrip('/') if target.startswith('/') else 'word/' + target
                    xml = ET.fromstring(zip_file.read(path))
                    stories[key] = ''.join(t.text or '' for t in xml.iter(W + 't'))
            sections.append(stories)
        return sections


async def main():
    async with async_playwright() as playwright:
        chrome = os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium')
        browser = await playwright.chromium.launch(executable_path=chrome)
        page = await browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(os.environ.get('PLUME_URL', 'http://localhost:8765') + '/?new=1')

        original = fixture(True)
        before = section_stories(base64.b64decode(original))
        await open_word(page, original)
        assert await page.locator('.header[data-pl-first-page]').inner_text() == 'En-tête première page'
        editable = page.locator('.header:not([data-pl-first-page])').first
        assert await editable.inner_text() == 'En-tête section 3'
        await editable.fill('En-tête modifié')
        exported = await save_word(page)
        assert section_stories(exported) == [before[0], {}, {'header-default': 'En-tête modifié'}]
        section = Document(BytesIO(exported)).sections[-1]
        assert section.start_type == WD_SECTION.NEW_COLUMN
        assert (section.top_margin.twips, section.bottom_margin.twips, section.gutter.twips) == (-720, -840, 360)

        await open_word(page, base64.b64encode(exported).decode())
        assert await editable.inner_text() == 'En-tête modifié'
        await editable.fill('')
        assert section_stories(await save_word(page)) == [before[0], {}, {'header-default': ''}]

        original = fixture(False)
        await open_word(page, original)
        assert await page.locator('.header').count() == 1
        assert section_stories(await save_word(page)) == section_stories(base64.b64decode(original))
        assert not errors, errors
        await browser.close()
        print('En-têtes et pieds de page DOCX : 3 allers-retours vérifiés')


if __name__ == '__main__':
    asyncio.run(main())
