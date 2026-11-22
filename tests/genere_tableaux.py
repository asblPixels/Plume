# Génère les documents de test des styles de tableau, des macros (.docm/.dotm/.dotx)
# et des anciens .doc (via LibreOffice).
# Usage : python3 tests/genere_tableaux.py [dossier]   (défaut : /home/claude/test/tab)
import os, sys, re, zipfile, shutil, subprocess
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from docx.enum.text import WD_BREAK

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/test/tab'
os.makedirs(OUT, exist_ok=True)
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

DATA = [['Produit', 'T1', 'T2', 'Total'], ['Pommes', '12', '15', '27'], ['Poires', '8', '11', '19'],
        ['Cerises', '20', '18', '38'], ['Prunes', '5', '9', '14'], ['Total', '45', '53', '98']]

# Style Word 2013 « Grid Table 4 Accent 1 » : couleurs uniquement en thème (sans valeur de repli)
# pour vérifier la résolution des couleurs de thème (themeColor / themeTint / themeFill).
def bdr(tag, val='single', sz=4, theme='accent1', tint=None):
    t = f' w:themeTint="{tint}"' if tint else ''
    return f'<w:{tag} w:val="{val}" w:sz="{sz}" w:space="0" w:themeColor="{theme}"{t}/>'
GRID4 = (f'<w:style {W} w:type="table" w:styleId="GridTable4-Accent1"><w:name w:val="Grid Table 4 Accent 1"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="49"/>'
         '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
         '<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblStyleColBandSize w:val="1"/><w:tblBorders>'
         + ''.join(bdr(s, tint='99') for s in ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) +
         '</w:tblBorders></w:tblPr>'
         '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/><w:color w:val="FFFFFF" w:themeColor="background1"/></w:rPr><w:tblPr/><w:tcPr><w:tcBorders>'
         + ''.join(bdr(s) for s in ['top', 'left', 'bottom', 'right']) + '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tcBorders>'
         '<w:shd w:val="clear" w:color="auto" w:themeFill="accent1"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="lastRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tblPr/><w:tcPr><w:tcBorders>' + bdr('top', 'double') + '</w:tcBorders></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="firstCol"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr>'
         '<w:tblStylePr w:type="lastCol"><w:rPr><w:b/><w:bCs/></w:rPr></w:tblStylePr>'
         '<w:tblStylePr w:type="band1Vert"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:themeFill="accent1" w:themeFillTint="33"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="band1Horz"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:themeFill="accent1" w:themeFillTint="33"/></w:tcPr></w:tblStylePr>'
         '</w:style>')
# Style personnalisé hérité (basedOn) + coins : vérifie l'ordre de priorité
COINS = (f'<w:style {W} w:type="table" w:customStyle="1" w:styleId="PlumeTestCoins"><w:name w:val="Plume Test Coins"/><w:basedOn w:val="LightGrid-Accent1"/>'
         '<w:tblStylePr w:type="firstRow"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="BFBFBF"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="lastRow"><w:rPr><w:i/></w:rPr><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="nwCell"><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="C00000"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="neCell"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="00B050"/></w:tcPr></w:tblStylePr>'
         '<w:tblStylePr w:type="seCell"><w:tblPr/><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="0070C0"/></w:tcPr></w:tblStylePr>'
         '</w:style>')


def table(d, style, look=None, title=None, rows=DATA):
    if title: d.add_paragraph(title, style='Heading 2')
    t = d.add_table(rows=len(rows), cols=len(rows[0]))
    if style: t.style = d.styles[style] if style in [s.name for s in d.styles] else None
    for r, row in enumerate(rows):
        for c, v in enumerate(row): t.cell(r, c).text = v
    if look is not None:
        tblPr = t._tbl.tblPr
        old = tblPr.find(qn('w:tblLook'))
        if old is not None: tblPr.remove(old)
        tblPr.append(parse_xml(f'<w:tblLook {W} {look}/>'))
    d.add_paragraph()
    return t


def set_style_id(t, sid):
    tblPr = t._tbl.tblPr
    st = tblPr.find(qn('w:tblStyle'))
    if st is None:
        st = parse_xml(f'<w:tblStyle {W} w:val="{sid}"/>'); tblPr.insert(0, st)
    st.set(qn('w:val'), sid)


def tableaux():
    d = Document()
    styles = d.styles.element
    styles.append(parse_xml(GRID4)); styles.append(parse_xml(COINS))
    d.add_heading('Styles de tableau', 1)
    table(d, 'Table Grid', title='Table Grid')
    table(d, 'Light Grid Accent 1', title='Light Grid Accent 1 (en-tête + 1re colonne + bandes)')
    table(d, 'Medium Shading 1 Accent 1', 'w:val="05E0" w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="1" w:noHBand="0" w:noVBand="1"', 'Medium Shading 1 Accent 1 (totaux + dernière colonne)')
    table(d, 'Light List Accent 2', 'w:val="04E0"', 'Light List Accent 2 (ancien w:val hexa 04E0)')
    t = table(d, 'Light Shading Accent 3', title='Light Shading Accent 3 + mise en forme directe')
    t.cell(2, 1)._tc.get_or_add_tcPr().append(parse_xml(f'<w:shd {W} w:val="clear" w:color="auto" w:fill="FFFF00"/>'))
    r = t.cell(3, 2).paragraphs[0].runs[0]; r.font.color.rgb = RGBColor(0xC0, 0, 0); r.bold = True
    t = table(d, 'Medium Grid 3 Accent 2', title='Medium Grid 3 Accent 2 (bandes de 2 lignes)')
    t._tbl.tblPr.append(parse_xml(f'<w:tblStyleRowBandSize {W} w:val="2"/>'))
    t = table(d, None, 'w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="0"', 'Grid Table 4 Accent 1 (couleurs de thème, bandes verticales)')
    set_style_id(t, 'GridTable4-Accent1')
    t = table(d, None, 'w:val="01E0" w:firstRow="1" w:lastRow="1" w:firstColumn="1" w:lastColumn="1" w:noHBand="0" w:noVBand="1"', 'Style hérité + coins (nwCell, neCell, seCell)')
    set_style_id(t, 'PlumeTestCoins')
    table(d, 'Colorful List Accent 6', title='Colorful List Accent 6')
    p = os.path.join(OUT, 'tableaux.docx'); d.save(p)
    # vérification : les styles intégrés utilisés sont bien définis dans styles.xml
    with zipfile.ZipFile(p) as z:
        sx = z.read('word/styles.xml').decode()
        dx = z.read('word/document.xml').decode()
    used = sorted(set(re.findall(r'<w:tblStyle w:val="([^"]+)"', dx)))
    missing = [u for u in used if f'w:styleId="{u}"' not in sx]
    print('styles utilisés', used, 'manquants', missing)
    assert not missing
    return p


def macros(src):
    """.docm / .dotm / .dotx à partir d'un .docx (projet VBA factice mais structurellement complet)"""
    out = {}
    vba = bytes([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) + bytes(range(256)) * 8   # contenu opaque conservé tel quel
    vbadata = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<wne:vbaSuppData xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"><wne:mcds><wne:mcd wne:macroName="PROJECT.NEWMACROS.BONJOUR" wne:name="Project.NewMacros.Bonjour" wne:bEncrypt="00" wne:cmg="56"/></wne:mcds></wne:vbaSuppData>'
    MAIN = {'docm': 'application/vnd.ms-word.document.macroEnabled.main+xml', 'dotm': 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
            'dotx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'}
    for kind in ['docm', 'dotm', 'dotx']:
        p = os.path.join(OUT, f'macros.{kind}' if kind != 'dotx' else 'modele.dotx')
        with zipfile.ZipFile(src) as zi, zipfile.ZipFile(p, 'w', zipfile.ZIP_DEFLATED) as zo:
            for it in zi.infolist():
                data = zi.read(it.filename)
                if it.filename == '[Content_Types].xml':
                    s = data.decode().replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', MAIN[kind])
                    if kind != 'dotx':
                        s = s.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/><Override PartName="/word/vbaData.xml" ContentType="application/vnd.ms-word.vbaData+xml"/></Types>')
                    data = s.encode()
                if it.filename == 'word/_rels/document.xml.rels' and kind != 'dotx':
                    data = data.decode().replace('</Relationships>', '<Relationship Id="rIdVba1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>').encode()
                zo.writestr(it, data)
            if kind != 'dotx':
                zo.writestr('word/vbaProject.bin', vba)
                zo.writestr('word/vbaData.xml', vbadata)
                zo.writestr('word/_rels/vbaProject.bin.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/wordVbaData" Target="vbaData.xml"/></Relationships>')
        out[kind] = p
    return out


def riche_pour_doc():
    """.docx riche converti en .doc : titres, gras/italique/tailles, tableau, saut de page, caractères spéciaux"""
    d = Document()
    d.add_heading('Rapport ancien format', 1)
    p = d.add_paragraph('Texte normal, ')
    p.add_run('gras').bold = True; p.add_run(', ')
    p.add_run('italique').italic = True; p.add_run(', ')
    r = p.add_run('grand 18 pt'); r.font.size = Pt(18)
    p.add_run(' et '); r = p.add_run('gras italique'); r.bold = True; r.italic = True; p.add_run('.')
    d.add_paragraph('Caractères spéciaux : « guillemets », l’apostrophe, 50 €, œuvre, Ÿ, — tiret, … points.')
    d.add_heading('Section deux', 2)
    t = d.add_table(rows=3, cols=3); t.style = d.styles['Table Grid']
    for r_, row in enumerate([['Nom', 'Ville', 'Âge'], ['Ana', 'Mons', '30'], ['Léo', 'Boussu', '41']]):
        for c, v in enumerate(row): t.cell(r_, c).text = v
    d.add_paragraph('Après le tableau.')
    d.paragraphs[-1].add_run().add_break(WD_BREAK.PAGE)
    d.add_paragraph('Deuxième page.')
    d.add_heading('Titre trois', 3)
    p = os.path.join(OUT, 'ancien.docx'); d.save(p)
    # texte hors cp1252 (grec, polonais) → pièces UTF-16 dans le .doc
    d2 = Document()
    d2.add_heading('Unicode', 1)
    d2.add_paragraph('Zażółć gęślą jaźń — Ελληνικά — Привет.')
    d2.add_paragraph('Fin.')
    p2 = os.path.join(OUT, 'unicode.docx'); d2.save(p2)
    return [p, p2]


def to_doc(paths):
    subprocess.run(['soffice', '-env:UserInstallation=file:///tmp/wt-tab-lo', '--headless', '--convert-to', 'doc:MS Word 97', '--outdir', OUT, *paths], check=True, capture_output=True)


def to_pdf(paths):
    subprocess.run(['soffice', '-env:UserInstallation=file:///tmp/wt-tab-lo', '--headless', '--convert-to', 'pdf', '--outdir', OUT, *paths], check=True, capture_output=True)


if __name__ == '__main__':
    tx = tableaux()
    macros(tx)
    docs = riche_pour_doc()
    to_doc(docs)
    to_pdf([tx])
    print('OK', sorted(os.listdir(OUT)))
