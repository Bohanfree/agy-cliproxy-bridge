import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TranscriptUsageReader} from '../vendor/agy-bridge/transcript-usage.mjs';
const row = (step, input=10, cache=100) => ({type:'PLANNER_RESPONSE',step_index:step,input_tokens:input,cache_read_tokens:cache,output_tokens:7,content:'中文 secret, must not be returned'});
async function fixture(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'agy-usage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return path.join(dir,'transcript.jsonl');}
test('resumed history is skipped and new model calls preserve independent cache counters',async t=>{
 const p=await fixture(t);await fs.writeFile(p,JSON.stringify(row(1))+'\n');const reader=new TranscriptUsageReader(p);await reader.initialize();
 assert.equal(await reader.read(),null);await fs.appendFile(p,JSON.stringify(row(2))+'\n');
 const value=await reader.read();assert.deepEqual(value.usage,{input_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:0,output_tokens:7});assert.deepEqual(value.steps,[2]);assert.ok(!JSON.stringify(value).includes('secret'));assert.equal(await reader.read(),null);
});
test('new file, UTF8 partial lines, unrelated records and duplicate steps',async t=>{
 const p=await fixture(t);const reader=new TranscriptUsageReader(p);await reader.initialize();assert.equal(await reader.read(),null);
 const bytes=Buffer.from(JSON.stringify(row(1))+'\n');const split=bytes.indexOf(Buffer.from('中文'))+1;await fs.writeFile(p,bytes.subarray(0,split));assert.equal(await reader.read(),null);
 await fs.appendFile(p,Buffer.concat([bytes.subarray(split),Buffer.from(JSON.stringify({type:'USER_INPUT',step_index:2})+'\n'+JSON.stringify(row(1))+'\n'+JSON.stringify(row(3,0,300))+'\n')]));
 const value=await reader.read();assert.deepEqual(value.steps,[1,3]);assert.equal(value.usage.input_tokens,10);assert.equal(value.usage.cache_read_input_tokens,400);
});
