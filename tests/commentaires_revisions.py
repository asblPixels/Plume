"""Tests : fils de commentaires (réponses, résolu), suivi des modifications, aller-retour DOCX / ODT.
Usage : python3 tests/commentaires_revisions.py   (serveur Plume sur PLUME_URL, par défaut http://localhost:8765)
Nécessite Playwright + Chrome, python-docx, lxml et LibreOffice (soffice) pour les vérifications croisées.
"""
import asyncio, base64, io, os, re, subprocess, sys, tempfile, zipfile, json
from lxml import etree
from playwright.async_api import async_playwright

URL = os.environ.get('PLUME_URL', 'http://localhost:8765') + '/?new=1'
ICI = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='plume-comm-')
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
W14 = '{http://schemas.microsoft.com/office/word/2010/wordml}'
W15 = '{http://schemas.microsoft.com/office/word/2012/wordml}'
CID = '{http://schemas.microsoft.com/office/word/2016/wordml/cid}'
ok_n = 0; ko = []

def check(cond, msg):
    global ok_n
    if cond: ok_n += 1; print('  ok  ', msg)
    else: ko.append(msg); print('  ÉCHEC', msg)

B64 = """async (fmt)=>{const bl=await Formats.build(fmt, App.exportCtx());const a=new Uint8Array(await bl.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}"""
OPEN = """async ([d,n])=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],n));}"""
THREADS = "Comments.list().map(c=>({a:c.author,t:c.text,done:c.done,r:c.replies.map(r=>[r.author,r.text])}))"
REVS = "Revisions.items().map(i=>[i.kind,Revisions.authorOf(i),i.kind==='pins'||i.kind==='pdel'?'':i.el.textContent])"

async def export(pg, fmt, name):
    data = base64.b64decode(await pg.evaluate(B64, fmt))
    path = os.path.join(TMP, name); open(path, 'wb').write(data); return path

async def open_file(pg, path):
    await pg.evaluate(OPEN, [base64.b64encode(open(path, 'rb').read()).decode(), os.path.basename(path)])
    await pg.wait_for_timeout(900)

def lo_convert(path, to):
    out = os.path.join(TMP, 'lo'); os.makedirs(out, exist_ok=True)
    subprocess.run(['soffice', '--headless', '--convert-to', to, '--outdir', out, path], capture_output=True, timeout=120)
    return os.path.join(out, os.path.splitext(os.path.basename(path))[0] + '.' + to)

def check_docx_comments(path, n_comments, n_replies, n_done):
    z = zipfile.ZipFile(path)
    names = z.namelist()
    for p in ['word/comments.xml', 'word/commentsExtended.xml', 'word/commentsIds.xml', 'word/commentsExtensible.xml', 'word/people.xml']:
        check(p in names, f'partie {p} présente')
    ct = z.read('[Content_Types].xml').decode(); rels = z.read('word/_rels/document.xml.rels').decode()
    for p in ['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible', 'people']:
        check(f'/word/{p}.xml"' in ct and f'Target="{p}.xml"' in rels, f'{p} : Content_Types et relation')
    com = etree.fromstring(z.read('word/comments.xml'))
    cs = com.findall(W + 'comment')
    check(len(cs) == n_comments, f'{n_comments} commentaires dans comments.xml ({len(cs)})')
    pid = {}
    all_para = []
    for c in cs:
        ps = c.findall(W + 'p')
        for p in ps: all_para.append(p.get(W14 + 'paraId'))
        pid[ps[-1].get(W14 + 'paraId')] = c.get(W + 'id')
    check(all(re.fullmatch(r'[0-9A-F]{8}', x or '') and int(x, 16) < 0x80000000 for x in all_para), 'paraId : 8 hex < 0x80000000')
    check(len(set(all_para)) == len(all_para), 'paraId uniques')
    ex = etree.fromstring(z.read('word/commentsExtended.xml')).findall(W15 + 'commentEx')
    check(len(ex) == n_comments and all(e.get(W15 + 'paraId') in pid for e in ex), 'commentsExtended relié aux paraId des commentaires')
    check(sum(1 for e in ex if e.get(W15 + 'paraIdParent')) == n_replies, f'{n_replies} réponses (paraIdParent)')
    check(all(e.get(W15 + 'paraIdParent') in pid for e in ex if e.get(W15 + 'paraIdParent')), 'paraIdParent pointe vers un commentaire')
    check(sum(1 for e in ex if e.get(W15 + 'done') == '1' and not e.get(W15 + 'paraIdParent')) == n_done, f'{n_done} fil(s) résolu(s)')
    ids = etree.fromstring(z.read('word/commentsIds.xml')).findall(CID + 'commentId')
    dur = [i.get(CID + 'durableId') for i in ids]
    check(len(ids) == n_comments and len(set(dur)) == len(dur) and all(int(d, 16) < 0x80000000 for d in dur), 'durableId uniques et valides')
    doc = z.read('word/document.xml').decode()
    for c in cs:
        i = c.get(W + 'id')
        check(f'<w:commentRangeStart w:id="{i}"/>' in doc and f'<w:commentRangeEnd w:id="{i}"/>' in doc and f'<w:commentReference w:id="{i}"/>' in doc, f'commentaire {i} : plage + référence dans document.xml')
    import docx
    d = docx.Document(path)
    check(len(d.paragraphs) > 0, 'python-docx ouvre le fichier')

def check_docx_revisions(path, authors):
    z = zipfile.ZipFile(path)
    doc = etree.fromstring(z.read('word/document.xml'))
    revs = [e for e in doc.iter() if e.tag in (W + 'ins', W + 'del', W + 'rPrChange')]
    ids = [e.get(W + 'id') for e in revs]
    check(len(ids) == len(set(ids)) and all(ids), f'w:id de révision uniques ({len(ids)})')
    check(all(e.get(W + 'author') and e.get(W + 'date') for e in revs), 'w:author et w:date présents')
    check(set(e.get(W + 'author') for e in revs) == set(authors), f'auteurs des révisions = {sorted(authors)}')
    dels = [e for e in doc.iter(W + 'del') if e.getparent().tag != W + 'rPr']
    check(all(not d.findall('.//' + W + 't') and d.findall('.//' + W + 'delText') for d in dels), 'texte supprimé en w:delText')
    check(not any(r.find(W + 'rPr') is not None and r.find(W + 'rPr').find(W + 'color') is not None for e in doc.iter(W + 'ins', W + 'del') for r in e.iter(W + 'r')), 'pas de couleur d’affichage exportée dans les révisions')
    return doc

async def main():
    subprocess.run([sys.executable, os.path.join(ICI, 'genere_docx_commentaires.py'), os.path.join(TMP, 'fil.docx')], check=True, capture_output=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        pg = await ctx.new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(700)

        print('\n== 1. Import d’un .docx Word 365 (fil + réponses + résolu + révisions de 2 auteurs)')
        await open_file(pg, os.path.join(TMP, 'fil.docx'))
        th = await pg.evaluate(THREADS)
        check(len(th) == 2, '2 fils')
        check([r[0] for r in th[0]['r']] == ['Roxane Godart', 'Stéphane Quain'], 'fil 1 : 2 réponses dans l’ordre')
        check(th[0]['t'].startswith('Ce montant') and '\n' in th[0]['t'], 'texte multi-paragraphe du commentaire')
        check(not th[0]['done'] and th[1]['done'], 'état résolu importé')
        check(await pg.evaluate("Ed.editor.querySelectorAll('.pl-cstart').length") == 2, 'les réponses partagent la plage du parent (2 plages)')
        check(await pg.evaluate("[...Ed.editor.querySelectorAll('.pl-cref[data-parent]')].every(x=>getComputedStyle(x).display==='none')"), 'icônes des réponses masquées')
        revs = await pg.evaluate(REVS)
        check([r[0] for r in revs] == ['ins', 'del', 'ins', 'pins'], f'révisions importées (¶ en fin de paragraphe) {revs}')
        check({r[1] for r in revs} == {'Roxane Godart', 'Stéphane Quain'}, 'auteurs des révisions')
        check(await pg.evaluate("getComputedStyle(Ed.editor.querySelector('.pl-ins')).color !== getComputedStyle(Ed.editor.querySelector('.pl-del')).color"), 'couleur différente par auteur')
        await pg.evaluate("App.openNav('comments')"); await pg.wait_for_timeout(400)
        check(await pg.evaluate("document.querySelectorAll('#npBody .np-thread').length") == 2, 'volet : 2 fils')
        check(await pg.evaluate("document.querySelectorAll('#npBody .np-comment.reply').length") == 2, 'volet : réponses indentées')
        check(await pg.evaluate("!!document.querySelector('#npBody .np-thread.done.folded')"), 'volet : fil résolu grisé et replié')
        await pg.click('#npBody .np-thread.done .np-fold'); await pg.wait_for_timeout(300)
        check(await pg.evaluate("!document.querySelector('#npBody .np-thread.done.folded')"), 'fil résolu dépliable')
        labels = await pg.evaluate("[...document.querySelectorAll('#npBody .np-thread')].map(t=>[...t.querySelectorAll(':scope > .acts button')].map(b=>b.textContent))")
        check(labels[0] == ['Répondre', 'Résoudre', 'Supprimer le fil'] and labels[1] == ['Rouvrir', 'Supprimer le fil'], f'boutons {labels}')
        await pg.screenshot(path=os.path.join(TMP, 'volet.png'))

        print('\n== 2. Export DOCX des fils (commentsExtended, commentsIds, commentsExtensible)')
        out1 = await export(pg, 'docx', 'fil_plume.docx')
        check_docx_comments(out1, 4, 2, 1)
        check_docx_revisions(out1, ['Roxane Godart', 'Stéphane Quain'])
        d = etree.fromstring(zipfile.ZipFile(out1).read('word/document.xml'))
        check(any(e.getparent().tag == W + 'rPr' and e.getparent().getparent().tag == W + 'pPr' for e in d.iter(W + 'ins')), 'marque de paragraphe insérée (w:pPr/w:rPr/w:ins)')

        print('\n== 3. LibreOffice relit les fils et les révisions')
        odt = lo_convert(out1, 'odt')
        cx = zipfile.ZipFile(odt).read('content.xml').decode()
        check(cx.count('loext:parent-name') == 2, 'LibreOffice : 2 réponses reliées au parent')
        check('loext:resolved="true"' in cx, 'LibreOffice : fil résolu')
        check('Roxane Godart' in cx and 'Stéphane Quain' in cx and cx.count('<text:changed-region') >= 3, 'LibreOffice : révisions attribuées')

        print('\n== 4. Réimport du DOCX exporté : identique')
        await open_file(pg, out1)
        check(await pg.evaluate(THREADS) == th, 'fils identiques après aller-retour')
        check(await pg.evaluate(REVS) == revs, 'révisions identiques après aller-retour')

        print('\n== 5. Répondre, résoudre, rouvrir, supprimer, naviguer')
        cid0 = await pg.evaluate("Comments.list()[0].cid")
        await pg.evaluate(f"Comments.reply('{cid0}', 'Troisième réponse')")
        check(len((await pg.evaluate(THREADS))[0]['r']) == 3, 'réponse ajoutée au fil')
        await pg.evaluate(f"Comments.resolve('{cid0}')")
        check(all(t['done'] for t in await pg.evaluate(THREADS)), 'fil résolu')
        cid1 = await pg.evaluate("Comments.list()[1].cid")
        await pg.evaluate(f"Comments.resolve('{cid1}', false)")
        check(not (await pg.evaluate(THREADS))[1]['done'], 'fil rouvert')
        rid = await pg.evaluate("Comments.list()[0].replies[0].cid")
        await pg.evaluate(f"Comments.remove('{rid}')")
        check(len((await pg.evaluate(THREADS))[0]['r']) == 2 and len(await pg.evaluate(THREADS)) == 2, 'suppression d’une réponse seule')
        await pg.evaluate("(()=>{const r=document.createRange();r.setStart(Ed.editor.firstChild,0);r.collapse(true);Ed.selectRange(r)})()")
        n1 = await pg.evaluate("Comments.move(1)"); n2 = await pg.evaluate("Comments.move(1)"); n3 = await pg.evaluate("Comments.move(-1)")
        check([n1, n2, n3] == [cid0, cid1, cid0], f'navigation suivant/précédent {[n1, n2, n3]}')
        out2 = await export(pg, 'docx', 'fil_modifie.docx')
        check_docx_comments(out2, 4, 2, 1)
        await pg.evaluate(f"Comments.remove('{cid0}')")
        check(len(await pg.evaluate(THREADS)) == 1 and await pg.evaluate("Ed.editor.querySelectorAll('.pl-cref').length") == 1, 'suppression du fil entier')

        print('\n== 6. ODT : réponses et état résolu')
        await open_file(pg, out2)
        th2 = await pg.evaluate(THREADS)
        o = await export(pg, 'odt', 'fil.odt')
        cx = zipfile.ZipFile(o).read('content.xml').decode()
        check(cx.count('loext:parent-name') == 2 and 'loext:resolved="true"' in cx, 'ODT : loext:parent-name et loext:resolved')
        await open_file(pg, o)
        check(await pg.evaluate(THREADS) == th2, 'ODT relu par Plume : fils identiques')
        # LibreOffice relit l'ODT de Plume (réenregistré en .fodt) : fils et état résolu reconnus
        fx = open(lo_convert(o, 'fodt'), encoding='utf-8').read()
        check(fx.count('loext:parent-name') == 2 and 'loext:resolved="true"' in fx, 'ODT Plume relu par LibreOffice : fils conservés')

        print('\n== 7. Enregistrement des révisions (saisie, suppressions, sélection, collage, Entrée, mise en forme)')
        await pg.goto(URL); await pg.wait_for_timeout(700)
        await pg.evaluate("App.setUser('Mehdy Sghaiar')")
        await pg.click('#editor'); k = pg.keyboard
        await k.type('Le budget est voté.'); await k.press('Enter'); await k.type('Deuxième paragraphe.')
        await pg.evaluate("Track.toggle()")
        await k.press('Control+Home'); await k.press('End'); await k.press('ArrowLeft')
        await k.type(' ce soir')
        check(await pg.evaluate("Ed.editor.querySelector('.pl-ins').textContent") == ' ce soir', 'saisie marquée insérée')
        await k.press('Backspace'); await k.press('Backspace')
        check(await pg.evaluate("Ed.editor.querySelector('.pl-ins').textContent") == ' ce so', 'retour arrière dans sa propre insertion : retrait réel')
        await k.press('Home'); await k.press('Delete'); await k.press('Delete'); await k.press('Delete')
        check(await pg.evaluate("Ed.editor.querySelector('.pl-del').textContent") == 'Le ', 'Suppr : texte barré')
        await k.press('Delete')
        check(await pg.evaluate("Ed.editor.querySelector('.pl-del').textContent") == 'Le b', 'Suppr passe par-dessus le texte déjà supprimé')
        await k.press('End'); await k.press('Control+Backspace')
        dels = await pg.evaluate("[...Ed.editor.querySelectorAll('.pl-del')].map(x=>x.textContent)")
        check(dels[-1] == '.', f'Ctrl+Retour arrière (mot) {dels}')
        await pg.evaluate("App.setUser('Roxane Godart')")
        await pg.evaluate("(()=>{const t=[...Ed.editor.querySelectorAll('p')][1].firstChild;const r=document.createRange();r.setStart(t,0);r.setEnd(t,8);Ed.selectRange(r)})()")
        await k.type('Second')
        p2 = await pg.evaluate("[...Ed.editor.querySelectorAll('p')][1].innerHTML.replace(/ data-[a-z-]+=\"[^\"]*\"/g,'').replace(/ contenteditable=\"false\"/g,'')")
        check(p2.startswith('<span class="pl-del">Deuxième</span><span class="pl-ins">Second</span>'), f'remplacement de sélection : suppression puis insertion ({p2[:90]})')
        await pg.evaluate("navigator.clipboard.writeText(' (collé)')"); await k.press('Control+v')
        check(await pg.evaluate("[...Ed.editor.querySelectorAll('.pl-ins')].some(x=>x.textContent==='Second (collé)')"), 'collage marqué inséré')
        await k.press('End'); await k.press('Enter'); await k.type('Nouveau paragraphe.')
        check(await pg.evaluate("[...Ed.editor.querySelectorAll('p')][1].dataset.pinsAuthor") == 'Roxane Godart', 'Entrée : marque de paragraphe insérée')
        check(await pg.evaluate("[...Ed.editor.querySelectorAll('p')][2].querySelector('.pl-ins').textContent") == 'Nouveau paragraphe.', 'texte du nouveau paragraphe marqué inséré')
        check(await pg.evaluate("!/<br>/.test([...Ed.editor.querySelectorAll('p')][2].innerHTML)"), 'pas de saut de ligne parasite')
        # retour arrière au début du 2e paragraphe : marque de paragraphe d'origine supprimée
        await pg.evaluate("(()=>{const p=[...Ed.editor.querySelectorAll('p')][1];const r=document.createRange();r.setStart(p,0);r.collapse(true);Ed.selectRange(r)})()")
        await k.press('Backspace')
        check(await pg.evaluate("Ed.editor.querySelector('p').dataset.pdelAuthor") == 'Roxane Godart', 'retour arrière en début de paragraphe : ¶ supprimé (suivi)')
        # mise en forme suivie
        await pg.evaluate("(()=>{const t=[...Ed.editor.querySelector('p').childNodes].find(n=>n.nodeType===3&&n.data.includes('udget'));const r=document.createRange();r.setStart(t,t.data.indexOf('udget'));r.setEnd(t,t.data.indexOf('udget')+5);Ed.selectRange(r)})()")
        await pg.evaluate("Ed.exec('bold')")
        fmt = await pg.evaluate("(()=>{const f=Ed.editor.querySelector('.pl-fmt');return f&&[f.textContent,f.dataset.old,getComputedStyle(f.firstChild.nodeType===3?f:f.firstElementChild).fontWeight]})()")
        check(fmt and fmt[0] == 'udget' and json.loads(fmt[1])['b'] is False and int(fmt[2]) >= 600, f'gras suivi (pl-fmt) {fmt}')
        await pg.evaluate("Revisions.colorize()")
        check(await pg.evaluate("new Set([...Ed.editor.querySelectorAll('[data-rc]')].map(x=>x.dataset.rc)).size") == 2, 'deux auteurs, deux couleurs')
        html_before = await pg.evaluate("Ed.editor.innerHTML.replace(/ data-[a-z-]*rc=\"\\d\"/g,'')")
        revs_before = await pg.evaluate(REVS)
        print('     révisions :', revs_before)

        print('\n== 8. Affichages : Toutes / Simples / Aucune / Original')
        disp = "[getComputedStyle(Ed.editor.querySelector('.pl-del')).display, getComputedStyle(Ed.editor.querySelector('.pl-ins')).display, getComputedStyle(Ed.editor.querySelector('.pl-ins')).textDecorationLine]"
        for v, exp in [('all', ['inline', 'inline', 'underline']), ('simple', ['none', 'inline', 'none']), ('none', ['none', 'inline', 'none']), ('original', ['inline', 'none', 'underline'])]:
            await pg.evaluate(f"Revisions.setView('{v}')")
            got = await pg.evaluate(disp)
            check(got == exp, f'affichage {v} {got}')
        check(await pg.evaluate("Revisions.setView('simple'), getComputedStyle(Ed.editor.querySelector('p'),'::before').content") == '""', 'marques simples : barre dans la marge')
        await pg.evaluate("Revisions.setView('all')")

        print('\n== 9. Export DOCX des révisions → python-docx / LibreOffice → réimport')
        out3 = await export(pg, 'docx', 'revisions.docx')
        doc = check_docx_revisions(out3, ['Mehdy Sghaiar', 'Roxane Godart'])
        check(any(e.getparent().tag == W + 'rPr' and e.getparent().getparent().tag == W + 'pPr' for e in doc.iter(W + 'ins')), 'export : ¶ inséré')
        check(any(e.getparent().tag == W + 'rPr' and e.getparent().getparent().tag == W + 'pPr' for e in doc.iter(W + 'del')), 'export : ¶ supprimé')
        rc = list(doc.iter(W + 'rPrChange'))
        check(len(rc) >= 1 and rc[0].find(W + 'rPr') is not None and rc[0].find(W + 'rPr').find(W + 'b') is None and rc[0].getparent().find(W + 'b') is not None, 'export : w:rPrChange (ancien non gras, nouveau gras)')
        import docx
        dd = docx.Document(out3)
        check(len(dd.paragraphs) >= 3, 'python-docx ouvre le document révisé')
        lodt = lo_convert(out3, 'odt')
        cx = zipfile.ZipFile(lodt).read('content.xml').decode()
        regs = re.findall(r'<text:changed-region.*?</text:changed-region>', cx, re.S)
        check(any('<text:insertion>' in r and 'Mehdy Sghaiar' in r for r in regs) and any('<text:deletion>' in r and 'Roxane Godart' in r for r in regs), f'LibreOffice : {len(regs)} révisions attribuées')
        check(any('<text:format-change' in r for r in regs), 'LibreOffice : changement de mise en forme reconnu')
        await open_file(pg, out3)
        revs_after = await pg.evaluate(REVS)
        check(revs_after == revs_before, f'réimport identique ({len(revs_after)} révisions)')

        print('\n== 10. Accepter / refuser (une, toutes, suivante, précédente)')
        n = len(revs_after)
        await pg.evaluate("(()=>{const r=document.createRange();r.setStart(Ed.editor.firstChild,0);r.collapse(true);Ed.selectRange(r)})()")
        first = await pg.evaluate("(()=>{const i=Revisions.move(1);return [i.kind, i.el.textContent]})()")
        check(first == [revs_after[0][0], revs_after[0][2]], f'révision suivante = première {first}')
        sec = await pg.evaluate("(()=>{const i=Revisions.move(1);return i.kind})()")
        back = await pg.evaluate("(()=>{const i=Revisions.move(-1);return [i.kind, i.el.textContent]})()")
        check(back == first, f'révision précédente {back}')
        await pg.evaluate("Revisions.current(true)")
        check(len(await pg.evaluate(REVS)) == n - 1 and 'Le ' not in await pg.evaluate("Ed.editor.textContent.slice(0,3)"), 'accepter la suppression courante')
        await pg.evaluate("Revisions.current(false)")
        check(len(await pg.evaluate(REVS)) == n - 2, 'refuser la suivante')
        await pg.evaluate("Revisions.apply(false)")
        check(await pg.evaluate("Revisions.count()") == 0, 'refuser tout')
        txt = await pg.evaluate("[...Ed.editor.querySelectorAll('p')].map(p=>p.textContent)")
        check(txt == ['udget est voté.', 'Deuxième paragraphe.'], f'texte d’origine retrouvé (sauf la suppression acceptée) {txt}')
        fw = await pg.evaluate("(()=>{const p=Ed.editor.querySelector('p');const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n,o=[];while((n=w.nextNode()))o.push(getComputedStyle(n.parentElement).fontWeight);return [o, p.innerHTML]})()")
        check(all(int(x) < 600 for x in fw[0]), f'refus du gras : mise en forme d’origine {fw}')
        await open_file(pg, out3)
        await pg.evaluate("Revisions.apply(true)")
        txt = await pg.evaluate("[...Ed.editor.querySelectorAll('p')].map(p=>p.textContent)")
        check(len(txt) == 2 and txt[0].startswith('udget est voté ce so') and txt[1] == 'Nouveau paragraphe.', f'tout accepter {txt}')
        check(await pg.evaluate("Revisions.count()") == 0, 'plus aucune révision')

        print('\n== 11. Commentaires classiques et impression avec / sans marques')
        await pg.goto(URL); await pg.wait_for_timeout(700)
        await pg.click('#editor'); await k.type('Un texte à commenter ici.')
        await pg.evaluate("(()=>{const t=Ed.editor.querySelector('p').firstChild;const r=document.createRange();r.setStart(t,3);r.setEnd(t,8);Ed.selectRange(r)})()")
        c1 = await pg.evaluate("Comments.add('Premier')")
        check(await pg.evaluate("Comments.list().length") == 1 and await pg.evaluate("Comments.range(Comments.list()[0].cid).toString()") == 'texte', 'ajout d’un commentaire sur la sélection')
        await pg.evaluate(f"Comments.reply('{c1}','Réponse')")
        await pg.evaluate("App.printMarkup=true; App.preparePrintComments()")
        pc = await pg.evaluate("document.getElementById('printComments').innerText")
        check('Premier' in pc and 'Réponse' in pc and document_class(await pg.evaluate("document.body.className"), 'print-markup'), 'impression avec commentaires : liste en fin de document')
        await pg.emulate_media(media='print')
        aft = await pg.evaluate("getComputedStyle(Ed.editor.querySelector('.pl-cref'),'::after').content")
        check(aft.startswith('"[1') or 'attr' in aft, f'impression : renvoi numéroté {aft}')
        await pg.evaluate("App.endPrint(); App.printMarkup=false; App.preparePrintComments()")
        check(await pg.evaluate("getComputedStyle(Ed.editor.querySelector('.pl-cref')).display") == 'none' and await pg.evaluate("document.getElementById('printComments').innerText") == '', 'impression sans commentaires')
        await pg.evaluate("App.endPrint()"); await pg.emulate_media(media='screen')
        await pg.evaluate(f"Comments.remove('{c1}')")
        check(await pg.evaluate("Ed.editor.querySelectorAll('.pl-cref,.pl-cstart,.pl-cend').length") == 0, 'suppression du commentaire et de ses réponses')
        await pg.evaluate("(()=>{const t=Ed.editor.querySelector('p').firstChild;const r=document.createRange();r.setStart(t,0);r.setEnd(t,2);Ed.selectRange(r)})()")
        await pg.evaluate("Comments.add('A')")
        await pg.evaluate("Comments.removeAll()")
        check(await pg.evaluate("Comments.list().length") == 0, 'supprimer tous les commentaires')
        for t in ['revision', 'accueil']:
            await pg.click(f'[data-tab={t}]'); await pg.wait_for_timeout(100)
        await pg.click('[data-tab=revision]'); await pg.click('[data-cmd=revView]'); await pg.wait_for_timeout(150)
        check(await pg.evaluate("document.querySelectorAll('.menu.open .mi').length") == 4, 'menu Affichage des marques (4 choix)')
        await pg.keyboard.press('Escape')

        check(not errs, f'aucune erreur console {errs}')
        await b.close()
    print(f'\n{ok_n} vérifications réussies, {len(ko)} échec(s)')
    for m in ko: print('  ÉCHEC :', m)
    print('Fichiers :', TMP)
    sys.exit(1 if ko else 0)

def document_class(cls, c): return c in cls.split()

asyncio.run(main())
