import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;

/** Local demonstration only: acknowledge a request without saving any mail. */
export function createReceiver({
  apiKey = process.env.EMAIL_WEBHOOK_API_KEY || 'local-development-key',
  log = console.log,
} = {}) {
  return createServer(async (incoming, response) => {
    const fail = (status, message) => {
      response.writeHead(status, { 'Content-Type': 'text/plain' });
      response.end(message);
    };
    if (new URL(incoming.url, 'http://localhost').pathname !== '/email/webhook')
      return fail(404, 'Not found');
    if (incoming.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return fail(405, 'Use POST');
    }
    if (incoming.headers['x-api-key'] !== apiKey)
      return fail(401, 'Invalid API key');
    if (!incoming.headers['content-type']?.startsWith('multipart/form-data;'))
      return fail(415, 'Use multipart/form-data');

    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_REQUEST_BYTES)
          return fail(413, 'Request exceeds the supported size');
        chunks.push(chunk);
      }
      const request = new Request('http://localhost/email/webhook', {
        method: 'POST',
        headers: { 'Content-Type': incoming.headers['content-type'] },
        body: Buffer.concat(chunks),
      });
      const form = await request.formData();
      if (
        typeof form.get('senderAddress') !== 'string' ||
        typeof form.get('subject') !== 'string' ||
        typeof form.get('externalId') !== 'string'
      )
        return fail(400, 'Missing mailhook fields');
      const attachments = form.getAll('attachments');
      if (attachments.some((file) => typeof file === 'string'))
        return fail(400, 'Attachments must be files');
      log(JSON.stringify({
        event: 'example.received',
        fields: [...new Set(form.keys())],
        attachments: attachments.map((file) => ({ type: file.type, size: file.size })),
      }));
      response.writeHead(204);
      response.end();
    } catch {
      fail(400, 'Invalid multipart request');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createReceiver().listen(8788, '127.0.0.1', () => {
    console.log('Example receiver listening at http://127.0.0.1:8788/email/webhook');
  });
}
