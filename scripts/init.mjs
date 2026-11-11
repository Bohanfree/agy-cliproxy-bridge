import fs from 'node:fs';
import {randomBytes} from 'node:crypto';

fs.mkdirSync('state', {recursive: true, mode: 0o700});
try {
  fs.writeFileSync('api.key', randomBytes(36).toString('base64url') + '\n', {mode: 0o600, flag: 'wx'});
  console.log('Created api.key (0600).');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Kept existing api.key.');
}
if (!fs.existsSync('.env')) fs.copyFileSync('.env.example', '.env', fs.constants.COPYFILE_EXCL);
console.log('Ready. Configure .env, sign in to agy, then run npm start.');
