import { MAX_EMAIL_BYTES } from './limits.mjs';

function invalid() {
  throw new Error('mailhook-configuration');
}

function integer(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) invalid();
  return number;
}

export function maximumBytes(env) {
  return integer(env.MAILHOOK_MAX_BYTES, MAX_EMAIL_BYTES, MAX_EMAIL_BYTES);
}

export function recipients(env) {
  if (typeof env.MAILHOOK_RECIPIENT !== 'string') invalid();
  const addresses = env.MAILHOOK_RECIPIENT.split(',').map((value) =>
    value.trim().toLowerCase(),
  );
  if (addresses.some((value) => !/^[^\s@,*]+@[^\s@,*]+$/.test(value))) invalid();
  return new Set(addresses);
}

export function deliveryConfiguration(env) {
  let endpoint;
  try {
    endpoint = new URL(env.BACKEND_WEBHOOK_URL);
  } catch {
    invalid();
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) ||
    endpoint.username || endpoint.password || endpoint.hash ||
    typeof env.EMAIL_WEBHOOK_API_KEY !== 'string' ||
    !env.EMAIL_WEBHOOK_API_KEY.trim()
  ) invalid();
  const header = env.WEBHOOK_AUTH_HEADER ?? 'X-Api-Key';
  // Restrict custom authentication to names that cannot override multipart framing.
  if (typeof header !== 'string' || !/^(authorization|x-[a-z0-9-]+)$/i.test(header)) invalid();
  const prefix = env.WEBHOOK_AUTH_PREFIX ?? '';
  if (typeof prefix !== 'string') invalid();
  const value = `${prefix}${env.EMAIL_WEBHOOK_API_KEY}`;
  try {
    new Headers({ [header]: value });
  } catch {
    invalid();
  }
  return {
    endpoint,
    headers: { [header]: value },
    timeout: integer(env.WEBHOOK_TIMEOUT_MS, 60_000, 60_000),
    maximumBytes: maximumBytes(env),
  };
}
