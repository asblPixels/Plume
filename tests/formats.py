import asyncio, base64, os, sys, json
from playwright.async_api import async_playwright
D='/home/claude/test/fmt/'; OUT='/home/claude/test/fmt/out/'; os.makedirs(OUT, exist_ok=True)
files=sys.argv[1:] or sorted(f for f in os.listdir(D) if os.path.isfile(D+f) and not f.endswith('.png'))
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        for f in files:
            pg=await b.new_page(viewport={'width':1400,'height':900})
            errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
            await pg.goto('http://localhost:8765/?new=1'); await pg.wait_for_timeout(600)
            data=base64.b64encode(open(D+f,'rb').read()).decode()
            await pg.evaluate("""async ([d,n])=>{const b=Uint8Array.from(atob(d),c=>c.charCodeAt(0));await App.openFile(new File([b],n));}""", [data,f])
            await pg.wait_for_timeout(900)
            dlg = await pg.evaluate("document.querySelector('.dlg-back') ? document.querySelector('.dlg-back').innerText.slice(0,200) : ''")
            info = await pg.evaluate("({fmt:App.format, pages:Ed.pageCount, words:Ed.stats().words, text:Ed.editor.innerText.replace(/\\s+/g,' ').slice(0,90), tables:Ed.editor.querySelectorAll('table').length, imgs:Ed.editor.querySelectorAll('img').length, lists:Ed.editor.querySelectorAll('ul,ol').length, h:Ed.editor.querySelectorAll('h1,h2,h3').length})")
            print(f"\n== {f}: {json.dumps(info, ensure_ascii=False)}" + (f"\n   DIALOG: {dlg}" if dlg else ''))
            await pg.screenshot(path=OUT+f+'.png')
            for fmt in ['docx','odt','rtf','md','txt','html']:
                try:
                    o=await pg.evaluate("""async (fmt)=>{const bl=await Formats.build(fmt, App.exportCtx());const a=new Uint8Array(await bl.arrayBuffer());let s='';for(const x of a)s+=String.fromCharCode(x);return btoa(s);}""", fmt)
                    open(OUT+f+'.'+fmt,'wb').write(base64.b64decode(o))
                except Exception as e: print('   EXPORT', fmt, 'FAILED', str(e)[:200])
            if errs: print('   ERRORS', errs[:5])
            await pg.close()
        await b.close()
asyncio.run(main())
