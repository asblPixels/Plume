# Génère un .docx "riche" : graphique, équation, image flottante, commentaire,
# révisions, en-tête de 1re page, colonnes, style personnalisé.
import copy, zipfile, shutil, re
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.oxml.ns import qn
from docx.oxml import parse_xml
from docx.enum.style import WD_STYLE_TYPE

d = Document()
st = d.styles.add_style('Encadré ASBL', WD_STYLE_TYPE.PARAGRAPH)
st.font.color.rgb = RGBColor(0x0B, 0x7A, 0x64); st.font.size = Pt(13); st.font.italic = True
d.add_heading('Document riche', 1)
p = d.add_paragraph('Paragraphe avec un style personnalisé.', style='Encadré ASBL')
p = d.add_paragraph('Texte commenté ici. ')
run = p.add_run('Phrase importante')
d.add_comment(run, text='Vérifier ce chiffre', author='Roxane', initials='RG')
# révisions
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
p = d.add_paragraph('Révision : ')
p._p.append(parse_xml(f'<w:ins {W} w:id="901" w:author="Mehdy" w:date="2026-11-16T10:00:00Z"><w:r><w:t xml:space="preserve">texte ajouté </w:t></w:r></w:ins>'))
p._p.append(parse_xml(f'<w:del {W} w:id="902" w:author="Mehdy" w:date="2026-11-16T10:00:00Z"><w:r><w:delText>texte supprimé</w:delText></w:r></w:del>'))
# équation
M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
p = d.add_paragraph('Équation : ')
p._p.append(parse_xml(f'<m:oMath {M} {W}><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'))
# image flottante (on ajoute une image en ligne puis on la transforme en ancre)
from PIL import Image; Image.new('RGB', (200, 140), (255, 120, 60)).save('riche/orange.png')
d.add_paragraph('Image flottante à droite :')
r = d.paragraphs[-1].add_run(); r.add_picture('riche/orange.png', width=Inches(1.6))
inline = r._r.find('.//' + qn('wp:inline'))
xml = inline.xml if hasattr(inline, 'xml') else None
from lxml import etree
s = etree.tostring(inline).decode()
s = s.replace('<wp:inline', '<wp:anchor behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" simplePos="0" relativeHeight="2" distT="0" distB="0" distL="114300" distR="114300"', 1).replace('</wp:inline>', '</wp:anchor>')
s = s.replace('<wp:extent', '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent', 1)
s = re.sub(r'(<wp:effectExtent[^>]*/>)', r'\1<wp:wrapSquare wrapText="bothSides"/>', s, 1)
inline.getparent().replace(inline, etree.fromstring(s))
d.add_paragraph('Le texte habille l’image. ' * 12)
# emplacement du graphique
d.add_paragraph('Graphique :')
d.add_paragraph('CHART_HERE')
# en-tête première page différent
sec = d.sections[0]
sec.different_first_page_header_footer = True
sec.first_page_header.paragraphs[0].text = 'EN-TÊTE PREMIÈRE PAGE'
sec.header.paragraphs[0].text = 'En-tête des autres pages'
d.add_page_break(); d.add_paragraph('Page deux.')
# 2 colonnes
cols = sec._sectPr.find(qn('w:cols'))
if cols is None:
    cols = parse_xml(f'<w:cols {W}/>'); sec._sectPr.append(cols)
cols.set(qn('w:num'), '2'); cols.set(qn('w:space'), '708')
d.save('riche/base.docx')

# --- injection d'un graphique (partie chart écrite à la main) ---
chart = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Bénéficiaires 2026</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Visites</c:v></c:tx><c:cat><c:strLit><c:ptCount val="4"/><c:pt idx="0"><c:v>T1</c:v></c:pt><c:pt idx="1"><c:v>T2</c:v></c:pt><c:pt idx="2"><c:v>T3</c:v></c:pt><c:pt idx="3"><c:v>T4</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:ptCount val="4"/><c:pt idx="0"><c:v>12</c:v></c:pt><c:pt idx="1"><c:v>19</c:v></c:pt><c:pt idx="2"><c:v>27</c:v></c:pt><c:pt idx="3"><c:v>34</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>'''
drawing = '''<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="4572000" cy="2743200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="77" name="Graphique 1"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'''
zin = zipfile.ZipFile('riche/base.docx'); zout = zipfile.ZipFile('riche/riche.docx', 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    data = zin.read(it.filename)
    if it.filename == 'word/document.xml':
        t = data.decode()
        t = re.sub(r'<w:r><w:t>CHART_HERE</w:t></w:r>', drawing, t)
        data = t.encode()
    if it.filename == 'word/_rels/document.xml.rels':
        data = data.decode().replace('</Relationships>', '<Relationship Id="rIdChart1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="charts/chart1.xml"/></Relationships>').encode()
    if it.filename == '[Content_Types].xml':
        data = data.decode().replace('</Types>', '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>').encode()
    zout.writestr(it, data)
zout.writestr('word/charts/chart1.xml', chart)
zout.close()
print('ok')
