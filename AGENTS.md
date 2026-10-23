# Agent mailhook

One stateless email-to-HTTP adapter. MIME parsing belongs here; business routing, idempotency, media policy and persistence belong to the receiver. Do not add a mailbox, database, queue or raw-mail bucket.

`npm run check` is the gate: native tests, a Wrangler dry run and synthetic email in the local Cloudflare runtime. Use only synthetic messages in tests. Keep deployment-specific domains, endpoints and credentials outside this public repository. Deployments require operator authorization.
