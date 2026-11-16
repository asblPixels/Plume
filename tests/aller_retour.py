import asyncio, base64, sys
from playwright.async_api import async_playwright
src=sys.argv[1]; out=sys.argv[2]; shot=sys.argv[3]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg=await b.new_page(viewport={'width':1440,'height':1000})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto('http://localhost:8765/?new=1'); await pg.wait_for_timeout(700)
        data=base64.b64encode(open(src,'rb').read()).decode()
        await pg.evaluate("""async d=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],'in.docx'));}""", data)
        await pg.wait_for_timeout(1200)
        await pg.evaluate("App.openNav('comments')"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=shot)
        print('islands', await pg.evaluate("[...document.querySelectorAll('#editor .pl-island')].map(x=>x.dataset.kind)"))
        print('comments', await pg.evaluate("Comments.list().length"), 'revs', await pg.evaluate("Revisions.count()"))
        o=await pg.evaluate("""async()=>{const b=await App.buildDocx();const a=new Uint8Array(await b.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}""")
        open(out,'wb').write(base64.b64decode(o))
        print('ERRORS', errs)
        await b.close()
asyncio.run(main())
