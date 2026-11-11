// Interactive administrative login; never exposed through the model HTTP API.
import readline from 'node:readline/promises';
import {startLogin} from './vendor/agy-bridge/login.mjs';
const pending = await startLogin(process.env.AGY_PATH || 'agy');
if (pending.error) { console.error(pending.error); process.exit(1); }
console.log(pending.url);
const input = readline.createInterface({input: process.stdin, output: process.stdout});
const code = await input.question('Paste the completed sign-in URL or code: ');
const result = await pending.finish(code);
input.close();
console.log(result.ok ? 'Sign-in complete.' : `Sign-in failed: ${result.error}`);
process.exit(result.ok ? 0 : 1);
