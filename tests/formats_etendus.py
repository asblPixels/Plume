"""Tests d’ouverture et d’export Plume, avec Chromium et LibreOffice.

Démarrer un serveur HTTP sur le dépôt (port 8765 par défaut). Le test utilise
le gestionnaire de conversion du bureau avec un substitut au bus Electron.
"""
import asyncio
import base64
from io import BytesIO
import os
from pathlib import Path
import shutil
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
RUN_CONVERTER = """
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const handlers = new Map();
const electron = {
  app: { getPath: () => os.tmpdir(), requestSingleInstanceLock: () => false, quit() {} },
  ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
  protocol: { registerSchemesAsPrivileged() {} }
};
vm.runInNewContext(fs.readFileSync('desktop/main.js', 'utf8'), {
  require: name => name === 'electron' ? electron : require(name),
  __dirname: process.cwd() + '/desktop', process, Buffer, console
});
handlers.get('plume:convert')(null, {
  data: fs.readFileSync(0), from: process.argv[1], to: process.argv[2]
}).then(bytes => {
  if (!bytes) process.exitCode = 1;
  else process.stdout.write(Buffer.from(bytes));
}).catch(error => { console.error(error); process.exitCode = 1; });
"""
OPEN = """async ([name, bytes]) => {
  const file = new File([Uint8Array.from(atob(bytes), c => c.charCodeAt(0))], name);
  return await Formats.open(file);
}"""
EXPORT = """async format => {
  const blob = await Formats.build(format, App.exportCtx());
  return await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}"""


def b64(data):
    return base64.b64encode(data).decode()


async def convert(_source, data, from_ext, to_ext):
    process = await asyncio.create_subprocess_exec(
        'node', '-e', RUN_CONVERTER, from_ext, to_ext, cwd=ROOT,
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await process.communicate(base64.b64decode(data))
    if process.returncode:
        raise RuntimeError(f'{from_ext} → {to_ext}: {err.decode()}')
    return b64(out)


async def main():
    async with async_playwright() as playwright:
        chrome = os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium')
        browser = await playwright.chromium.launch(executable_path=chrome)
        page = await browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.goto(os.environ.get('PLUME_URL', 'http://localhost:8765') + '/?new=1')

        csv_data = b64('"Nom, prénom";"Lieu, date"\r\n"Anne";"Mons\r\n""Salle B"""\r\n'.encode())
        csv_file = await page.evaluate(OPEN, ['classe.csv', csv_data])
        assert csv_file['format'] == 'csv'
        assert 'Nom, prénom' in csv_file['html'] and 'Mons<br>' in csv_file['html']
        await page.evaluate("(html) => Ed.load({html})", csv_file['html'])
        for ext in ('csv', 'tsv'):
            exported = await page.evaluate(EXPORT, ext)
            again = await page.evaluate(OPEN, ['classe.' + ext, exported])
            assert again['html'] == csv_file['html'], (ext, again['html'], csv_file['html'])

        await page.evaluate("""() => Ed.load({
          html: '<h1>Texte témoin pour Plume</h1><p>Un paragraphe de vérification.</p>',
          props: {title: 'Document de vérification'}
        })""")
        output = await page.evaluate(EXPORT, 'ott')
        with ZipFile(BytesIO(base64.b64decode(output))) as archive:
            mime = b'application/vnd.oasis.opendocument.text-template'
            assert archive.read('mimetype') == mime and mime in archive.read('META-INF/manifest.xml')
        ott = await page.evaluate(OPEN, ['modele.ott', output])
        assert ott['format'] == 'ott' and 'Texte témoin' in ott['html']

        dotx = await page.evaluate(EXPORT, 'dotx')
        mislabeled = await page.evaluate(OPEN, ['modele.docx', dotx])
        assert mislabeled['format'] == 'dotx'
        await page.evaluate("""async data => {
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
          await App.openFile(new File([bytes], 'modele.docx'), {});
        }""", dotx)
        assert await page.evaluate('App.fileHandle === null')

        archive = BytesIO()
        with ZipFile(archive, 'w') as zip_file:
            zip_file.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
            zip_file.writestr('xl/workbook.xml', '<workbook/>')
        rejected = await page.evaluate("""async bytes => {
          const data = Uint8Array.from(atob(bytes), c => c.charCodeAt(0));
          try { await Formats.open(new File([data], 'tableur.docx')); }
          catch (error) { return error.message; }
        }""", b64(archive.getvalue()))
        assert rejected == 'UNSUPPORTED_PACKAGE'

        epub = await page.evaluate(EXPORT, 'epub')
        with ZipFile(BytesIO(base64.b64decode(epub))) as book:
            assert book.infolist()[0].filename == 'mimetype' and book.infolist()[0].compress_type == 0
            assert book.read('mimetype') == b'application/epub+zip'
            for part in ('META-INF/container.xml', 'OEBPS/livre.opf', 'OEBPS/sommaire.xhtml', 'OEBPS/texte.xhtml'):
                ET.fromstring(book.read(part))
            assert 'texte.xhtml#titre-1' in book.read('OEBPS/sommaire.xhtml').decode()
        imported = await page.evaluate(OPEN, ['livre.epub', epub])
        assert 'Texte témoin' in imported['html']

        await page.expose_binding('convertWithWriter', convert)
        await page.evaluate("""() => {
          window.plumeDesktop = { converter: {
            available: async () => true,
            convert: async (bytes, from, to) => {
              const encoded = await new Promise(resolve => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(new Blob([bytes]));
              });
              const result = await window.convertWithWriter(encoded, from, to);
              return Uint8Array.from(atob(result), c => c.charCodeAt(0));
            }
          } };
        }""")
        for ext in ('fodt', 'xml', 'doc'):
            result = await page.evaluate(EXPORT, ext)
            if ext in ('fodt', 'xml'):
                ET.fromstring(base64.b64decode(result))
            imported = await page.evaluate(OPEN, ['copie.' + ext, result])
            assert 'Texte témoin' in imported['html'], ext
        assert not errors, errors
        await browser.close()
        print('CSV, TSV, OTT, EPUB, identification Word et 3 exports LibreOffice vérifiés')


if __name__ == '__main__':
    asyncio.run(main())
