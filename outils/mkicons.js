const fs=require('fs');const dir=process.env.LUCIDE_DIR||'node_modules/lucide-static/icons/';
const names=process.argv.slice(2);const out={};const miss=[];
for(const n of names){const f=dir+n+'.svg';if(!fs.existsSync(f)){miss.push(n);continue;}
 let s=fs.readFileSync(f,'utf8');s=s.replace(/<!--[\s\S]*?-->/g,'');const inner=s.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/\s+/g,' ').trim();out[n]=inner;}
if(miss.length)console.error('MISSING',miss.join(' '));
fs.writeFileSync(require('path').join(__dirname,'..','js','icons.js'),'/* Icônes Lucide (licence ISC) — https://lucide.dev */\nwindow.ICONS='+JSON.stringify(out)+';\n');
