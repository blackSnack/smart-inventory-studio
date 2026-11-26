import {readFile,appendFile,writeFile} from 'node:fs/promises';import {validateHistory,planRelease} from './release-info.mjs';
const pkg=JSON.parse(await readFile('web/package.json','utf8')),history=validateHistory(JSON.parse(await readFile('web/release-history.json','utf8')),pkg.version);
const groups=JSON.parse(await readFile(process.argv[2],'utf8'));if(!Array.isArray(groups)||!groups.every(Array.isArray))throw Error('invalid paginated release list');
const p=planRelease(pkg.version,groups.flat());await appendFile(process.env.GITHUB_OUTPUT,'tag='+p.tag+'\npublish='+p.publish+'\n');
await writeFile('release-notes.md','# '+history[0].title+'\n\n'+history[0].changes.map(s=>'- '+s).join('\n')+'\n\nPreview release; live inventory writes and physical-device acceptance are not complete.\n');
