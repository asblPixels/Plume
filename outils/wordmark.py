from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
import sys
font=TTFont('node_modules/@fontsource/outfit/files/outfit-latin-600-normal.woff')
gs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
def glyph(ch):
    n=cmap[ord(ch)]; return n, gs[n].width
text='Plume'; x=0; parts=[]; kern=-10
for i,ch in enumerate(text):
    n,w=glyph(ch); pen=SVGPathPen(gs); gs[n].draw(pen)
    parts.append((ch, pen.getCommands(), x)); x+=w+(kern if i else 25)
total=x
asc=font['hhea'].ascent
def svg(lume, blur):
    out=[]
    for ch,d,dx in parts:
        col='#26EFC5' if ch=='P' else lume
        flt=' filter="url(#g)"' if ch=='P' else ''
        out.append(f'<path d="{d}" fill="{col}" transform="translate({dx} 0)"{flt}/>')
    # coordonnées police : y vers le haut -> on retourne
    bp=BoundsPen(gs)
    for ch in text: gs[cmap[ord(ch)]].draw(bp)
    ymin,ymax=-20,760
    pad=40
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-ymax-pad} {total+2*pad} {ymax-ymin+2*pad}" role="img" aria-label="Plume">
  <title>Plume</title>
  <defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="{blur}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
  <g transform="scale(1 -1)">{''.join(out)}</g>
</svg>
'''
open('icons/plume-wordmark-light.svg','w').write(svg('#F2F5F4',14))
open('icons/plume-wordmark-dark.svg','w').write(svg('#0D1013',6))
print(total)

n,w=glyph('P'); pen=SVGPathPen(gs); gs[n].draw(pen); d=pen.getCommands()
bp=BoundsPen(gs); gs[n].draw(bp); x0,y0,x1,y1=bp.bounds
def icon(full, scale):
    cx,cy=(x0+x1)/2,(y0+y1)/2
    bg='<rect width="512" height="512" fill="#0D1013"/>' if full else '<rect x="16" y="16" width="480" height="480" rx="112" fill="#0D1013"/>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><filter id="g" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>{bg}<g transform="translate(256 256) scale({scale} -{scale}) translate({-cx} {-cy})"><path d="{d}" fill="#26EFC5" filter="url(#g)"/></g></svg>'''
open('icons/favicon.svg','w').write(icon(False, 0.40))
open('icons/maskable.svg','w').write(icon(True, 0.30))
