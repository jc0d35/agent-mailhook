import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';

test('Cloudflare runtime delivers binary multipart near the inbound size limit', async () => {
  let files = [];
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: 'dist/index.js',
      compatibilityDate: '2026-10-23',
      unsafeTriggerHandlers: true,
      log: new Log(LogLevel.ERROR),
      bindings: {
        MAILHOOK_RECIPIENT: 'ingest@example.com',
        BACKEND_WEBHOOK_URL: 'https://backend.example/email/webhook',
        EMAIL_WEBHOOK_API_KEY: 'synthetic-key',
      },
      outboundService: async (request) => {
        const form = await request.formData();
        assert.equal(form.get('senderAddress'), 'guest@example.com');
        assert.equal(form.get('subject'), 'Runtime');
        assert.equal(request.headers.get('x-api-key'), 'synthetic-key');
        files = await Promise.all(
          form.getAll('attachments').map(async (file) => ({
            name: file.name,
            size: file.size,
            head: (await file.text()).slice(0, 8),
          })),
        );
        return new Response('{}');
      },
    }),
  );
  try {
    for (const size of [32, 18 * 1024 * 1024]) {
      const attachment = Buffer.alloc(size, 0);
      attachment.write('%PDF-1.7');
      const raw = `From: guest@example.com\r\nTo: ingest@example.com\r\nMessage-ID: <runtime-${size}@example.com>\r\nSubject: Runtime\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=receipt.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment.toString('base64')}`;
      const response = await runtime.dispatchFetch(
        'http://localhost/cdn-cgi/local/email?from=guest%40example.com&to=ingest%40example.com',
        { method: 'POST', body: raw },
      );
      assert.equal(response.status, 200, await response.text());
      assert.deepEqual(files, [
        { name: 'receipt.pdf', size, head: '%PDF-1.7' },
      ]);
    }
  } finally {
    await runtime.dispose();
  }
});
