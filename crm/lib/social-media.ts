// Media rules for the marketing console, as pure functions.
//
// The provider fetches these URLs itself, so an upload has to become a public URL, not a signed one
// that expires before the post goes out. Keeping validation here means the same rules are applied
// whether an image arrives from the composer or gets attached to an agent draft.

export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

// Raster only. An SVG is a document that can carry script, and no social network accepts one anyway.
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const MEDIA_BUCKET = 'social-media';

export type ImageCheck =
  | { ok: true; ext: string }
  | { ok: false; reason: string };

export function extensionFor(type: string): string | null {
  switch (type.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

// A file the console will accept, or a reason a person can act on. An empty name means the form was
// submitted with no file chosen, which is not an error at the call sites that treat media as optional.
export function checkImage(file: { type: string; size: number } | null | undefined): ImageCheck {
  if (!file) return { ok: false, reason: 'No file was chosen.' };
  const ext = extensionFor(file.type ?? '');
  if (!ext) {
    return {
      ok: false,
      reason: 'Use a PNG, JPEG or WebP image. Other types are not accepted by the networks.',
    };
  }
  if (file.size <= 0) return { ok: false, reason: 'That file is empty.' };
  if (file.size > MAX_MEDIA_BYTES) {
    return { ok: false, reason: `Images must be under ${Math.round(MAX_MEDIA_BYTES / 1024 / 1024)} MB.` };
  }
  return { ok: true, ext };
}

// Dated and randomised: two posts can never collide, and the path stays readable in the bucket.
export function mediaObjectPath(
  ext: string,
  now: Date = new Date(),
  random: () => number = Math.random,
): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const noise = Math.floor(random() * 1e6).toString(36).padStart(4, '0');
  return `posts/${year}/${month}/${stamp}-${noise}.${ext}`;
}

// Only absolute https URLs are accepted. A relative path would be stored happily and then fail at
// the provider, which is the worst place to find out.
export function isPostableMediaUrl(url: string): boolean {
  return /^https:\/\/[^\s]+$/i.test(url.trim());
}

// The publisher takes a platform's media limit, not ours: one image is enough for a first launch,
// and asking for more invites a provider error we cannot interpret.
export const MAX_MEDIA_PER_POST = 1;
