import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('coverage', { recursive: true });
await writeFile('coverage/lcov.info', 'SF:src/server.js\nDA:3,1\nDA:4,1\nDA:5,0\nDA:6,1\nDA:7,1\nend_of_record\n');
console.log('coverage fixture written');
