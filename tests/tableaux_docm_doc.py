# Tests : styles de tableau conditionnels, macros (.docm/.dotm/.dotx), anciens .doc
# Prérequis : python3 tests/genere_tableaux.py [dossier]  puis serveur http sur le port PLUME_PORT
# Usage : PLUME_PORT=8765 python3 tests/tableaux_docm_doc.py [dossier]
import asyncio, base64, io, json, os, re, subprocess, sys, zipfile
from playwright.async_api import async_playwright

D = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/test/tab'
OUT = os.path.join(D, 'out'); os.makedirs(OUT, exist_ok=True)
URL = f"http://localhost:{os.environ.get('PLUME_PORT', '8765')}/?new=1"
OK = []; KO = []
def check(name, cond, info=''):
    (OK if cond else KO).append(name)
    print(('  ok  ' if cond else '  ÉCHEC ') + name + (f'  [{info}]' if info and not cond else ''))

OPEN = """async ([d,n])=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],n));}"""
BUILD = """async (fmt)=>{const bl=await Formats.build(fmt, App.exportCtx());const a=new Uint8Array(await bl.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return [btoa(s), bl.type];}"""
CELL = """([t,r,c])=>{const td=Ed.editor.querySelectorAll('table')[t].rows[r].cells[c];const s=getComputedStyle(td);const p=td.querySelector('p span')||td.querySelector('p')||td;return {bg:s.backgroundColor,color:getComputedStyle(p).color,fw:getComputedStyle(p).fontWeight,fs:getComputedStyle(p).fontStyle,bt:s.borderTopStyle+' '+s.borderTopColor,bb:s.borderBottomStyle};}"""
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()


async def open_file(pg, path):
    await pg.evaluate(OPEN, [b64(path), os.path.basename(path)])
    await pg.wait_for_timeout(900)


async def build(pg, fmt):
    o = await pg.evaluate(BUILD, fmt)
    return zipfile.ZipFile(io.BytesIO(base64.b64decode(o[0]))), o[1], base64.b64decode(o[0])


async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await br.new_page(viewport={'width': 1300, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(700)

        print('== Styles de tableau (import)')
        await open_file(pg, f'{D}/tableaux.docx')
        info = json.loads(await pg.evaluate("JSON.stringify([...Ed.editor.querySelectorAll('table')].map(t=>[t.dataset.tblstyle,t.dataset.look,t.dataset.borders]))"))
        check('9 tableaux stylés', len(info) == 9 and all(i[0] for i in info), info)
        check('tblLook attributs', info[2][1] == 'firstRow lastRow firstColumn lastColumn hBand', info[2])
        check('tblLook hexa 04E0', info[3][1] == 'firstRow lastRow firstColumn hBand', info[3])
        c = lambda t, r, k: pg.evaluate(CELL, [t, r, k])
        x = await c(2, 0, 1); check('en-tête Medium Shading : fond accent1, texte blanc, gras', x['bg'] == 'rgb(79, 129, 189)' and x['color'] == 'rgb(255, 255, 255)' and x['fw'] == '700', x)
        x = await c(2, 1, 1); check('bande 1 (thème teinté 3F)', x['bg'] == 'rgb(211, 223, 238)', x)
        x = await c(2, 2, 1); check('bande 2 sans fond', x['bg'] == 'rgba(0, 0, 0, 0)', x)
        x = await c(2, 1, 3); check('dernière colonne en gras', x['fw'] == '700', x)
        x = await c(2, 5, 1); check('ligne des totaux : gras + double trait', x['fw'] == '700' and x['bt'].startswith('double'), x)
        x = await c(4, 2, 1); check('trame directe prioritaire', x['bg'] == 'rgb(255, 255, 0)', x)
        x = await c(4, 3, 2); check('couleur directe prioritaire', x['color'] == 'rgb(192, 0, 0)', x)
        x = await c(5, 1, 1); y = await c(5, 2, 1); z = await c(5, 3, 1)
        check('bandes de 2 lignes (tblStyleRowBandSize)', x['bg'] == y['bg'] != z['bg'], [x['bg'], y['bg'], z['bg']])
        x = await c(6, 0, 1); check('couleur de thème seule (themeFill accent1)', x['bg'] == 'rgb(79, 129, 189)', x)
        x = await c(6, 1, 2); check('themeFillTint 33 + bandes verticales', x['bg'] not in ('rgba(0, 0, 0, 0)', 'rgb(79, 129, 189)'), x)
        x = await c(7, 0, 0); check('coin nwCell > firstRow', x['bg'] == 'rgb(192, 0, 0)' and x['color'] == 'rgb(255, 255, 255)', x)
        x = await c(7, 0, 3); check('coin neCell', x['bg'] == 'rgb(0, 176, 80)', x)
        x = await c(7, 5, 3); check('coin seCell', x['bg'] == 'rgb(0, 112, 192)', x)
        x = await c(7, 0, 1); check('firstRow hérité (basedOn) remplacé', x['bg'] == 'rgb(191, 191, 191)', x)
        x = await c(7, 5, 1); check('lastRow italique', x['fs'] == 'italic', x)
        # captures Plume + rendu LibreOffice pour comparaison visuelle
        await pg.evaluate("document.querySelector('#toast') && (document.querySelector('#toast').style.display='none')")
        for i in range(len(info)):
            el = pg.locator('#editor table').nth(i)
            await el.scroll_into_view_if_needed(); await el.screenshot(path=f'{OUT}/plume_tableau_{i}.png')
        subprocess.run(['soffice', '-env:UserInstallation=file:///tmp/plume-test-lo', '--headless', '--convert-to', 'pdf', '--outdir', OUT, f'{D}/tableaux.docx'], capture_output=True)
        subprocess.run(['pdftoppm', '-r', '80', '-png', f'{OUT}/tableaux.pdf', f'{OUT}/libreoffice_tableaux'], capture_output=True)
        before = await pg.evaluate("[...Ed.editor.querySelectorAll('td')].map(td=>getComputedStyle(td).backgroundColor+getComputedStyle(td).fontWeight).join('|')")

        print('== Export .docx (style non figé) puis réimport')
        z, mime, raw = await build(pg, 'docx')
        doc = z.read('word/document.xml').decode(); sty = z.read('word/styles.xml').decode()
        check('tblStyle réécrit', len(re.findall(r'<w:tblStyle ', doc)) == 9)
        check('tblLook réécrit', '<w:tblLook w:val="05E0" w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="1"' in doc)
        check('aucune trame déduite figée', re.findall(r'w:fill="(\w+)"', doc) == ['FFFF00'], re.findall(r'w:fill="(\w+)"', doc))
        check('aucun gras déduit figé', doc.count('<w:b/>') == 1, doc.count('<w:b/>'))
        check('styles conservés (thème, coins)', 'GridTable4-Accent1' in sty and 'PlumeTestCoins' in sty)
        open(f'{OUT}/tableaux_plume.docx', 'wb').write(raw)
        await open_file(pg, f'{OUT}/tableaux_plume.docx')
        after = await pg.evaluate("[...Ed.editor.querySelectorAll('td')].map(td=>getComputedStyle(td).backgroundColor+getComputedStyle(td).fontWeight).join('|')")
        check('aller-retour identique', before == after)

        print('== Galerie Plume et options')
        await pg.goto(URL); await pg.wait_for_timeout(600)
        await pg.click('#editor'); await pg.evaluate("Ed.insertTable(4,3)")
        for i in range(12):
            await pg.keyboard.type(f'v{i}')
            if i < 11: await pg.keyboard.press('Tab')
        await pg.click('[data-tab=tcreation]')
        check('galerie : 11 styles + aucun', await pg.locator('#tsGallery .tsitem').count() == 12)
        await pg.click('#tsGallery [data-ts=PlumeOcean]')
        await pg.click('.rchk[data-look=lastRow]'); await pg.click('.rchk[data-look=vBand]')
        check('case cochée', await pg.get_attribute('.rchk[data-look=lastRow]', 'aria-checked') == 'true')
        x = await c(0, 0, 0); check('style galerie appliqué', x['bg'] == 'rgb(31, 95, 139)', x)
        await pg.evaluate("Ed.tableOp('rowBelow')"); await pg.wait_for_timeout(100)
        x = await c(0, 4, 0); check('ligne des totaux suit la structure', x['fw'] == '700' and x['bt'].startswith('double'), x)
        await pg.screenshot(path=f'{OUT}/plume_galerie.png')
        z, _, raw = await build(pg, 'docx')
        doc = z.read('word/document.xml').decode(); sty = z.read('word/styles.xml').decode()
        check('w:style PlumeOcean écrit', 'w:styleId="PlumeOcean"' in sty and '<w:tblStylePr w:type="firstRow">' in sty)
        check('tblLook 0060 (en-tête+totaux+bandes)', 'w:val="00E0"' in doc or 'w:firstRow="1" w:lastRow="1"' in doc)
        check('pas de trame figée', 'w:fill=' not in doc)
        open(f'{OUT}/galerie.docx', 'wb').write(raw)
        r = subprocess.run(['soffice', '-env:UserInstallation=file:///tmp/plume-test-lo', '--headless', '--convert-to', 'pdf', '--outdir', OUT, f'{OUT}/galerie.docx'], capture_output=True)
        check('LibreOffice ouvre le .docx', os.path.exists(f'{OUT}/galerie.pdf'))

        print('== Macros .docm / .dotm / .dotx')
        orig = zipfile.ZipFile(f'{D}/macros.docm').read('word/vbaProject.bin')
        for f, fmt in [('macros.docm', 'docm'), ('macros.dotm', 'dotm'), ('modele.dotx', 'dotx')]:
            await pg.goto(URL); await pg.wait_for_timeout(500)
            await open_file(pg, f'{D}/{f}')
            st = await pg.evaluate("[App.format, App.hasMacros(), !document.querySelector('#infoBar').hidden, document.querySelector('#infoBar').innerText]")
            macro = fmt != 'dotx'
            check(f'{f} : format {fmt}', st[0] == fmt, st)
            check(f'{f} : bandeau macros', st[2] == macro and (not macro or 'jamais exécutées' in st[3]), st)
            z, mime, _ = await build(pg, fmt)
            names = z.namelist(); ct = z.read('[Content_Types].xml').decode()
            main = re.search(r'PartName="/word/document.xml" ContentType="([^"]+)"', ct).group(1)
            exp = {'docm': 'macroEnabled.main', 'dotm': 'macroEnabledTemplate.main', 'dotx': 'template.main'}[fmt]
            check(f'{f} : type principal {exp}', exp in main, main)
            if macro:
                check(f'{f} : vbaProject.bin intact', 'word/vbaProject.bin' in names and z.read('word/vbaProject.bin') == orig)
                check(f'{f} : vbaData.xml + relations', 'word/vbaData.xml' in names and 'word/_rels/vbaProject.bin.rels' in names and 'vbaProject' in z.read('word/_rels/document.xml.rels').decode())
                z2, _, _ = await build(pg, 'docx')
                ct2 = z2.read('[Content_Types].xml').decode()
                check(f'{f} → .docx : macros retirées proprement', not any('vba' in n for n in z2.namelist()) and 'vba' not in ct2.lower() and 'vbaProject' not in z2.read('word/_rels/document.xml.rels').decode())
                # avertissement à l'enregistrement en .docx
                pg_save = asyncio.ensure_future(pg.evaluate("App.saveAs('docx')"))
                await pg.wait_for_timeout(300)
                dlg = await pg.evaluate("document.querySelector('.dlg-back') ? document.querySelector('.dlg-back').innerText : ''")
                check(f'{f} : avertissement « Enregistrer sous .docx »', 'retirées' in dlg, dlg[:80])
                await pg.click('.dlg-f .btn >> text=Annuler'); await pg_save

        print('== Anciens .doc (Word 97-2003)')
        await pg.goto(URL); await pg.wait_for_timeout(500)
        await open_file(pg, f'{D}/ancien.doc')
        h = await pg.evaluate("Ed.editor.innerHTML")
        check('.doc : titres', '<h1>Rapport ancien format</h1>' in h and '<h2>Section deux</h2>' in h and '<h3>Titre trois</h3>' in h)
        check('.doc : gras / italique / taille', 'font-weight:bold">gras<' in h and 'font-style:italic">italique<' in h and 'font-size:18pt">grand 18 pt<' in h)
        check('.doc : caractères spéciaux cp1252', '« guillemets », l’apostrophe, 50 €, œuvre, Ÿ, — tiret, … points.' in h)
        check('.doc : tableau 3×3', await pg.evaluate("(()=>{const t=Ed.editor.querySelector('table');return t&&t.rows.length===3&&t.rows[0].cells.length===3&&t.rows[2].cells[1].textContent==='Boussu'})()"))
        check('.doc : saut de page', 'pl-pagebreak' in h)
        bar = await pg.evaluate("document.querySelector('#infoBar').hidden ? '' : document.querySelector('#infoBar').innerText")
        check('.doc : message de contenu partiel', 'Word 97-2003' in bar and 'LibreOffice' in bar, bar)
        await open_file(pg, f'{D}/unicode.doc')
        check('.doc : texte UTF-16', 'Zażółć gęślą jaźń — Ελληνικά — Привет.' in await pg.evaluate("Ed.editor.innerText"))
        cx = '/home/claude/test/fmt/complexe.doc'
        if os.path.exists(cx):
            await open_file(pg, cx)
            st = json.loads(await pg.evaluate("JSON.stringify({h:Ed.editor.querySelectorAll('h1,h2').length,l:Ed.editor.querySelectorAll('ul,ol').length,t:Ed.editor.querySelectorAll('table').length,cs:Ed.editor.querySelector('td[colspan=\"2\"]')!==null,rs:Ed.editor.querySelector('td[rowspan=\"2\"]')!==null,bar:document.querySelector('#infoBar').innerText})"))
            check('complexe.doc : titres, listes, fusions', st['h'] == 4 and st['l'] == 2 and st['t'] == 1 and st['cs'] and st['rs'], st)
            check('complexe.doc : image et en-tête signalés', 'image' in st['bar'] and 'en-têtes' in st['bar'], st['bar'])
        # version bureau : le module de conversion (LibreOffice) est utilisé en priorité
        conv = b64(f'{D}/ancien.docx')
        await pg.evaluate("""d=>{window.plumeDesktop={converter:{available:async()=>true,convert:async(buf,from,to)=>{window._conv=[from,to];return Uint8Array.from(atob(d),c=>c.charCodeAt(0)).buffer;}}};}""", conv)
        await open_file(pg, f'{D}/ancien.doc')
        st = await pg.evaluate("[window._conv, App.format, document.querySelector('#infoBar').hidden, Ed.editor.querySelectorAll('table').length]")
        check('bureau : conversion LibreOffice automatique', st[0] == ['doc', 'docx'] and st[1] == 'doc' and st[2] and st[3] == 1, st)

        check('aucune erreur console', not errs, errs[:5])
        await br.close()
    print(f'\n{len(OK)} réussis, {len(KO)} échecs', KO)
    sys.exit(1 if KO else 0)

asyncio.run(main())
