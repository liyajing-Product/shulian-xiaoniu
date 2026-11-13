import {mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('dist',{recursive:true});
for(const name of ['index.html','style.css','notification.css','qwen-logo.png','iconpark-LICENSE.txt'])await copyFile('src/'+name,'dist/'+name);
await build({entryPoints:['src/app.mjs'],bundle:true,minify:true,format:'esm',target:['es2020'],outfile:'dist/app.mjs'});
