# Contributing

Bug reports and focused pull requests are welcome. Describe the input, expected behavior, and observed result. Include a minimal synthetic `.eml` or receiver response when it helps reproduce the issue; remove actual addresses, message content, and credentials.

## Work locally

Use Node.js 22 or newer:

```sh
npm ci
npm run check
```

The gate runs native tests, bundles the Worker with a Wrangler dry run, and exercises synthetic email events in the local Cloudflare runtime. It requires no Cloudflare credentials and publishes nothing. The README includes a local receiver and sample email walkthrough.

Add meaningful coverage for changed behavior and update the README when configuration or the multipart contract changes. Keep the lockfile in sync with dependency changes. Test messages must be synthetic, and public examples must use reserved example domains and dummy keys.

## Project scope

This project is a stateless MIME-to-HTTP adapter. Receiver routing, deduplication, media policy, persistence, queues, and mail archives belong to the receiving application. Preserve the default webhook contract unless a change explicitly explains its compatibility impact. Do not add deployment credentials or automatic deployment to pull requests.

Open pull requests against `development`. Explain the concrete problem, the resulting behavior, and the checks run. Contributions are made under the repository's MIT license.
