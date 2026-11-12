import fs from 'node:fs/promises';

// Local AGY model-call accounting. Never retain or log message content.
export class TranscriptUsageReader {
  constructor(filename) {
    this.filename = filename;
    this.offset = 0;
    this.tail = Buffer.alloc(0);
    this.lastStep = -1;
    this.disabled = false;
  }
  async initialize() {
    // A resumed session already has a transcript; only new model calls belong
    // to this process. New sessions may not have created their file yet.
    try { this.offset = (await fs.stat(this.filename)).size; }
    catch (error) { if (error.code !== 'ENOENT') this.disabled = true; }
  }
  async read() {
    if (this.disabled) return null;
    let handle;
    try {
      handle = await fs.open(this.filename, 'r');
      const size = (await handle.stat()).size;
      if (size < this.offset) { this.offset = 0; this.tail = Buffer.alloc(0); }
      if (size === this.offset) return null;
      const rows = [];
      let budget = 16 * 1024 * 1024;
      while (this.offset < size && budget > 0) {
        const length = Math.min(1024 * 1024, size - this.offset, budget);
        const bytes = Buffer.allocUnsafe(length);
        const {bytesRead} = await handle.read(bytes, 0, length, this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        budget -= bytesRead;
        const data = Buffer.concat([this.tail, bytes.subarray(0, bytesRead)]);
        let start = 0, newline;
        while ((newline = data.indexOf(10, start)) !== -1) {
          try {
            const row = JSON.parse(data.subarray(start, newline).toString('utf8'));
            const counts = ['input_tokens', 'cache_read_tokens', 'output_tokens'];
            if (row.type === 'PLANNER_RESPONSE' && (!row.status || row.status === 'DONE') && Number.isSafeInteger(row.step_index) && row.step_index > this.lastStep &&
                counts.every(key => typeof row[key] === 'number' && Number.isSafeInteger(row[key]) && row[key] >= 0)) {
              this.lastStep = row.step_index;
              rows.push({step: row.step_index, input_tokens: row.input_tokens,
                cache_read_input_tokens: row.cache_read_tokens, cache_creation_input_tokens: 0,
                output_tokens: row.output_tokens});
            }
          } catch { /* An unrelated or malformed record never breaks replies. */ }
          start = newline + 1;
        }
        this.tail = Buffer.from(data.subarray(start));
        // A malformed file must not hold an unbounded incomplete record.
        if (this.tail.length > 8 * 1024 * 1024) { this.disabled = true; this.tail = Buffer.alloc(0); break; }
      }
      if (!rows.length) return null;
      const usage = {input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0};
      for (const row of rows) for (const key of Object.keys(usage)) usage[key] += row[key];
      return {usage, steps: rows.map(row => row.step), lastWindow: rows.at(-1).input_tokens + rows.at(-1).cache_read_input_tokens};
    } catch (error) {
      if (!['ENOENT', 'EACCES'].includes(error.code)) this.disabled = true;
      return null;
    } finally { await handle?.close().catch(() => {}); }
  }
}
