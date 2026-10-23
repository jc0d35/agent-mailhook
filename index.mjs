import { deliver, DeliveryError, MAX_EMAIL_BYTES } from './mail.mjs';

export default {
  async email(message, env) {
    try {
      const recipient = env.MAILHOOK_RECIPIENT?.trim().toLowerCase();
      if (!recipient) throw new Error('mailhook-configuration');
      if (message.to.toLowerCase() !== recipient)
        return message.setReject('Unknown recipient');
      if (
        !Number.isSafeInteger(message.rawSize) ||
        message.rawSize < 1 ||
        message.rawSize > MAX_EMAIL_BYTES
      )
        return message.setReject('Message exceeds the supported size');
      const externalId = await deliver(
        await new Response(message.raw).arrayBuffer(),
        env,
      );
      console.log(JSON.stringify({ event: 'mailhook.delivered', externalId }));
    } catch (error) {
      // Parser/HTTP errors can contain private data. Never propagate their text into Worker logs.
      console.error(
        JSON.stringify({
          event: 'mailhook.failed',
          ...(error instanceof DeliveryError
            ? { externalId: error.externalId, reason: error.message }
            : { reason: 'parse-or-configuration' }),
        }),
      );
      throw new Error('mailhook-delivery-failed');
    }
  },
};
