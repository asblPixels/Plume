"""Génère les documents de test de mise en page (sections, orientation, colonnes, coupe à la ligne).
Usage : python3 tests/genere_mise_en_page.py [dossier]   (défaut : /home/claude/test/mep)"""
import sys, os, random
from docx import Document
from docx.shared import Cm, Pt
from docx.enum.section import WD_ORIENT, WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/test/mep'
os.makedirs(OUT, exist_ok=True)
random.seed(7)
MOTS = ('le la les un une des pixel plume texte page section colonne ligne paragraphe document mise en forme '
        'école commune ordinateur atelier formation bénévole numérique association Boussu Hainaut projet '
        'outil logiciel libre partage savoir apprendre ensemble clavier souris écran').split()
def phrase(n):
    m = [random.choice(MOTS) for _ in range(n)]
    return ' '.join(m).capitalize() + '.'
def para(n):
    return ' '.join(phrase(random.randint(8, 16)) for _ in range(n))

def set_cols(section, num, space_cm=1.25, sep=False, widths=None):
    sp = section._sectPr
    for c in sp.findall(qn('w:cols')): sp.remove(c)
    cols = OxmlElement('w:cols')
    cols.set(qn('w:num'), str(num)); cols.set(qn('w:space'), str(int(space_cm * 567)))
    if sep: cols.set(qn('w:sep'), '1')
    if widths:
        cols.set(qn('w:equalWidth'), '0')
        for w, s in widths:
            c = OxmlElement('w:col'); c.set(qn('w:w'), str(int(w * 567)));
            if s is not None: c.set(qn('w:space'), str(int(s * 567)))
            cols.append(c)
    sp.append(cols)

# ---------- 1. Trois sections : portrait / paysage / portrait 2 colonnes ----------
d = Document()
s = d.sections[0]
s.page_width, s.page_height = Cm(21), Cm(29.7)
for m in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'): setattr(s, m, Cm(2.5))
d.add_heading('Section 1 — portrait', 1)
for i in range(6): d.add_paragraph(para(5))
s2 = d.add_section(WD_SECTION.NEW_PAGE)
s2.orientation = WD_ORIENT.LANDSCAPE
s2.page_width, s2.page_height = Cm(29.7), Cm(21)
for m in ('top_margin', 'bottom_margin'): setattr(s2, m, Cm(2))
for m in ('left_margin', 'right_margin'): setattr(s2, m, Cm(3))
d.add_heading('Section 2 — paysage', 1)
t = d.add_table(rows=30, cols=6); t.style = 'Table Grid'
for r in range(30):
    for c in range(6): t.cell(r, c).text = f'L{r + 1} C{c + 1}'
for i in range(3): d.add_paragraph(para(4))
s3 = d.add_section(WD_SECTION.NEW_PAGE)
s3.orientation = WD_ORIENT.PORTRAIT
s3.page_width, s3.page_height = Cm(21), Cm(29.7)
for m in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'): setattr(s3, m, Cm(2.5))
set_cols(s3, 2, 1.25, sep=True)
d.add_heading('Section 3 — deux colonnes', 1)
for i in range(14): d.add_paragraph(para(3))
d.save(f'{OUT}/sections3.docx')

# ---------- 2. Section continue à deux colonnes au milieu d'une page ----------
d = Document()
d.add_heading('Colonnes dans une section continue', 1)
for i in range(2): d.add_paragraph(para(3))
s2 = d.add_section(WD_SECTION.CONTINUOUS)   # sectPr du paragraphe précédent = section 1 (1 colonne)
set_cols(s2, 3, 0.8)
for i in range(6): d.add_paragraph(para(2))
s3 = d.add_section(WD_SECTION.CONTINUOUS)
set_cols(s3, 1)
d.add_paragraph('Après les colonnes : retour à une seule colonne. ' + para(3))
# colonnes inégales (gauche) + saut de colonne
s4 = d.add_section(WD_SECTION.NEW_PAGE)
set_cols(s4, 2, 1, widths=[(5, 1), (10, None)])
d.add_paragraph('Colonne étroite. ' + para(2))
p = d.add_paragraph('Avant le saut de colonne.')
br = OxmlElement('w:br'); br.set(qn('w:type'), 'column'); p.runs[0]._r.append(br)
d.add_paragraph('Colonne large après le saut. ' + para(4))
d.save(f'{OUT}/colonnes.docx')

# ---------- 3. Texte long : coupe à la ligne, veuves et orphelines, solidaires ----------
d = Document()
st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(11)
d.add_heading('Texte long', 1)
for i in range(60):
    if i % 9 == 4: d.add_heading(f'Titre {i}', 2)
    p = d.add_paragraph(para(random.randint(2, 9)))
    if i == 20: p.paragraph_format.keep_together = True
    if i == 30: p.paragraph_format.keep_with_next = True
    if i == 40: p.paragraph_format.page_break_before = True
    if i == 45: p.paragraph_format.widow_control = False
d.save(f'{OUT}/long.docx')

# ---------- 4. Document standard Calibri 11 (lignes par page) ----------
d = Document()
st = d.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(11)
st.paragraph_format.space_after = Pt(8); st.paragraph_format.line_spacing = 1.08
s = d.sections[0]; s.page_width, s.page_height = Cm(21), Cm(29.7)
for m in ('top_margin', 'bottom_margin', 'left_margin', 'right_margin'): setattr(s, m, Cm(2.5))
for i in range(120): d.add_paragraph(f'Ligne {i + 1} — courte.')
d.save(f'{OUT}/lignes.docx')

# ---------- 5. 50 pages ----------
d = Document()
for i in range(400):
    if i % 25 == 0: d.add_heading(f'Chapitre {i // 25 + 1}', 1)
    d.add_paragraph(para(random.randint(2, 6)))
d.save(f'{OUT}/cinquante.docx')
print('ok', OUT)
