import {mkdir,rm,copyFile,writeFile} from 'node:fs/promises';
import {RETIRE_WORKER} from '../server/auth.js';
await rm('dist',{recursive:true,force:true});await mkdir('dist/icons',{recursive:true});
for(const file of ['index.html','app.js','game.js','style.css','manifest.webmanifest','auth-client.js','icons/icon-192.png','icons/icon-512.png'])await copyFile(file,`dist/${file}`);
await writeFile('dist/sw.js',RETIRE_WORKER);
await writeFile('dist/_routes.json',JSON.stringify({version:1,include:['/*'],exclude:[]}));
await writeFile('dist/_headers','/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n');
