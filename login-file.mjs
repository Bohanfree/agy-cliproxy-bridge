// Short-lived login helper for asynchronous user handoff. Code files are 0600
// and deleted before the authorization exchange; credentials remain in AGY.
import fs from 'node:fs/promises';
import {startLogin} from './vendor/agy-bridge/login.mjs';
const dir = process.env.AGY_LOGIN_STATE_DIR || './state';
await fs.mkdir(dir, {recursive: true, mode: 0o700});
const save = async value => fs.writeFile(`${dir}/login-status.json`, JSON.stringify(value), {mode: 0o600});
await fs.rm(`${dir}/login-code.txt`, {force: true});
const pending = await startLogin(process.env.AGY_PATH || 'agy');
if (pending.error) { await save({status: 'failed', error: pending.error}); process.exit(1); }
await fs.writeFile(`${dir}/login-url.txt`, pending.url, {mode: 0o600});
await save({status: 'waiting_for_user', expiresAt: new Date(Date.now() + 14 * 60000).toISOString()});
const deadline = Date.now() + 14 * 60000;
while (Date.now() < deadline) {
  let code;
  try { code = await fs.readFile(`${dir}/login-code.txt`, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (code?.trim()) {
    await fs.rm(`${dir}/login-code.txt`, {force: true});
    const result = await pending.finish(code);
    await save({status: result.ok ? 'signed_in' : 'failed', ...(result.error ? {error: result.error} : {})});
    process.exit(result.ok ? 0 : 1);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await fs.rm(`${dir}/login-url.txt`, {force: true});
await save({status: 'expired'});
process.exit(1);
