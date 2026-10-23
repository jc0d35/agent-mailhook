import { readFile, stat } from 'node:fs/promises';
import { deliver, MAX_EMAIL_BYTES } from './mail.mjs';

const file = process.argv[2];
if (!file || process.argv.length !== 3)
  throw new Error('Usage: npm run replay -- <original.eml>');
try {
  if ((await stat(file)).size > MAX_EMAIL_BYTES)
    throw new Error('mailhook-size');
  const externalId = await deliver(await readFile(file), process.env);
  console.log(`Delivered ${externalId}`);
} catch {
  console.error('Replay failed; check configuration and backend logs.');
  process.exitCode = 1;
}
