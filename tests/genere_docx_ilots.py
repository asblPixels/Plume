# Génère un .docx « îlots » proche de ce qu'écrit Word : graphique avec classeur
# incorporé, zone de texte (wps + repli VML), forme sans texte, SmartArt
# (données + dessin en cache), équations en ligne et centrée, image flottante.
# Usage : python3 tests/genere_docx_ilots.py <dossier_sortie>
import io, os, re, sys, zipfile
from docx import Document
from docx.shared import Inches
from docx.oxml.ns import qn
from lxml import etree
from openpyxl import Workbook

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(OUT, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

# ---------- document de base ----------
d = Document()
d.add_heading('Îlots Office modifiables', 1)
for tag in ['CHART', 'TEXTBOX', 'SHAPE', 'SMARTART']:
    d.add_paragraph(f'{tag}_HERE')
p = d.add_paragraph('Équation en ligne : ')
p.add_run('MATH_INLINE')
d.add_paragraph('MATH_DISPLAY')
from PIL import Image
png = io.BytesIO(); Image.new('RGB', (160, 100), (38, 239, 197)).save(png, 'PNG'); png.seek(0)
d.add_paragraph('Image flottante :')
r = d.paragraphs[-1].add_run(); r.add_picture(png, width=Inches(1.5))
inline = r._r.find('.//' + qn('wp:inline'))
s = etree.tostring(inline).decode()
s = s.replace('<wp:inline', '<wp:anchor behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" simplePos="0" relativeHeight="3" distT="0" distB="0" distL="114300" distR="114300"', 1).replace('</wp:inline>', '</wp:anchor>')
s = s.replace('<wp:extent', '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent', 1)
s = re.sub(r'(<wp:effectExtent[^>]*/>)', r'\1<wp:wrapSquare wrapText="bothSides"/>', s, count=1)
inline.getparent().replace(inline, etree.fromstring(s))
d.add_paragraph('Le texte habille l’image flottante. ' * 8)
base = io.BytesIO(); d.save(base); base.seek(0)

# ---------- graphique (structure Word : strRef/numRef + classeur incorporé) ----------
cats = ['T1', 'T2', 'T3', 'T4']
series = [('Visites', [12, 19, 27, 34]), ('Ateliers', [5, 7, 6, 9])]
wb = Workbook(); ws = wb.active; ws.title = 'Feuil1'
for j, (n, _) in enumerate(series): ws.cell(1, j + 2, n)
for i, c in enumerate(cats):
    ws.cell(i + 2, 1, c)
    for j, (_, v) in enumerate(series): ws.cell(i + 2, j + 2, v[i])
xl = io.BytesIO(); wb.save(xl)

def ser_xml(j, name, vals):
    col = 'BCD'[j]
    pts = ''.join(f'<c:pt idx="{i}"><c:v>{c}</c:v></c:pt>' for i, c in enumerate(cats))
    nv = ''.join(f'<c:pt idx="{i}"><c:v>{v}</c:v></c:pt>' for i, v in enumerate(vals))
    return (f'<c:ser><c:idx val="{j}"/><c:order val="{j}"/><c:tx><c:strRef><c:f>Feuil1!${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>'
            f'<c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>Feuil1!$A$2:$A$5</c:f><c:strCache><c:ptCount val="4"/>{pts}</c:strCache></c:strRef></c:cat>'
            f'<c:val><c:numRef><c:f>Feuil1!${col}$2:${col}$5</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="4"/>{nv}</c:numCache></c:numRef></c:val>'
            f'<c:extLst><c:ext uri="{{C3380CC4-5D6E-409C-BE32-E72D297353CC}}" xmlns:c16="http://schemas.microsoft.com/office/drawing/2014/chart"><c16:uniqueId val="{{0000000{j}-AAAA-4BBB-8CCC-DDDDDDDDDDDD}}"/></c:ext></c:extLst></c:ser>')

chart = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
 '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
 '<c:date1904 val="0"/><c:lang val="fr-FR"/><c:roundedCorners val="0"/>'
 '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="c14" xmlns:c14="http://schemas.microsoft.com/office/drawing/2007/8/2/chart"><c14:style val="102"/></mc:Choice><mc:Fallback><c:style val="2"/></mc:Fallback></mc:AlternateContent>'
 '<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400"/></a:pPr><a:r><a:rPr lang="fr-FR" sz="1400"/><a:t>Activités 2026</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>'
 '<c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>'
 + ''.join(ser_xml(j, n, v) for j, (n, v) in enumerate(series)) +
 '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls><c:gapWidth val="150"/><c:axId val="107347456"/><c:axId val="52745856"/></c:barChart>'
 '<c:catAx><c:axId val="107347456"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="52745856"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>'
 '<c:valAx><c:axId val="52745856"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="107347456"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea>'
 '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>'
 '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>')

NSD = ('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
       'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
       'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word" '
       'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
chart_run = ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="4572000" cy="2743200"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="10" name="Graphique 1"/><wp:cNvGraphicFramePr/>'
             '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

def shape_run(docpr, name, text_paras, fill, vfill, prst='rect', vtag='v:rect'):
    tx = ''.join(f'<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1F3864"/></w:rPr><w:t xml:space="preserve">{t}</w:t></w:r></w:p>' for t in text_paras)
    txbx = f'<wps:txbx><w:txbxContent>{tx}</w:txbxContent></wps:txbx>' if text_paras else ''
    vtx = f'<v:textbox><w:txbxContent>{tx}</w:txbxContent></v:textbox>' if text_paras else ''
    return ('<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
            '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
            f'<wp:extent cx="2286000" cy="914400"/><wp:effectExtent l="0" t="0" r="19050" b="19050"/><wp:wrapTopAndBottom/><wp:docPr id="{docpr}" name="{name}"/><wp:cNvGraphicFramePr/>'
            '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>'
            f'<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="914400"/></a:xfrm><a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="2F5597"/></a:solidFill></a:ln></wps:spPr>'
            '<wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>'
            f'{txbx}<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="ctr" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>'
            f'<mc:Fallback><w:pict><{vtag} id="{name}" o:spid="_x0000_s10{docpr}" style="position:absolute;margin-left:0;margin-top:0;width:180pt;height:72pt;z-index:251659264;visibility:visible;mso-wrap-style:square;mso-position-horizontal:absolute;mso-position-horizontal-relative:text;mso-position-vertical:absolute;mso-position-vertical-relative:text;v-text-anchor:middle" fillcolor="{vfill}" strokecolor="#2f5597" strokeweight="1pt">'
            f'{vtx}<w10:wrap type="topAndBottom"/></{vtag}></w:pict></mc:Fallback></mc:AlternateContent></w:r>')

# ---------- SmartArt (processus : données, présentation, dessin en cache) ----------
G = lambda n: '{%08X-0000-4000-8000-%012X}' % (0xA0000000 + n, n)
DOC, N1, N2, N3 = G(1), G(2), G(3), G(4)
PT = {N1: (G(5), G(6), G(7)), N2: (G(8), G(9), G(10)), N3: (G(11), G(12), G(13))}  # parTrans, sibTrans, cxn
PRES_ROOT, PRES_ARROW, PRES_LIN = G(20), G(21), G(22)
TN = {N1: G(23), N2: G(24), N3: G(25)}
SB = {N1: G(26), N2: G(27)}
LAY = 'urn:microsoft.com/office/officeart/2005/8/layout/hProcess9'
texts = {N1: 'Accueil', N2: 'Diagnostic', N3: 'Formation'}
dgm = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>'
       f'<dgm:pt modelId="{DOC}" type="doc"><dgm:prSet loTypeId="{LAY}" loCatId="process" qsTypeId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1" qsCatId="simple" csTypeId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2" csCatId="accent1" phldr="1"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></dgm:t></dgm:pt>')
for n in (N1, N2, N3):
    par, sib, cx = PT[n]
    dgm += (f'<dgm:pt modelId="{n}"><dgm:prSet phldrT="[Texte]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="fr-FR"/><a:t>{texts[n]}</a:t></a:r></a:p></dgm:t></dgm:pt>'
            f'<dgm:pt modelId="{par}" type="parTrans" cxnId="{cx}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></dgm:t></dgm:pt>'
            f'<dgm:pt modelId="{sib}" type="sibTrans" cxnId="{cx}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="fr-FR"/></a:p></dgm:t></dgm:pt>')
dgm += (f'<dgm:pt modelId="{PRES_ROOT}" type="pres"><dgm:prSet presAssocID="{DOC}" presName="CompostProcess" presStyleCnt="0"><dgm:presLayoutVars><dgm:dir/><dgm:resizeHandles val="exact"/></dgm:presLayoutVars></dgm:prSet><dgm:spPr/></dgm:pt>'
        f'<dgm:pt modelId="{PRES_ARROW}" type="pres"><dgm:prSet presAssocID="{DOC}" presName="arrow" presStyleLbl="bgShp" presStyleIdx="0" presStyleCnt="1"/><dgm:spPr/></dgm:pt>'
        f'<dgm:pt modelId="{PRES_LIN}" type="pres"><dgm:prSet presAssocID="{DOC}" presName="linearProcess" presStyleCnt="0"/><dgm:spPr/></dgm:pt>')
for i, n in enumerate((N1, N2, N3)):
    dgm += f'<dgm:pt modelId="{TN[n]}" type="pres"><dgm:prSet presAssocID="{n}" presName="textNode" presStyleLbl="node1" presStyleIdx="{i}" presStyleCnt="3"><dgm:presLayoutVars><dgm:bulletEnabled val="1"/></dgm:presLayoutVars></dgm:prSet><dgm:spPr/></dgm:pt>'
    if n in SB:
        dgm += f'<dgm:pt modelId="{SB[n]}" type="pres"><dgm:prSet presAssocID="{PT[n][1]}" presName="sibTrans" presStyleCnt="0"/><dgm:spPr/></dgm:pt>'
dgm += '</dgm:ptLst><dgm:cxnLst>'
for i, n in enumerate((N1, N2, N3)):
    par, sib, cx = PT[n]
    dgm += f'<dgm:cxn modelId="{cx}" srcId="{DOC}" destId="{n}" srcOrd="{i}" destOrd="0" parTransId="{par}" sibTransId="{sib}"/>'
    dgm += f'<dgm:cxn modelId="{G(40 + i)}" type="presOf" srcId="{n}" destId="{TN[n]}" srcOrd="0" destOrd="0" presId="{LAY}"/>'
dgm += f'<dgm:cxn modelId="{G(50)}" type="presOf" srcId="{DOC}" destId="{PRES_ROOT}" srcOrd="0" destOrd="0" presId="{LAY}"/>'
dgm += f'<dgm:cxn modelId="{G(51)}" type="presParOf" srcId="{PRES_ROOT}" destId="{PRES_ARROW}" srcOrd="0" destOrd="0" presId="{LAY}"/>'
dgm += f'<dgm:cxn modelId="{G(52)}" type="presParOf" srcId="{PRES_ROOT}" destId="{PRES_LIN}" srcOrd="1" destOrd="0" presId="{LAY}"/>'
order = [TN[N1], SB[N1], TN[N2], SB[N2], TN[N3]]
for i, x in enumerate(order):
    dgm += f'<dgm:cxn modelId="{G(60 + i)}" type="presParOf" srcId="{PRES_LIN}" destId="{x}" srcOrd="{i}" destOrd="0" presId="{LAY}"/>'
dgm += ('</dgm:cxnLst><dgm:bg/><dgm:whole/><dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">'
        '<dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="rIdDgmDrawing" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst></dgm:dataModel>')

def dsp_sp(mid, x, y, cx, cy, prst, fill, txt=None):
    tb = (f'<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="87630" tIns="87630" rIns="87630" bIns="87630" numCol="1" spcCol="1270" anchor="ctr" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>'
          f'<a:p><a:pPr lvl="0" algn="ctr" defTabSz="1022350"><a:lnSpc><a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:spcAft><a:spcPct val="35000"/></a:spcAft></a:pPr><a:r><a:rPr lang="fr-FR" sz="2000" kern="1200"/><a:t>{txt}</a:t></a:r></a:p></dsp:txBody>'
          f'<dsp:txXfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></dsp:txXfrm>') if txt is not None else ''
    return (f'<dsp:sp modelId="{mid}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr><dsp:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'
            f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></dsp:spPr><dsp:style><a:lnRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style>{tb}</dsp:sp>')
drawing = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
           '<dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>'
           + dsp_sp(PRES_ARROW, 411479, 0, 4663440, 2286000, 'rightArrow', 'C9D7EE')
           + dsp_sp(TN[N1], 886, 571500, 1745252, 1143000, 'roundRect', '4472C4', 'Accueil')
           + dsp_sp(TN[N2], 1870573, 571500, 1745252, 1143000, 'roundRect', '4472C4', 'Diagnostic')
           + dsp_sp(TN[N3], 3740261, 571500, 1745252, 1143000, 'roundRect', '4472C4', 'Formation')
           + '</dsp:spTree></dsp:drawing>')
DG = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
layout = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:layoutDef {DG} uniqueId="{LAY}"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="process" pri="5000"/></dgm:catLst><dgm:layoutNode name="CompostProcess"><dgm:alg type="composite"/><dgm:shape xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:blip=""><dgm:adjLst/></dgm:shape></dgm:layoutNode></dgm:layoutDef>'
qs = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:styleDef {DG} uniqueId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="simple" pri="10100"/></dgm:catLst><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:styleLbl name="node1"><dgm:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></dgm:scene3d><dgm:sp3d/><dgm:txPr/><dgm:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dgm:style></dgm:styleLbl></dgm:styleDef>'
colors = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:colorsDef {DG} uniqueId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2"><dgm:title val=""/><dgm:desc val=""/><dgm:catLst><dgm:cat type="accent1" pri="11200"/></dgm:catLst><dgm:styleLbl name="node1"><dgm:fillClrLst meth="repeat"><a:schemeClr val="accent1"/></dgm:fillClrLst><dgm:linClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:linClrLst><dgm:effectClrLst/><dgm:txLinClrLst/><dgm:txFillClrLst meth="repeat"><a:schemeClr val="lt1"/></dgm:txFillClrLst><dgm:txEffectClrLst/></dgm:styleLbl></dgm:colorsDef>'
smart_run = ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="5486400" cy="2286000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="11" name="Diagramme 1"/><wp:cNvGraphicFramePr/>'
             '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rIdDgmData" r:lo="rIdDgmLayout" r:qs="rIdDgmQs" r:cs="rIdDgmColors"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>')

M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
math_inline = f'<m:oMath {M}><m:r><m:t>a=</m:t></m:r><m:f><m:num><m:r><m:t>b</m:t></m:r></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f><m:r><m:t>+</m:t></m:r><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>'
math_display = (f'<m:oMathPara {M}><m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup>'
                '<m:e><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub></m:sSub></m:e></m:nary><m:r><m:t>=</m:t></m:r><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad></m:oMath></m:oMathPara>')

REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
zin = zipfile.ZipFile(base)
zout = zipfile.ZipFile(os.path.join(OUT, 'ilots.docx'), 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    data = zin.read(it.filename)
    if it.filename == 'word/document.xml':
        t = data.decode()
        t = t.replace('<w:document ', f'<w:document {NSD} ', 1) if 'xmlns:wps=' not in t else t
        for k, v in [('xmlns:wps', ''), ]: pass
        t = re.sub(r'<w:r><w:t>CHART_HERE</w:t></w:r>', chart_run, t)
        t = re.sub(r'<w:r><w:t>TEXTBOX_HERE</w:t></w:r>', shape_run(12, 'Zone de texte 1', ['Bienvenue à l’ASBL', 'Ateliers numériques'], 'DEEAF6', '#deeaf6'), t)
        t = re.sub(r'<w:r><w:t>SHAPE_HERE</w:t></w:r>', shape_run(13, 'Ellipse 1', [], 'F4B183', '#f4b183', 'ellipse', 'v:oval'), t)
        t = re.sub(r'<w:r><w:t>SMARTART_HERE</w:t></w:r>', smart_run, t)
        t = re.sub(r'<w:r><w:t>MATH_INLINE</w:t></w:r>', math_inline, t)
        t = re.sub(r'<w:r><w:t>MATH_DISPLAY</w:t></w:r>', math_display, t)
        # espaces de noms manquants dans la racine
        root = t[:t.index('>', t.index('<w:document')) + 1]
        add = ' '.join(x for x in NSD.split(' ') if x.split('=')[0] not in root)
        t = t.replace(root, root[:-1] + ' ' + add + '>', 1)
        if 'mc:Ignorable' not in root: pass
        data = t.encode()
    if it.filename == 'word/_rels/document.xml.rels':
        data = data.decode().replace('</Relationships>',
            f'<Relationship Id="rIdChart1" Type="{REL}/chart" Target="charts/chart1.xml"/>'
            f'<Relationship Id="rIdDgmData" Type="{REL}/diagramData" Target="diagrams/data1.xml"/>'
            f'<Relationship Id="rIdDgmLayout" Type="{REL}/diagramLayout" Target="diagrams/layout1.xml"/>'
            f'<Relationship Id="rIdDgmQs" Type="{REL}/diagramQuickStyle" Target="diagrams/quickStyle1.xml"/>'
            f'<Relationship Id="rIdDgmColors" Type="{REL}/diagramColors" Target="diagrams/colors1.xml"/>'
            '<Relationship Id="rIdDgmDrawing" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="diagrams/drawing1.xml"/></Relationships>').encode()
    if it.filename == '[Content_Types].xml':
        data = data.decode().replace('</Types>',
            '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'
            '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
            '<Override PartName="/word/diagrams/data1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramData+xml"/>'
            '<Override PartName="/word/diagrams/layout1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramLayout+xml"/>'
            '<Override PartName="/word/diagrams/quickStyle1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramStyle+xml"/>'
            '<Override PartName="/word/diagrams/colors1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.diagramColors+xml"/>'
            '<Override PartName="/word/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/></Types>').encode()
    zout.writestr(it, data)
zout.writestr('word/charts/chart1.xml', chart)
zout.writestr('word/charts/_rels/chart1.xml.rels', f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/package" Target="../embeddings/Microsoft_Excel_Worksheet1.xlsx"/></Relationships>')
zout.writestr('word/embeddings/Microsoft_Excel_Worksheet1.xlsx', xl.getvalue())
zout.writestr('word/diagrams/data1.xml', dgm)
zout.writestr('word/diagrams/layout1.xml', layout)
zout.writestr('word/diagrams/quickStyle1.xml', qs)
zout.writestr('word/diagrams/colors1.xml', colors)
zout.writestr('word/diagrams/drawing1.xml', drawing)
zout.close()
print(os.path.join(OUT, 'ilots.docx'))
