"""Génère un .docx de test réaliste « à la Word 365 » :
- un fil de discussion (commentaire + 2 réponses),
- un commentaire résolu,
- des révisions de 2 auteurs (insertion, suppression, marque de paragraphe insérée).
Le XML (commentsExtended, commentsIds, commentsExtensible, people) est écrit à la main.
Usage : python3 tests/genere_docx_commentaires.py sortie.docx
"""
import sys, zipfile

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fil.docx'
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14 w15"'

def t(s): return f'<w:r><w:t xml:space="preserve">{s}</w:t></w:r>'
def ref(i): return f'<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="{i}"/></w:r>'

doc = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document {W}><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>{t('Compte rendu de réunion')}</w:p>
<w:p>{t('Le budget ')}<w:commentRangeStart w:id="0"/><w:commentRangeStart w:id="1"/><w:commentRangeStart w:id="2"/>{t('prévisionnel 2027')}<w:commentRangeEnd w:id="0"/>{ref(0)}<w:commentRangeEnd w:id="1"/>{ref(1)}<w:commentRangeEnd w:id="2"/>{ref(2)}{t(' a été présenté.')}</w:p>
<w:p>{t('La salle ')}<w:commentRangeStart w:id="3"/>{t('communale')}<w:commentRangeEnd w:id="3"/>{ref(3)}{t(' est réservée.')}</w:p>
<w:p>{t('Présents : ')}<w:ins w:id="101" w:author="Roxane Godart" w:date="2026-11-20T09:15:00Z"><w:r><w:t>Stéphane, </w:t></w:r></w:ins>{t('Mehdy')}<w:del w:id="102" w:author="Stéphane Quain" w:date="2026-11-20T10:00:00Z"><w:r><w:delText xml:space="preserve"> et invités</w:delText></w:r></w:del>{t('.')}</w:p>
<w:p><w:pPr><w:rPr><w:ins w:id="103" w:author="Roxane Godart" w:date="2026-11-20T09:20:00Z"/></w:rPr></w:pPr><w:ins w:id="104" w:author="Roxane Godart" w:date="2026-11-20T09:20:00Z"><w:r><w:t>Paragraphe ajouté par Roxane.</w:t></w:r></w:ins></w:p>
<w:p>{t('Fin du compte rendu.')}</w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>'''

def cpara(pid, text, first=True):
    ann = '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' if first else ''
    return f'<w:p w14:paraId="{pid}" w14:textId="77777777"><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>{ann}{t(text)}</w:p>'

C = [  # id, auteur, initiales, date, paragraphes [(paraId, texte)]
    (0, 'Mehdy Sghaiar', 'MS', '2026-11-19T14:00:00Z', [('1A2B3C01', 'Ce montant inclut-il les subsides ?'), ('1A2B3C02', 'À vérifier avec la trésorière.')]),
    (1, 'Roxane Godart', 'RG', '2026-11-19T15:30:00Z', [('1A2B3C03', 'Oui, les subsides régionaux sont inclus.')]),
    (2, 'Stéphane Quain', 'SQ', '2026-11-19T16:10:00Z', [('1A2B3C04', 'Merci, je valide.')]),
    (3, 'Mehdy Sghaiar', 'MS', '2026-11-18T09:00:00Z', [('1A2B3C05', 'Confirmer la réservation.')]),
]
comments = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments {W}>' + ''.join(
    f'<w:comment w:id="{i}" w:author="{a}" w:date="{d}" w:initials="{ini}">' + ''.join(cpara(pid, tx, k == 0) for k, (pid, tx) in enumerate(ps)) + '</w:comment>'
    for i, a, ini, d, ps in C) + '</w:comments>'

W15 = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15"'
ext = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx {W15}><w15:commentEx w15:paraId="1A2B3C02" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C03" w15:paraIdParent="1A2B3C02" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C04" w15:paraIdParent="1A2B3C02" w15:done="0"/><w15:commentEx w15:paraId="1A2B3C05" w15:done="1"/></w15:commentsEx>'''
ids = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w16cid:commentsIds xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" mc:Ignorable="w16cid"><w16cid:commentId w16cid:paraId="1A2B3C02" w16cid:durableId="5E6F7001"/><w16cid:commentId w16cid:paraId="1A2B3C03" w16cid:durableId="5E6F7002"/><w16cid:commentId w16cid:paraId="1A2B3C04" w16cid:durableId="5E6F7003"/><w16cid:commentId w16cid:paraId="1A2B3C05" w16cid:durableId="5E6F7004"/></w16cid:commentsIds>'''
cex = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w16cex:commentsExtensible xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" mc:Ignorable="w16cex"><w16cex:commentExtensible w16cex:durableId="5E6F7001" w16cex:dateUtc="2026-11-19T13:00:00Z"/><w16cex:commentExtensible w16cex:durableId="5E6F7002" w16cex:dateUtc="2026-11-19T14:30:00Z"/><w16cex:commentExtensible w16cex:durableId="5E6F7003" w16cex:dateUtc="2026-11-19T15:10:00Z"/><w16cex:commentExtensible w16cex:durableId="5E6F7004" w16cex:dateUtc="2026-11-18T08:00:00Z"/></w16cex:commentsExtensible>'''
people = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:people {W15}>''' + ''.join(f'<w15:person w15:author="{a}"><w15:presenceInfo w15:providerId="None" w15:userId="{a}"/></w15:person>' for a in ['Mehdy Sghaiar', 'Roxane Godart', 'Stéphane Quain']) + '</w15:people>'

styles = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles {W}><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:sz w:val="48"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style></w:styles>'''

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/><Override PartName="/word/commentsIds.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml"/><Override PartName="/word/commentsExtensible.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml"/><Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>'''
RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'''
DRELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/><Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="commentsIds.xml"/><Relationship Id="rId5" Type="http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" Target="commentsExtensible.xml"/><Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/></Relationships>'''

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/_rels/document.xml.rels', DRELS)
    z.writestr('word/document.xml', doc)
    z.writestr('word/styles.xml', styles)
    z.writestr('word/comments.xml', comments)
    z.writestr('word/commentsExtended.xml', ext)
    z.writestr('word/commentsIds.xml', ids)
    z.writestr('word/commentsExtensible.xml', cex)
    z.writestr('word/people.xml', people)
print('écrit', out)
