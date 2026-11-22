# Tests des îlots modifiables : modification dans Plume → export .docx → contrôle XML
# → rendu LibreOffice (PDF) → réimport dans Plume. Aucune erreur console tolérée.
# Usage : python3 tests/ilots.py [dossier_de_travail]   (serveur : python3 -m http.server $PLUME_PORT)
import asyncio, base64, io, os, re, subprocess, sys, zipfile
from lxml import etree
from playwright.async_api import async_playwright

PORT = os.environ.get('PLUME_PORT', '8765')
URL = f'http://localhost:{PORT}/?new=1'
HERE = os.path.dirname(os.path.abspath(__file__))
WD = sys.argv[1] if len(sys.argv) > 1 else '/tmp/plume-ilots'
os.makedirs(WD, exist_ok=True)
subprocess.run([sys.executable, os.path.join(HERE, 'genere_docx_ilots.py'), WD], check=True, stdout=subprocess.DEVNULL)
SRC = os.path.join(WD, 'ilots.docx')

C = '{http://schemas.openxmlformats.org/drawingml/2006/chart}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
fails = []
def check(cond, msg):
    print(('  ok   ' if cond else '  ÉCHEC ') + msg)
    if not cond: fails.append(msg)

# ---------------------------------------------------------------- contrôles du paquet
def verify_package(path):
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    ct = etree.fromstring(z.read('[Content_Types].xml'))
    defaults = {e.get('Extension').lower() for e in ct if e.tag.endswith('Default')}
    overrides = {e.get('PartName').lstrip('/') for e in ct if e.tag.endswith('Override')}
    bad = []
    for n in names:
        if n.endswith('.xml') or n.endswith('.rels'):
            try: etree.fromstring(z.read(n))
            except Exception as e: bad.append(f'{n}: {e}')
        if n not in overrides and n.rsplit('.', 1)[-1].lower() not in defaults: bad.append(f'type de contenu manquant : {n}')
    for o in overrides:
        if o not in names: bad.append(f'Override sans partie : {o}')
    for n in names:
        if not n.endswith('.rels'): continue
        base = n.replace('_rels/', '').rsplit('.rels', 1)[0]
        d = os.path.dirname(base)
        ids = set()
        for r in etree.fromstring(z.read(n)):
            if r.get('Id') in ids: bad.append(f'Id en double {r.get("Id")} dans {n}')
            ids.add(r.get('Id'))
            if r.get('TargetMode') == 'External': continue
            t = os.path.normpath(os.path.join(d, r.get('Target'))).lstrip('/') if not r.get('Target').startswith('/') else r.get('Target')[1:]
            if t not in names: bad.append(f'cible absente {t} ({n})')
    doc = z.read('word/document.xml').decode()
    ids = re.findall(r'<wp:docPr\b[^>]*\bid="(\d+)"', doc)
    if len(ids) != len(set(ids)): bad.append('wp:docPr id en double')
    # références r:* du document → relations existantes
    rel = {r.get('Id') for r in etree.fromstring(z.read('word/_rels/document.xml.rels'))}
    for m in re.findall(r'\br:(?:id|embed|dm|lo|qs|cs|link)="([^"]+)"', doc):
        if m not in rel: bad.append(f'relation inconnue {m} dans document.xml')
    for b in bad: print('     ', b)
    check(not bad, f'paquet valide ({len(names)} parties)')
    return z

def chart_check(z, title, cats, series):
    """Graphique : caches cohérents (ptCount, formules) et classeur incorporé identique."""
    from openpyxl import load_workbook
    found = False
    for n in z.namelist():
        if not re.match(r'word/charts/[^/]+\.xml$', n): continue
        x = etree.fromstring(z.read(n))
        t = ''.join(x.find(f'{C}chart/{C}title').itertext()) if x.find(f'{C}chart/{C}title') is not None else ''
        if t != title: continue
        found = True
        N = len(cats)
        sers = x.findall(f'.//{C}plotArea/*/{C}ser')
        check(len(sers) == len(series), f'{n} : {len(sers)} séries')
        for i, s in enumerate(sers):
            name = s.find(f'{C}tx//{C}v').text
            cat = [p.find(f'{C}v').text for p in s.findall(f'{C}cat//{C}pt')]
            vals = [float(p.find(f'{C}v').text) for p in s.findall(f'{C}val//{C}pt')]
            pc = [int(p.get('val')) for p in s.iter(f'{C}ptCount')]
            fs = [f.text for f in s.iter(f'{C}f')]
            check(name == series[i][0] and cat == cats and vals == series[i][1] and pc == [1, N, N], f'série {i + 1} « {name} » : caches cohérents')
            check(fs[1].endswith(f'$A$2:$A${N + 1}') and fs[2].endswith(f'$2:${chr(66 + i)}${N + 1}'), f'série {i + 1} : formules {fs}')
        rid = x.find(f'{C}externalData').get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        rels = etree.fromstring(z.read(n.replace('charts/', 'charts/_rels/') + '.rels'))
        tgt = [r.get('Target') for r in rels if r.get('Id') == rid][0]
        xl = os.path.normpath(os.path.join('word/charts', tgt))
        ws = load_workbook(io.BytesIO(z.read(xl))).active
        ok = [ws.cell(1, j + 2).value for j in range(len(series))] == [s[0] for s in series] and [str(ws.cell(i + 2, 1).value) for i in range(N)] == cats
        ok = ok and all(float(ws.cell(i + 2, j + 2).value) == series[j][1][i] for j in range(len(series)) for i in range(N))
        check(ok, f'classeur incorporé {xl} identique aux caches')
    check(found, f'graphique « {title} » présent')

def pdf_text(docx):
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', WD, docx], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=180)
    pdf = docx[:-5] + '.pdf'
    subprocess.run(['pdftoppm', '-r', '60', '-png', pdf, pdf[:-4]], check=False)
    return re.sub(r'\s+', ' ', subprocess.run(['pdftotext', pdf, '-'], capture_output=True, text=True).stdout)

# ---------------------------------------------------------------- navigateur
async def open_doc(pg, path):
    data = base64.b64encode(open(path, 'rb').read()).decode()
    await pg.evaluate("""async d=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'in.docx'));}""", data)
    await pg.wait_for_timeout(900)

async def export(pg, path):
    o = await pg.evaluate("""async()=>{const b=await App.buildDocx();const a=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode.apply(null,a.subarray(i,i+32768));return btoa(s);}""")
    open(path, 'wb').write(base64.b64decode(o))

ISL = "[...document.querySelectorAll('#editor .pl-island')].filter(x=>x.dataset.kind==='{k}')[{i}]"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page(viewport={'width': 1440, 'height': 1000})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(700)
        await open_doc(pg, SRC)
        kinds = await pg.evaluate("[...document.querySelectorAll('#editor .pl-island')].map(x=>x.dataset.kind)")
        print('îlots :', kinds)
        check(sorted(kinds) == sorted(['chart', 'textbox', 'shape', 'smartart', 'math', 'math', 'float']), 'îlots importés')

        print('\n[1] Graphique : double-clic → dialogue → données modifiées')
        await pg.evaluate(f"{ISL.format(k='chart', i=0)}.scrollIntoView({{block:'center'}})")
        await pg.locator('#editor .pl-island[data-kind=chart]').first.dblclick()
        await pg.wait_for_selector('.dlg .il-table')
        await pg.fill('.dlg input.il-in[type=text]', 'Visites 2026')
        await pg.locator('.dlg .il-cat').nth(0).fill('Janvier')
        await pg.locator('.dlg .il-num').nth(0).fill('15,5')
        await pg.click('.dlg button:has-text("+ Série")')
        await pg.locator('.dlg .il-sname').nth(2).fill('Bénévoles')
        for i, v in enumerate(['3', '4', '5', '6']): await pg.locator('.dlg .il-num').nth(i * 3 + 2).fill(v)
        await pg.click('.dlg .dlg-f .btn.primary'); await pg.wait_for_timeout(500)
        d = await pg.evaluate(f"Ilots.chartData({ISL.format(k='chart', i=0)}).then(m=>({{t:m.title,c:m.cats,s:m.series}}))")
        check(d['t'] == 'Visites 2026' and d['c'][0] == 'Janvier' and d['s'][0]['vals'][0] == 15.5 and len(d['s']) == 3, 'données lues après modification')
        svg_after = await pg.evaluate(f"{ISL.format(k='chart', i=0)}.innerHTML")
        check('Visites 2026' in svg_after, 'aperçu SVG régénéré')
        await pg.evaluate('Ed.undo()')
        d2 = await pg.evaluate(f"Ilots.chartData({ISL.format(k='chart', i=0)}).then(m=>m.title)")
        check(d2 == 'Activités 2026', 'annuler : graphique d’origine')
        await pg.evaluate('Ed.redo()')
        d3 = await pg.evaluate(f"Ilots.chartData({ISL.format(k='chart', i=0)}).then(m=>m.title)")
        check(d3 == 'Visites 2026', 'rétablir : graphique modifié')

        print('\n[2] Zone de texte et forme')
        await pg.evaluate(f"Ilots.applyShape({ISL.format(k='textbox', i=0)}, {{texts:['Texte modifié Plume\\nDeuxième ligne'], fill:'#FFE699', line:'#0B7A64'}})")
        await pg.evaluate(f"Ilots.applyShape({ISL.format(k='shape', i=0)}, {{fill:'#92D050', line:null}})")
        tb = await pg.evaluate(f"{ISL.format(k='textbox', i=0)}.innerText")
        check('Texte modifié Plume' in tb, 'aperçu de la zone de texte')

        print('\n[3] SmartArt : texte (dessin en cache conservé)')
        await pg.evaluate(f"(async()=>{{const i={ISL.format(k='smartart', i=0)};const n=await Ilots.smartNodes(i);n[1].text='Diagnostic Plume';await Ilots.applySmart(i,n);}})()")
        sm = await pg.evaluate(f"{ISL.format(k='smartart', i=0)}.innerText")
        check('Diagnostic Plume' in sm, 'aperçu SmartArt')

        print('\n[4] Équations : double-clic → éditeur linéaire')
        lin0 = await pg.evaluate(f"Ilots.ommlToLinear(decodeURIComponent(escape(atob({ISL.format(k='math', i=0)}.dataset.x)))).lin")
        check(lin0 == 'a=\\frac{b}{c}+x^2', f'OMML → linéaire : {lin0}')
        await pg.locator('#editor .pl-island[data-kind=math]').first.dblclick()
        await pg.wait_for_selector('.dlg .il-math-in')
        await pg.fill('.dlg .il-math-in', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}')
        await pg.wait_for_timeout(100)
        check(await pg.evaluate("!!document.querySelector('.dlg .il-math-pv math mfrac msqrt')"), 'aperçu MathML en direct')
        await pg.click('.dlg .dlg-f .btn.primary'); await pg.wait_for_timeout(300)
        await pg.evaluate(f"Ilots.applyMath({ISL.format(k='math', i=1)}, '\\\\sum_{{k=1}}^{{n}} k^2 = \\\\frac{{n(n+1)(2n+1)}}{{6}}', true)")
        for s in ['\\int_0^1 f(x) dx', '\\lim_{x\\to 0} \\frac{\\sin x}{x} = 1', '\\sqrt[3]{x} + \\hat{a} + \\alpha_i^2', '\\left| x \\right| \\le 2']:
            rt = await pg.evaluate("s=>Ilots.ommlToLinear(Ilots.linearToOmml(s,false)).lin", s)
            rt2 = await pg.evaluate("s=>Ilots.ommlToLinear(Ilots.linearToOmml(s,false)).lin", rt)
            check(rt == rt2, f'aller-retour stable : {s}  →  {rt}')

        print('\n[5] Image flottante : propriétés et remplacement')
        await pg.evaluate(f"Ilots.applyProps({ISL.format(k='float', i=0)}, {{w:200,h:120,wrap:'topBottom',align:'center'}})")
        await pg.evaluate("""async()=>{const c=document.createElement('canvas');c.width=120;c.height=60;const x=c.getContext('2d');x.fillStyle='#C00000';x.fillRect(0,0,120,60);
            const bl=await new Promise(r=>c.toBlob(r,'image/png'));await Ilots.replaceImage(""" + ISL.format(k='float', i=0) + """, new File([bl],'r.png',{type:'image/png'}));}""")

        print('\n[6] Insertion : graphique et équation neufs')
        await pg.evaluate("(()=>{const p=[...document.querySelectorAll('#editor p')].pop();const r=document.createRange();r.selectNodeContents(p);r.collapse(false);Ed.lastRange=r;})()")
        await pg.evaluate("Ilots.insertChart({title:'Répartition des publics',kind:'pie',cats:['Enfants','Adultes','Seniors'],series:[{name:'Publics',vals:[12,30,18]}]})")
        await pg.evaluate("Ilots.insertMath('E = mc^2', false)")
        n = await pg.evaluate("document.querySelectorAll('#editor .pl-island').length")
        check(n == 9, f'{n} îlots après insertion')
        await pg.evaluate('Ed.undo()')
        check(await pg.evaluate("document.querySelectorAll('#editor .pl-island').length") == 8, 'annuler l’insertion')
        await pg.evaluate('Ed.redo()')

        out = os.path.join(WD, 'ilots-modifie.docx')
        await export(pg, out)

        print('\n[7] Contrôle du .docx exporté')
        z = verify_package(out)
        chart_check(z, 'Visites 2026', ['Janvier', 'T2', 'T3', 'T4'], [('Visites', [15.5, 19, 27, 34]), ('Ateliers', [5, 7, 6, 9]), ('Bénévoles', [3, 4, 5, 6])])
        chart_check(z, 'Répartition des publics', ['Enfants', 'Adultes', 'Seniors'], [('Publics', [12, 30, 18])])
        doc = z.read('word/document.xml').decode()
        ac = re.search(r'<mc:AlternateContent\b(?:(?!</mc:AlternateContent>).)*Texte modifié Plume.*?</mc:AlternateContent>', doc, re.S)
        check(ac and ac.group(0).count('Texte modifié Plume') == 2 and 'FFE699' in ac.group(0) and '#FFE699' in ac.group(0), 'zone de texte : Choice et Fallback cohérents')
        check('92D050' in doc and '#92D050' in doc and 'stroked="f"' in doc, 'forme : remplissage et contour (wps + VML)')
        data = [n for n in z.namelist() if re.match(r'word/diagrams/.*data.*\.xml$', n)]
        dr = [n for n in z.namelist() if re.match(r'word/diagrams/.*drawing.*\.xml$', n)]
        check(len(data) == 1 and 'Diagnostic Plume' in z.read(data[0]).decode(), 'SmartArt : données modifiées')
        check(len(dr) == 1 and 'Diagnostic Plume' in z.read(dr[0]).decode(), 'SmartArt : dessin en cache modifié')
        relid = re.search(r'relId="([^"]+)"', z.read(data[0]).decode()).group(1)
        drel = [r for r in etree.fromstring(z.read('word/_rels/document.xml.rels')) if r.get('Id') == relid]
        check(drel and drel[0].get('Target').endswith(dr[0].split('/')[-1]), 'SmartArt : lien dataModelExt → dessin')
        check('<m:oMathPara' in doc and 'm:rad' in doc and '<m:nary>' in doc, 'équations OMML présentes')
        check(doc.count('<m:oMath') >= 4, 'équation insérée exportée')
        check('wrapTopAndBottom' in re.search(r'<wp:anchor.*?</wp:anchor>', re.sub(r'<mc:AlternateContent\b.*?</mc:AlternateContent>', '', doc, flags=re.S), re.S).group(0), 'image flottante : habillage modifié')
        import docx as pydocx
        pydocx.Document(out); check(True, 'python-docx ouvre le fichier')

        print('\n[8] Rendu LibreOffice')
        txt = pdf_text(out)
        for t in ['Texte modifié Plume', 'Diagnostic Plume', 'Visites 2026', 'Répartition des publics', 'Bénévoles', 'Janvier']:
            check(t in txt, f'PDF contient « {t} »')

        print('\n[9] Réimport dans Plume')
        await pg.goto(URL); await pg.wait_for_timeout(700)
        await open_doc(pg, out)
        kinds2 = await pg.evaluate("[...document.querySelectorAll('#editor .pl-island')].map(x=>x.dataset.kind)")
        check(sorted(kinds2) == sorted(kinds + ['chart', 'math']), f'îlots réimportés : {kinds2}')
        t = await pg.evaluate("Promise.all([...document.querySelectorAll('#editor .pl-island[data-kind=chart]')].map(i=>Ilots.chartData(i).then(m=>m.title+'|'+m.series.length+'|'+m.kind)))")
        check(t == ['Visites 2026|3|col', 'Répartition des publics|1|pie'], f'graphiques réimportés : {t}')
        m = await pg.evaluate("[...document.querySelectorAll('#editor .pl-island[data-kind=math]')].map(i=>Ilots.ommlToLinear(decodeURIComponent(escape(atob(i.dataset.x)))).lin)")
        check(m[0] == 'x=\\frac{-b±\\sqrt{b^2-4ac}}{2a}', f'équation réimportée : {m[0]}')
        s2 = await pg.evaluate(f"Ilots.smartNodes({ISL.format(k='smartart', i=0)}).then(n=>n.map(x=>x.text))")
        check(s2 == ['Accueil', 'Diagnostic Plume', 'Formation'], f'SmartArt réimporté : {s2}')

        print('\n[10] SmartArt : ajout et suppression de nœuds')
        await pg.evaluate(f"(async()=>{{const i={ISL.format(k='smartart', i=0)};const n=await Ilots.smartNodes(i);n.splice(0,1);n.push({{id:null,level:0,text:'Suivi'}});await Ilots.applySmart(i,n);}})()")
        out2 = os.path.join(WD, 'ilots-smartart.docx')
        await export(pg, out2)
        z2 = verify_package(out2)
        dd = [n for n in z2.namelist() if re.match(r'word/diagrams/.*data.*\.xml$', n)][0]
        x = z2.read(dd).decode()
        check('Accueil' not in x and 'Suivi' in x and 'dataModelExt' not in x, 'structure modifiée, dessin en cache abandonné')
        ids = re.findall(r'modelId="([^"]+)"', x)
        check(len(ids) == len(set(ids)), 'identifiants de modèle uniques')
        refs = set(re.findall(r'(?:srcId|destId|presAssocID|parTransId|sibTransId)="([^"]+)"', x))
        check(refs <= set(ids), 'connexions cohérentes (aucune référence orpheline)')
        # rendu : la disposition est recalculée à partir de la définition de mise en page ; celle du générateur
        # est minimale, on utilise donc un vrai SmartArt Word (jeu de tests de LibreOffice) quand il est accessible
        real = os.path.join(WD, 'smartart-word.docx')
        if not os.path.exists(real):
            subprocess.run(['curl', '-sfL', '-o', real, 'https://raw.githubusercontent.com/LibreOffice/core/master/sw/qa/extras/ooxmlexport/data/smartart.docx'], timeout=60)
        if os.path.exists(real) and os.path.getsize(real) > 1000:
            await pg.goto(URL); await pg.wait_for_timeout(700)
            await open_doc(pg, real)
            await pg.evaluate("(async()=>{const i=document.querySelector('#editor .pl-island[data-kind=smartart]');const n=await Ilots.smartNodes(i);n.splice(0,1);n[0].text='Texte Plume';n.push({id:null,level:0,text:'Nouveau nœud'});await Ilots.applySmart(i,n);})()")
            out2b = os.path.join(WD, 'smartart-word-modifie.docx')
            await export(pg, out2b)
            verify_package(out2b)
            txt2 = pdf_text(out2b)
            check('Texte Plume' in txt2 and 'Nouveau nœud' in txt2 and 'Sample' not in txt2, f'LibreOffice recalcule le SmartArt Word modifié : {txt2.strip()[:80]}')
            await pg.goto(URL); await pg.wait_for_timeout(700)
            await open_doc(pg, out2)
        else:
            print('  (SmartArt Word de référence indisponible hors ligne : rendu non vérifié)')

        print('\n[11] Graphique : changement de type')
        await pg.evaluate(f"Ilots.applyChart({ISL.format(k='chart', i=0)}, {{kind:'line'}})")
        await pg.evaluate(f"Ilots.applyChart({ISL.format(k='chart', i=1)}, {{kind:'bar'}})")
        out3 = os.path.join(WD, 'ilots-types.docx')
        await export(pg, out3)
        z3 = verify_package(out3)
        allc = ''.join(z3.read(n).decode() for n in z3.namelist() if re.match(r'word/charts/[^/]+\.xml$', n))
        check('<c:lineChart>' in allc and '<c:barDir val="bar"/>' in allc and allc.count('<c:catAx>') == 2, 'types ligne et barres avec axes')
        pdf_text(out3)

        print('\nErreurs console :', errs)
        check(not errs, 'aucune erreur console')
        await b.close()

asyncio.run(main())
print('\n' + ('TOUS LES TESTS RÉUSSIS' if not fails else f'{len(fails)} ÉCHEC(S)'))
sys.exit(1 if fails else 0)
