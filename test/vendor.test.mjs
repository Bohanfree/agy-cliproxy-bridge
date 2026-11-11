import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

test('vendored bridge and license files retain their recorded hashes', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../vendor/provenance.json', import.meta.url), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    const bytes = fs.readFileSync(new URL('../vendor/agy-bridge/' + name, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, name);
  }
});
