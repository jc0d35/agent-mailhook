# Agent mailhook

A stateless Cloudflare Email Worker that turns incoming MIME messages into an authenticated HTTP webhook request.

## Contract

The Worker accepts mail for `MAILHOOK_RECIPIENT`, parses MIME with `postal-mime`, and makes one HTTPS POST to `BACKEND_WEBHOOK_URL`. It authenticates with `X-Api-Key` using the `EMAIL_WEBHOOK_API_KEY` secret.

The multipart request contains `senderAddress`, optional `replyTo`, `subject` (possibly empty), optional `html`, `text` and `date`, and `externalId`. Repeated binary `attachments` parts preserve MIME order and filenames, including inline files. Sender identity comes from the original header, not a forwarding server's SMTP envelope. Remote content is never fetched.

`externalId` is `mailhook.` followed by SHA-256 of the normalized sender, a NUL separator and Message-ID. Without Message-ID, it hashes the raw message; replay identical raw bytes for the same identity. The receiver must deduplicate this id and tolerate replay after partial processing. Its success response should acknowledge completed processing, including supported attachments. Business routing, attachment policy and persistence belong to the receiver.

Input is bounded to 25 MiB of raw MIME, 100 attachments, a 1,000-character subject, 100,000-character HTML and 50,000-character text. Parsing also bounds header size, nesting and part count. The POST has a 60-second timeout. Non-2xx responses, redirects and transport failures fail the invocation. Logs contain only safe identities and failure categories, never message bodies or addresses.

There is no mailbox, database, queue, raw-message storage or automatic durable retry. Retain originals at an upstream mailbox and monitor `mailhook.failed`. A timeout can leave completed or partial receiver writes. SMTP retries are not assumed. The Worker sends no automatic email replies.

## Configure and deploy

Node 22 or newer is required. Run `npm ci` and `npm run check`; the gate runs native tests, a Wrangler dry run and synthetic messages in the local Cloudflare runtime, including a large binary attachment. It publishes nothing. `npm run dev -- --env development` starts the local runtime.

The checked-in Wrangler environments contain example addresses and URLs. Keep real deployment details in your own deployment project or provide non-secret overrides when deploying:

```sh
npx wrangler secret put EMAIL_WEBHOOK_API_KEY --env development
npx wrangler deploy --env development \
  --var MAILHOOK_RECIPIENT:inbox@example.com \
  --var BACKEND_WEBHOOK_URL:https://receiver.example.com/email/webhook
```

Use `--env production` for the other environment. When overriding the Worker name with `--name`, use the same name when installing its secret. Never put secrets in arguments or source. Configure Cloudflare Email Routing to send the literal recipient to this Worker; the Worker has no public HTTP route. DNS, mailbox forwarding, release approval and rollback belong to the deployment owner.

## Replay

Load `BACKEND_WEBHOOK_URL` and `EMAIL_WEBHOOK_API_KEY` in the environment, then run `npm run replay -- /path/to/original.eml`. This makes a real POST using the same adapter. Inspect receiver logs after a timeout before replaying. Keep real messages and credentials out of this repository.
