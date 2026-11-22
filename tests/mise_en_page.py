"""Tests de mise en page de Plume : coupe à la ligne, veuves/orphelines, sections
(portrait / paysage), colonnes, export DOCX des sections, saisie fluide, performances.

Prérequis : serveur Plume (python3 -m http.server) ; LibreOffice (soffice), python-docx, Playwright.
Usage : PLUME_URL=http://localhost:8765 python3 tests/mise_en_page.py [dossier_de_travail]
"""
import asyncio, base64, json, os, subprocess, sys
from playwright.async_api import async_playwright
from docx import Document
from docx.enum.section import WD_ORIENT

URL = os.environ.get('PLUME_URL', 'http://localhost:8765') + '/?new=1'
D = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/test/mep'
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(D, exist_ok=True)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
fails, oks = [], []
def check(cond, label):
    (oks if cond else fails).append(label)
    print(('  OK   ' if cond else '  ÉCHEC ') + label)

def lo_pdf(path):
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', os.path.dirname(path), path], capture_output=True)
    return os.path.splitext(path)[0] + '.pdf'
def pdf_pages(pdf):
    out = subprocess.run(['pdfinfo', '-f', '1', '-l', '999', pdf], capture_output=True, text=True).stdout
    return [l.split(':', 1)[1].split('pts')[0].strip() for l in out.splitlines() if l.startswith('Page') and 'size' in l]

async def open_doc(pg, path):
    data = base64.b64encode(open(path, 'rb').read()).decode()
    await pg.evaluate("""async ([d,n])=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],n));}""", [data, os.path.basename(path)])
    await pg.wait_for_timeout(1200)

async def export(pg, fmt, out):
    o = await pg.evaluate("""async (f)=>{const b=await Formats.build(f, App.exportCtx());const a=new Uint8Array(await b.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}""", fmt)
    open(out, 'wb').write(base64.b64decode(o))

async def main():
    subprocess.run([sys.executable, os.path.join(HERE, 'genere_mise_en_page.py'), D], check=True, capture_output=True)
    for f in ('sections3', 'colonnes', 'long', 'lignes', 'cinquante'): lo_pdf(f'{D}/{f}.docx')
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page(viewport={'width': 1400, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(700)

        print('\n1. Interligne façon Word : lignes par page (Calibri 11, interligne 1,08, après 8 pt)')
        await open_doc(pg, f'{D}/lignes.docx')
        per = json.loads(await pg.evaluate("""JSON.stringify((()=>{const c=[];for(const p of Ed.editor.querySelectorAll('p')){const k=Ed.pageOfY(Ed.yInSheet(p));c[k]=(c[k]||0)+1}return c})())"""))
        lo = [subprocess.run(['pdftotext', '-f', str(i + 1), '-l', str(i + 1), f'{D}/lignes.pdf', '-'], capture_output=True, text=True).stdout.count('Ligne') for i in range(len(pdf_pages(f'{D}/lignes.pdf')))]
        print('     Plume', per, '/ LibreOffice', lo)
        check(per == lo, 'même nombre de paragraphes par page que LibreOffice')

        print('\n2. Coupe à la ligne, veuves et orphelines (long.docx)')
        await open_doc(pg, f'{D}/long.docx')
        r = json.loads(await pg.evaluate("""JSON.stringify((()=>{
          const j=[...Ed.editor.querySelectorAll('span[data-pl-artifact]')];
          // lignes de chaque côté de chaque coupe (≥ 2 : veuves/orphelines)
          const lines=n=>{const rs=[];const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let t;const r=document.createRange();while((t=w.nextNode())){r.selectNodeContents(t);for(const q of r.getClientRects())if(q.height&&!rs.some(y=>Math.abs(y-q.top)<2))rs.push(q.top)}return rs.length};
          const sides=j.map(a=>{const p=a.parentElement.closest('p,li,h1,h2,h3');const r1=document.createRange();r1.setStart(p,0);r1.setEndBefore(a);const r2=document.createRange();r2.setStartAfter(a);r2.setEnd(p,p.childNodes.length);const f1=document.createElement('div');f1.append(r1.cloneContents());const f2=document.createElement('div');f2.append(r2.cloneContents());
            const top=q=>Ed.pageOfY(Ed.yInSheet(q));return {pBefore:top(p), pAfter:Ed.pageOfY((a.getBoundingClientRect().bottom-Ed.sheet.getBoundingClientRect().top)/Ed.zoom+2)}});
          const pg=Ed.pages; let inMargin=0;
          for(const p of Ed.editor.querySelectorAll('p')){const r=p.getBoundingClientRect(),s=Ed.sheet.getBoundingClientRect();const top=(r.top-s.top)/Ed.zoom;const k=Ed.pageOfY(top);if(top<pg[k].y+pg[k].mt-1)inMargin++}
          const pbb=Ed.editor.querySelector('[data-pbb="1"]'); const pp=pbb?Ed.pages[Ed.pageOfY(Ed.yInSheet(pbb))]:null;
          return {pages:Ed.pageCount, cuts:j.length, sides, inMargin, pbbTop: pp? Math.abs(Ed.yInSheet(pbb)-(pp.y+pp.mt))<2 : null}})())"""))
        lo_n = len(pdf_pages(f'{D}/long.pdf'))
        print(f"     pages Plume {r['pages']} / LibreOffice {lo_n} ; coupes en milieu de paragraphe : {r['cuts']}")
        check(abs(r['pages'] - lo_n) <= 1, 'nombre de pages proche de LibreOffice (±1)')
        check(r['cuts'] > 0 and all(s['pAfter'] == s['pBefore'] + 1 for s in r['sides']), 'paragraphes coupés à la ligne sur la page suivante')
        check(r['inMargin'] == 0, 'aucun paragraphe ne commence dans la marge haute')
        check(r['pbbTop'] is True, '« saut de page avant » : paragraphe en haut de page')
        # artefacts jamais enregistrés
        clean = await pg.evaluate("!/data-pl-artifact|--pl-/.test(Ed.cleanHTML()) && Ed.history.every(h=>!/data-pl-artifact|--pl-/.test(h.html))")
        check(clean, 'artefacts et variables d’affichage absents de l’historique et du HTML enregistré')
        await export(pg, 'docx', f'{D}/out_long.docx')
        x = subprocess.run(['unzip', '-p', f'{D}/out_long.docx', 'word/document.xml'], capture_output=True, text=True).stdout
        check('pl-pgjump' not in x and 'keepNext' in x and 'pageBreakBefore' in x and 'widowControl w:val="0"' in x, 'export DOCX : enchaînements conservés, pas d’artefact')
        for fmt in ('odt', 'rtf', 'md', 'txt', 'html'):
            await export(pg, fmt, f'{D}/out_long.{fmt}')
            data = open(f'{D}/out_long.{fmt}', 'rb').read()
            if fmt == 'odt': data = subprocess.run(['unzip', '-p', f'{D}/out_long.odt', 'content.xml'], capture_output=True).stdout
            check(b'pl-pgjump' not in data and b'--pl-' not in data, f'export {fmt.upper()} sans artefact')
        check(await pg.evaluate("Ed.editor.querySelectorAll('[data-pl-artifact]').length") == r['cuts'], 'pagination rétablie après export')

        print('\n3. Saisie fluide dans un paragraphe coupé')
        res = json.loads(await pg.evaluate("""JSON.stringify((()=>{const j=Ed.editor.querySelector('span[data-pl-artifact]');const t=j.nextSibling;window._p=j.parentElement;const r=document.createRange();r.setStart(t,3);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);Ed.lastRange=r.cloneRange();Ed.editor.focus();return {n:window._p.textContent.length}})())"""))
        await pg.keyboard.type('XYZ'); await pg.wait_for_timeout(700)
        c = json.loads(await pg.evaluate("""JSON.stringify((()=>{const s=getSelection(),p=window._p;const r=document.createRange();r.setStart(p,0);r.setEnd(s.anchorNode,s.anchorOffset);return {caret:r.toString().length,xyz:p.textContent.indexOf('XYZ'),arts:p.querySelectorAll('[data-pl-artifact]').length}})())"""))
        check(c['caret'] == c['xyz'] + 3 and c['arts'] >= 1, 'le curseur reste après le texte tapé, la coupe est recalculée')
        await pg.evaluate("""(()=>{const j=window._p.querySelector('span[data-pl-artifact]');const r=document.createRange();r.setStart(j.nextSibling,0);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);})()""")
        n0 = await pg.evaluate("window._p.textContent.length")
        await pg.keyboard.press('Backspace'); await pg.wait_for_timeout(700)
        check(await pg.evaluate("window._p.textContent.length") == n0 - 1, 'Retour arrière en début de ligne coupée : un caractère effacé')
        await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(300)
        check(await pg.evaluate(f"Ed.editor.textContent.includes('XYZ') && [...Ed.editor.querySelectorAll('p')].some(p=>p.textContent.length=={n0})"), 'annuler rétablit le caractère effacé')
        q = await pg.evaluate("""(()=>{const j=Ed.editor.querySelector('span[data-pl-artifact]');const q=(j.previousSibling.data.slice(-8)+j.nextSibling.data.slice(0,6)).trim();return Ed.find(q).length})()""")
        check(q >= 1, 'recherche d’un texte à cheval sur une coupe de page')

        print('\n4. Trois sections : portrait / paysage / portrait deux colonnes')
        await open_doc(pg, f'{D}/sections3.docx')
        s = json.loads(await pg.evaluate("""JSON.stringify({sizes:Ed.pages.map(p=>p.w>p.h?'L':'P'), secs:Ed.sections().length,
          rows:(()=>{const t=Ed.editor.querySelector('table');return t?t.querySelectorAll('tr[data-pl-artifact]').length:0})(),
          cols:(()=>{const ps=[...Ed.editor.children].slice(-8).filter(e=>e.tagName==='P');const xs=ps.map(p=>Math.round(p.getBoundingClientRect().left));return new Set(xs).size})(),
          seps:Ed.pages.reduce((a,p)=>a+p.seps.length,0)})"""))
        print('     pages', ''.join(s['sizes']), '(LibreOffice', ''.join('L' if float(x.split('x')[0]) > float(x.split('x')[1]) else 'P' for x in pdf_pages(f'{D}/sections3.pdf')) + ')')
        check(s['secs'] == 3, 'trois sections importées')
        check(s['sizes'][0] == 'P' and 'L' in s['sizes'] and s['sizes'][-1] == 'P', 'pages paysage au milieu du document')
        check(s['rows'] >= 1, 'tableau coupé entre deux lignes')
        check(s['cols'] == 2 and s['seps'] >= 1, 'section en deux colonnes avec ligne séparatrice')
        await export(pg, 'docx', f'{D}/out_sections3.docx')
        d = Document(f'{D}/out_sections3.docx')
        info = [(x.orientation, x.start_type, (x._sectPr.find(W + 'cols').get(W + 'num') if x._sectPr.find(W + 'cols') is not None else None)) for x in d.sections]
        check(len(d.sections) == 3 and info[1][0] == WD_ORIENT.LANDSCAPE and info[0][0] == info[2][0] == WD_ORIENT.PORTRAIT and info[2][2] == '2', 'export DOCX : 3 sections, orientation et colonnes (python-docx)')
        pdf = lo_pdf(f'{D}/out_sections3.docx')
        check(pdf_pages(pdf) == pdf_pages(f'{D}/sections3.pdf'), 'export relu par LibreOffice : mêmes pages et formats que l’original')
        await export(pg, 'pdf', f'{D}/out_sections3_direct.pdf')
        sz = pdf_pages(f'{D}/out_sections3_direct.pdf')
        check(len(set(sz)) == 2 and len(sz) == len(s['sizes']), 'PDF direct : pages portrait et paysage')
        await export(pg, 'odt', f'{D}/out_sections3_odt.odt')
        pdf = lo_pdf(f'{D}/out_sections3_odt.odt')
        osz = pdf_pages(pdf)
        check(len(set(osz)) == 2, 'export ODT : pages maîtresses portrait et paysage')
        await pg.evaluate("App.setZoom(0.3)"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=f'{D}/capture_sections3.png')

        print('\n5. Colonnes en section continue, colonnes inégales, saut de colonne')
        await open_doc(pg, f'{D}/colonnes.docx')
        c = json.loads(await pg.evaluate("""JSON.stringify((()=>{const secs=Ed.sections();const ps=[...Ed.editor.children];
          const m=Ed.sectMarkers();const i1=ps.indexOf(m[0]),i2=ps.indexOf(m[1]);const mid=ps.slice(i1+1,i2).filter(e=>e.tagName==='P');
          const xs=new Set(mid.map(p=>Math.round(p.getBoundingClientRect().left)));const tops=mid.map(p=>p.getBoundingClientRect().top);
          const cb=Ed.editor.querySelector('hr.pl-colbreak');const after=cb.nextElementSibling;
          return {n:secs.length, xs:xs.size, sameTop:Math.abs(Math.min(...tops)-tops[0])<1, pages:Ed.pageCount, cbX:after.getBoundingClientRect().left>cb.getBoundingClientRect().left+20,
            wide:after.getBoundingClientRect().width>cb.previousElementSibling.getBoundingClientRect().width*1.5}})())"""))
        check(c['n'] == 4 and c['xs'] == 3, 'section continue en trois colonnes')
        check(c['pages'] == len(pdf_pages(f'{D}/colonnes.pdf')), 'même nombre de pages que LibreOffice')
        check(c['cbX'] and c['wide'], 'saut de colonne vers une colonne plus large (colonnes inégales)')
        await export(pg, 'docx', f'{D}/out_colonnes.docx')
        x = subprocess.run(['unzip', '-p', f'{D}/out_colonnes.docx', 'word/document.xml'], capture_output=True, text=True).stdout
        check(x.count('<w:sectPr') == 4 and 'w:type w:val="continuous"' in x and 'w:equalWidth="0"' in x and 'w:type="column"' in x, 'export DOCX : sections continues, colonnes inégales, saut de colonne')

        print('\n6. Ruban : saut de section, orientation et colonnes de la section du curseur')
        await pg.goto(URL); await pg.wait_for_timeout(700)
        await pg.click('#editor'); await pg.keyboard.type('Première section.')
        await pg.evaluate("Ed.sectionBreak('nextPage')"); await pg.keyboard.type('Deuxième section en paysage et deux colonnes.')
        await pg.evaluate("App.setOrientation('landscape'); App.setColumns('2')"); await pg.wait_for_timeout(300)
        g = json.loads(await pg.evaluate("JSON.stringify({p:Ed.pages.map(p=>p.w>p.h?'L':'P').join(''), s:Ed.sections().map(s=>(s.cols||{}).n||1)})"))
        check(g['p'] == 'PL' and g['s'] == [1, 2], 'la section du curseur seule passe en paysage et en deux colonnes')
        await pg.evaluate("Ed.sectionBreak('continuous')"); await pg.wait_for_timeout(200)
        check(await pg.evaluate("Ed.sections().length===3 && Ed.sections()[2].type==='continuous'"), 'saut de section continu inséré')
        await export(pg, 'docx', f'{D}/out_ruban.docx')
        d = Document(f'{D}/out_ruban.docx')
        check(len(d.sections) == 3 and d.sections[1].orientation == WD_ORIENT.LANDSCAPE, 'export DOCX des sections créées dans Plume')
        await pg.evaluate("Ed.undo()"); await pg.wait_for_timeout(200)
        check(await pg.evaluate("Ed.sections().length") == 2, 'annuler retire le saut de section')

        print('\n7. Performances (document de ~50 pages)')
        await open_doc(pg, f'{D}/cinquante.docx')
        ms = await pg.evaluate("(()=>{let t=0;for(let i=0;i<5;i++){Ed._layout();t+=Ed.layoutMs}return t/5})()")
        n = await pg.evaluate("Ed.pageCount")
        print(f'     {n} pages, _layout moyen {ms:.1f} ms (LibreOffice : {len(pdf_pages(f"{D}/cinquante.pdf"))} pages)')
        check(ms < 250, '_layout < 250 ms')

        print('\n8. Console')
        check(not errs, 'aucune erreur console' + (' : ' + '; '.join(errs[:3]) if errs else ''))
        await b.close()
    print(f'\n{len(oks)} réussis, {len(fails)} échecs')
    sys.exit(1 if fails else 0)

asyncio.run(main())
