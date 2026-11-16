import asyncio, sys
from playwright.async_api import async_playwright
import os; root=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','icons')+'/'
jobs=[('favicon.svg','icon-192.png',192),('favicon.svg','icon-512.png',512),('maskable.svg','maskable-512.png',512),('maskable.svg','maskable-192.png',192),('maskable.svg','apple-touch-icon.png',180),('favicon.svg','favicon-32.png',32)]
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for src,out,s in jobs:
            pg=await b.new_page(viewport={'width':s,'height':s})
            svg=open(root+src).read().replace('<svg ','<svg width="%d" height="%d" '%(s,s),1)
            await pg.set_content('<html><body style="margin:0;background:transparent">'+svg+'</body></html>')
            await pg.screenshot(path=root+out,omit_background=True,clip={'x':0,'y':0,'width':s,'height':s})
        await b.close()
asyncio.run(main())
