import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';
import { deliver, MAX_EMAIL_BYTES } from './mail.mjs';

const env = {
  MAILHOOK_RECIPIENT: 'ingest@inbound-dev.example.com',
  BACKEND_WEBHOOK_URL: 'https://backend.example/api/email/webhook',
  EMAIL_WEBHOOK_API_KEY: 'synthetic-key',
};
const raw = (headers = '', body = 'Hello') =>
  new TextEncoder().encode(
    `From: Original Guest <guest@example.com>\r\nReply-To: reply@example.com\r\nMessage-ID: <original@example.com>\r\nSubject: =?UTF-8?B?Q2lhbyDDqA==?=\r\n${headers}\r\n${body}`,
  );
const mime = () =>
  raw(
    'Content-Type: multipart/mixed; boundary=outer\r\n',
    [
      '--outer',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Hello <b>guest</b></p>',
      '--outer',
      'Content-Type: application/pdf',
      'Content-Disposition: attachment',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjc=',
      '--outer',
      'Content-Type: image/png',
      'Content-ID: <logo>',
      'Content-Disposition: inline',
      'Content-Transfer-Encoding: base64',
      '',
      'iVBORw0KGgo=',
      '--outer--',
      '',
    ].join('\r\n'),
  );

afterEach(() => mock.restoreAll());

test('missing recipient configuration emits the same safe failure event', async () => {
  const log = mock.method(console, 'error', () => {});
  await assert.rejects(
    worker.email(
      { to: 'ingest@example.com' },
      { ...env, MAILHOOK_RECIPIENT: '' },
    ),
    /mailhook-delivery-failed/,
  );
  assert.deepEqual(JSON.parse(log.mock.calls[0].arguments[0]), {
    event: 'mailhook.failed',
    reason: 'parse-or-configuration',
  });
});

test('posts decoded headers and body to the existing guarded endpoint', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(String(url), env.BACKEND_WEBHOOK_URL);
    assert.equal(options.headers['X-Api-Key'], env.EMAIL_WEBHOOK_API_KEY);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    const form = await new Request(url, options).formData();
    assert.equal(form.get('senderAddress'), 'guest@example.com');
    assert.equal(form.get('replyTo'), 'reply@example.com');
    assert.equal(form.get('subject'), 'Ciao è');
    assert.equal(form.get('text'), 'Hello\r\n');
    assert.match(form.get('externalId'), /^mailhook\.[a-f0-9]{64}$/);
    return new Response('{}');
  });
  await deliver(raw(), env);
  assert.equal(calls, 1);
});

test('preserves HTML and binary files, including inline parts, in MIME order', async () => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    const form = await new Request(url, options).formData();
    assert.match(form.get('html'), /<p>Hello <b>guest<\/b><\/p>/);
    const files = form.getAll('attachments');
    assert.deepEqual(
      files.map((file) => file.type),
      ['application/pdf', 'image/png'],
    );
    assert.equal(await files[0].text(), '%PDF-1.7');
    assert.deepEqual(
      [...new Uint8Array(await files[1].arrayBuffer())],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    return new Response();
  });
  await deliver(mime(), env);
});

test('identity survives transport-header changes and distinguishes different senders', async () => {
  mock.method(globalThis, 'fetch', async () => new Response());
  const first = await deliver(raw(), env);
  assert.equal(await deliver(raw('Received: another relay\r\n'), env), first);
  assert.notEqual(
    await deliver(
      new TextEncoder().encode(
        new TextDecoder()
          .decode(raw())
          .replace('guest@example.com', 'other@example.com'),
      ),
      env,
    ),
    first,
  );
});

test('without Message-ID, replaying the same raw original retains its identity', async () => {
  mock.method(globalThis, 'fetch', async () => new Response());
  const original = new TextEncoder().encode(
    'From: guest@example.com\r\n\r\nHello',
  );
  assert.equal(await deliver(original, env), await deliver(original, env));
});

test('subjectless, attachment-only email stays attachment-only', async () => {
  mock.method(globalThis, 'fetch', async (url, options) => {
    const form = await new Request(url, options).formData();
    assert.equal(form.get('subject'), '');
    assert.equal(form.getAll('attachments').length, 1);
    return new Response();
  });
  await deliver(
    new TextEncoder().encode(
      'From: guest@example.com\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment\r\n\r\n%PDF-1.7',
    ),
    env,
  );
});

for (const status of [301, 302, 307, 401, 413, 422, 429, 500, 503])
  test(`HTTP ${status} fails after exactly one attempt`, async () => {
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response('private response', { status });
    });
    await assert.rejects(
      deliver(raw(), env),
      new RegExp(`mailhook-backend-${status}`),
    );
    assert.equal(calls, 1);
  });

test('transport timeouts propagate without retrying', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError');
  });
  await assert.rejects(deliver(raw(), env), /mailhook-transport/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('refuses unsafe endpoints, missing secrets, empty and oversized input', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response());
  for (const url of [
    'http://backend.example/email/webhook',
    'https://user:password@backend.example/email/webhook',
  ])
    await assert.rejects(
      deliver(raw(), { ...env, BACKEND_WEBHOOK_URL: url }),
      /configuration/,
    );
  await assert.rejects(
    deliver(raw(), { ...env, EMAIL_WEBHOOK_API_KEY: '' }),
    /configuration/,
  );
  await assert.rejects(deliver(new Uint8Array(), env), /size/);
  await assert.rejects(
    deliver(new Uint8Array(MAX_EMAIL_BYTES + 1), env),
    /size/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test('refuses missing sender, excessive body fields and too many attachments before POST', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response());
  await assert.rejects(
    deliver(new TextEncoder().encode('Subject: Invalid\r\n\r\nNo sender'), env),
    /mailhook-sender/,
  );
  await assert.rejects(
    deliver(raw('', 'x'.repeat(50001)), env),
    /mailhook-fields/,
  );
  const parts = Array.from(
    { length: 101 },
    () =>
      '--files\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment\r\n\r\n%PDF-1.7\r\n',
  ).join('');
  await assert.rejects(
    deliver(
      raw(
        'Content-Type: multipart/mixed; boundary=files\r\n',
        parts + '--files--\r\n',
      ),
      env,
    ),
    /mailhook-attachment-count/,
  );
  assert.equal(fetch.mock.callCount(), 0);
});

test('rejects wrong recipients and excessive SMTP size before reading or posting', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response());
  for (const fields of [
    { to: 'other@example.com', rawSize: 10 },
    { to: env.MAILHOOK_RECIPIENT, rawSize: MAX_EMAIL_BYTES + 1 },
  ]) {
    const reasons = [];
    await worker.email(
      {
        ...fields,
        setReject: (reason) => reasons.push(reason),
        get raw() {
          throw new Error('must not read');
        },
      },
      env,
    );
    assert.equal(reasons.length, 1);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('SMTP forwarding envelope never replaces the original header sender', async () => {
  const log = mock.method(console, 'log', () => {});
  mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(
      (await new Request(url, options).formData()).get('senderAddress'),
      'guest@example.com',
    );
    return new Response();
  });
  const bytes = raw();
  await worker.email(
    {
      from: 'SRS0=forwarded@forwarder.example',
      to: env.MAILHOOK_RECIPIENT,
      rawSize: bytes.length,
      raw: new Blob([bytes]).stream(),
    },
    env,
  );
  assert.match(log.mock.calls[0].arguments[0], /mailhook.delivered/);
  assert.doesNotMatch(
    log.mock.calls[0].arguments[0],
    /guest@example|Hello|synthetic-key/,
  );
});

test('failure logs and thrown errors do not expose parser or backend data', async () => {
  const log = mock.method(console, 'error', () => {});
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('private message and secret');
  });
  const bytes = raw();
  await assert.rejects(
    worker.email(
      {
        to: env.MAILHOOK_RECIPIENT,
        rawSize: bytes.length,
        raw: new Blob([bytes]).stream(),
      },
      env,
    ),
    /mailhook-delivery-failed/,
  );
  const entry = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(entry.event, 'mailhook.failed');
  assert.equal(entry.reason, 'mailhook-transport');
  assert.match(entry.externalId, /^mailhook\.[a-f0-9]{64}$/);
  assert.doesNotMatch(
    log.mock.calls[0].arguments[0],
    /private|secret|guest@example/,
  );
});
