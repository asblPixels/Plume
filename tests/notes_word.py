"""Vérifie la conservation des notes de bas de page et de fin dans un aller-retour Word.

Usage : python3 tests/notes_word.py (serveur sur PLUME_URL ou http://localhost:8765).
Prérequis : Playwright, Chromium ou Chrome et LibreOffice.
"""
import asyncio
import base64
import io
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from playwright.async_api import async_playwright


URL = os.environ.get('PLUME_URL', 'http://localhost:8765') + '/?new=1'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
TEXT = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
NOTE_TEXT = {'footnote': 'Une note de bas de page', 'endnote': 'Une note de fin'}
EDITED = 'Une note de fin modifiée'


def libreoffice_convert(folder, source, extension):
    out = folder / 'conversion'
    out.mkdir(exist_ok=True)
    result = subprocess.run([
        'soffice', f'-env:UserInstallation={(folder / "profile").as_uri()}',
        '--headless', '--convert-to', extension, '--outdir', str(out), str(source),
    ], capture_output=True, text=True, timeout=90, check=True)
    converted = out / source.with_suffix('.' + extension).name
    assert converted.exists(), result.stderr or result.stdout
    return converted


def fixture(folder):
    source = folder / 'source.odt'
    with ZipFile(source, 'w') as package:
        package.writestr('mimetype', 'application/vnd.oasis.opendocument.text')
        package.writestr('META-INF/manifest.xml', '''<manifest:manifest
          xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
          <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
          <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
        </manifest:manifest>''')
        fragments = [
            f'<text:p>Appel <text:note text:id="{kind}1" text:note-class="{kind}">'
            f'<text:note-citation>1</text:note-citation><text:note-body><text:p>{value}</text:p>'
            '</text:note-body></text:note>.</text:p>'
            for kind, value in NOTE_TEXT.items()
        ]
        package.writestr('content.xml', f'''<office:document-content
          xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
          xmlns:text="{TEXT[1:-1]}" office:version="1.2">
          <office:body><office:text>{''.join(fragments)}</office:text></office:body>
        </office:document-content>''')
    return libreoffice_convert(folder, source, 'docx')


async def open_document(page, data):
    await page.evaluate("""async data => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      await App.openFile(new File([bytes], 'notes.docx'));
    }""", base64.b64encode(data).decode('ascii'))


def verify_package(data, expected):
    with ZipFile(io.BytesIO(data)) as package:
        document = ET.fromstring(package.read('word/document.xml'))
        rels = ET.fromstring(package.read('word/_rels/document.xml.rels'))
        types = ET.fromstring(package.read('[Content_Types].xml'))
        for kind, value in expected.items():
            name = kind + 's'
            part = f'word/{name}.xml'
            refs = document.findall(f'.//{W}{kind}Reference')
            assert len(refs) == 1, kind
            matches = [rel for rel in rels if rel.get('Type', '').endswith('/' + name)]
            assert len(matches) == 1 and matches[0].get('Target') == f'{name}.xml', matches
            assert any(t.get('PartName') == '/' + part and t.get('ContentType', '').endswith(f'.{name}+xml') for t in types)
            notes = ET.fromstring(package.read(part))
            entry = next(note for note in notes if note.get(W + 'id') == refs[0].get(W + 'id'))
            assert entry.find(f'.//{W}{kind}Ref') is not None
            assert ''.join(t.text for t in entry.iter(W + 't') if t.text).strip() == value


async def main():
    browser_path = os.environ.get('PLUME_CHROME') or shutil.which('google-chrome') or shutil.which('chromium')
    with tempfile.TemporaryDirectory(prefix='plume-notes-') as tmp:
        folder = Path(tmp)
        source = fixture(folder)
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=browser_path)
            page = await browser.new_page()
            await page.goto(URL)
            await open_document(page, source.read_bytes())
            notes = page.locator('#editor .pl-fn')
            assert await notes.count() == 2
            assert await notes.nth(0).get_attribute('data-note') == NOTE_TEXT['footnote']
            # Les anciennes copies Plume et les notes créées dans l’éditeur n’ont pas ce marqueur.
            await notes.nth(0).evaluate('note => note.removeAttribute("data-note-kind")')
            endnote = notes.nth(1)
            assert await endnote.get_attribute('data-note-kind') == 'endnote'
            await endnote.click()
            assert await page.locator('.dlg-h').get_by_text('Note de fin', exact=True).is_visible()
            await page.locator('.dlg textarea').fill(EDITED)
            await page.get_by_role('button', name='OK', exact=True).click()
            data = bytes(await page.evaluate("""async () =>
              Array.from(new Uint8Array(await (await App.buildDocx()).arrayBuffer()))
            """))
            expected = {**NOTE_TEXT, 'endnote': EDITED}
            verify_package(data, expected)
            await open_document(page, data)
            assert await endnote.get_attribute('data-note-kind') == 'endnote'
            assert await endnote.get_attribute('data-note') == EDITED
            await browser.close()

        docx = folder / 'plume.docx'
        docx.write_bytes(data)
        reopened = libreoffice_convert(folder, docx, 'odt')
        with ZipFile(reopened) as package:
            root = ET.fromstring(package.read('content.xml'))
            values = {
                note.get(TEXT + 'note-class'): ''.join(note.find(TEXT + 'note-body').itertext()).strip()
                for note in root.iter(TEXT + 'note')
            }
            assert values == expected, values

    print('Notes Word : types et contenu conservés dans Plume, le DOCX et LibreOffice.')


if __name__ == '__main__':
    asyncio.run(main())
