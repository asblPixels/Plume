import asyncio, base64
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg=await b.new_page(viewport={'width':1440,'height':900}); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto('http://localhost:8765/?new=1'); await pg.wait_for_timeout(700)
        data=base64.b64encode(open('/home/claude/test/fmt/complexe.docx','rb').read()).decode()
        await pg.evaluate("""async d=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'complexe.docx'));}""", data)
        await pg.wait_for_timeout(900)
        # une ligne en cursive, zoom différent et défilement pour vérifier la robustesse
        await pg.evaluate("""(()=>{const p=document.createElement('p');p.innerHTML='<span style="font-family:\\'Playwrite FR Moderne\\', cursive;font-size:18pt">Le petit chat écrit en cursive.</span>';Ed.editor.prepend(p);Ed.changed(false);App.setZoom(0.75);document.getElementById('canvas').scrollTop=400;})()""")
        await pg.wait_for_timeout(500)
        o=await pg.evaluate("""async()=>{const bl=await Formats.build('pdf', App.exportCtx());const a=new Uint8Array(await bl.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return [btoa(s), Ed.zoom, document.getElementById('canvas').scrollTop];}""")
        open('/home/claude/test/direct.pdf','wb').write(base64.b64decode(o[0]))
        print('zoom restauré', o[1], 'défilement restauré', o[2], 'erreurs', errs)
        await b.close()
asyncio.run(main())
