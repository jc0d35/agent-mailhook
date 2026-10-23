import { readFile, stat } from 'node:fs/promises';
import { deliver } from './mail.mjs';
import { maximumBytes } from './config.mjs';

const file = process.argv[2];
if (!file || process.argv.length !== 3)
  throw new Error('Usage: npm run replay -- <original.eml>');
try {
  if ((await stat(file)).size > maximumBytes(process.env))
    throw new Error('mailhook-size');
  const externalId = await deliver(await readFile(file), process.env);
  console.log(`Delivered ${externalId}`);
} catch {
  console.error('Replay failed; check configuration and backend logs.');
  process.exitCode = 1;
}
