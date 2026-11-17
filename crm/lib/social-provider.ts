import { randomUUID } from 'node:crypto';
import type { Platform } from './social';

// The seam between the console and whatever actually sends a post. Everything above
// this file — the composer, the queue, the engine — deals in a request and a result,
// so moving from the stub to bundle.social, or later to Meta's own API, changes this
// file and nothing else.

export type PublishRequest = {
  platform: Platform;
  handle: string;
  externalId: string | null;
  // The text resolved for this channel: the override when there is one, otherwise the
  // post body. The engine does the resolving so every provider gets the same thing.
  body: string;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
  // Stable per post and channel. A provider that supports idempotency should pass it
  // through so a retry after a timeout does not post twice.
  idempotencyKey: string;
  // Aborts after 30 seconds. An adapter that makes a network call must pass this to it,
  // or a hung request holds the post until the engine decides the run has died.
  signal: AbortSignal;
};

export type PublishResult =
  | { ok: true; remoteId: string; permalink: string | null }
  | { ok: false; error: string; retryable: boolean };

export type SocialProvider = {
  name: string;
  publish(request: PublishRequest): Promise<PublishResult>;
};

// The stub records what it was asked to send and reports success, so the engine, the
// retries, the queue states and the failure email can all be exercised before a
// provider account exists.
//
// It answers to two markers in the text, which is how the unhappy paths are exercised
// without editing code:
//   #fail        every attempt fails in a way worth retrying, so the backoff and the
//                final failure email can both be watched
//   #fail-hard   a refusal no retry can fix, so the post fails on the first run
const stub: SocialProvider = {
  name: 'stub',
  async publish(request) {
    if (request.body.includes('#fail-hard')) {
      return { ok: false, error: 'Stub: the platform refused this post.', retryable: false };
    }
    if (request.body.includes('#fail')) {
      return { ok: false, error: 'Stub: timed out talking to the platform.', retryable: true };
    }
    return { ok: true, remoteId: `stub:${randomUUID()}`, permalink: null };
  },
};

// Not written yet, and deliberately not guessed at. bundle.social's payload shape has
// to be checked against their current API reference and tried against a real account
// before it is trusted with a post, so asking for it before then fails loudly instead
// of silently doing nothing.
const bundle: SocialProvider = {
  name: 'bundle',
  async publish() {
    return {
      ok: false,
      error:
        'The bundle.social adapter is not written yet. Set SOCIAL_PROVIDER=stub, or finish createBundleProvider() against the current API reference.',
      retryable: false,
    };
  },
};

export function getProvider(): SocialProvider {
  const configured = (process.env.SOCIAL_PROVIDER ?? 'stub').toLowerCase();
  if (configured === 'bundle') return bundle;
  return stub;
}
