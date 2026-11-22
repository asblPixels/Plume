import asyncio, base64
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
    pg=await b.new_page(viewport={'width':1300,'height':900}); errs=[]
    pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
    await pg.goto('http://localhost:8765/?new=1'); await pg.wait_for_timeout(800)
    await pg.evaluate("""()=>{Ed.editor.innerHTML='<p><span style="font-family:\\'Marelle\\', cursive; font-size:28pt">Bonjour les élèves, écrivez en cursive : œuf, Noël.</span></p><p><span style="font-family:\\'Borel\\', cursive; font-size:24pt">Borel : la récréation commence !</span></p><p>Texte normal.</p>'; Ed.changed(true);}""")
    await pg.wait_for_timeout(1200)
    ok=await pg.evaluate("[document.fonts.check('20px Marelle'), document.fonts.check('20px Borel')]")
    print('polices chargées', ok)
    await pg.screenshot(path='/home/claude/test/polices/apercu.png')
    o=await pg.evaluate("""async ()=>{const bl=await Formats.build('docx', App.exportCtx());const a=new Uint8Array(await bl.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}""")
    open('/home/claude/test/polices/marelle.docx','wb').write(base64.b64decode(o))
    # réimport
    await pg.evaluate("""async (d)=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'marelle.docx'));}""", o)
    await pg.wait_for_timeout(800)
    print(await pg.evaluate("Ed.editor.innerHTML.slice(0,300)"))
    print('ERR', errs)
    await b.close()
asyncio.run(main())
