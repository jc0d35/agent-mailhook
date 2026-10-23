import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createReceiver } from './examples/receiver.mjs';

let receiver;
let endpoint;
const logs = [];
const apiKey = 'synthetic-test-key';
const headers = { 'X-Api-Key': apiKey };

before(async () => {
  receiver = createReceiver({ apiKey, log: (message) => logs.push(message) });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  endpoint = `http://127.0.0.1:${receiver.address().port}/email/webhook`;
});

after(async () => {
  receiver.closeAllConnections();
  await new Promise((resolve, reject) => receiver.close((error) => error ? reject(error) : resolve()));
});

function mail() {
  const form = new FormData();
  form.set('senderAddress', 'synthetic@example.com');
  form.set('subject', 'Synthetic private subject');
  form.set('text', 'Synthetic private message body');
  form.set('externalId', 'mailhook.synthetic');
  form.append('attachments', new Blob(['synthetic file content'], { type: 'text/plain' }));
  return form;
}

test('local receiver acknowledges multipart mail and logs only structure', async () => {
  const response = await fetch(endpoint, { method: 'POST', headers, body: mail() });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual(JSON.parse(logs[0]), {
    event: 'example.received',
    fields: ['senderAddress', 'subject', 'text', 'externalId', 'attachments'],
    attachments: [{ type: 'text/plain', size: 22 }],
  });
  assert.doesNotMatch(logs[0], /synthetic@example|private|file content|synthetic-test-key/);
});

test('local receiver rejects missing or incorrect authentication before parsing', async () => {
  for (const requestHeaders of [{}, { 'X-Api-Key': 'wrong' }]) {
    const response = await fetch(endpoint, { method: 'POST', headers: requestHeaders, body: 'invalid multipart' });
    assert.equal(response.status, 401);
    await response.text();
  }
});

test('local receiver distinguishes unknown paths and unsupported methods', async () => {
  const missing = await fetch(endpoint.replace('/email/webhook', '/other'));
  assert.equal(missing.status, 404);
  await missing.text();
  const method = await fetch(endpoint);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  await method.text();
});

test('local receiver rejects malformed content, missing fields and non-file attachments', async () => {
  const invalid = [
    { body: 'not multipart', expected: 415 },
    { headers: { 'Content-Type': 'multipart/form-data; boundary=absent' }, body: 'broken', expected: 400 },
    { body: new FormData(), expected: 400 },
  ];
  const nonFile = mail();
  nonFile.set('attachments', 'not a file');
  invalid.push({ body: nonFile, expected: 400 });
  for (const item of invalid) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, ...item.headers },
      body: item.body,
    });
    assert.equal(response.status, item.expected);
    await response.text();
  }
});
