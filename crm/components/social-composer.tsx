'use client';

import { useState } from 'react';
import { CHANNELS, type Channel } from '@/lib/social';

// The composer the scheduling tools have: pick channels, write, see how the post will look on each
// network, and watch the limits as you type instead of finding out when scheduling is refused.
//
// One base post is sent, plus optional text per channel. A channel with no text of its own uses the
// base, which is what the scheduler falls back to (variants[channel] ?? body), so leaving a box empty
// is the normal case rather than an omission. This is what lets LinkedIn stay long while X stays
// under 280 without writing the whole post twice.

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  connected: string[];
};

const initials = (key: Channel) =>
  ({ linkedin: 'in', facebook: 'f', instagram: 'ig', tiktok: 'tt', bluesky: 'bs', x: 'x' })[key];

export function SocialComposer({ action, connected }: Props) {
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [variants, setVariants] = useState<Partial<Record<Channel, string>>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [picked, setPicked] = useState<Channel[]>(() => {
    const first = CHANNELS.find((c) => connected.includes(c.key));
    return first ? [first.key] : ['linkedin'];
  });

  const toggle = (key: Channel) =>
    setPicked((current) =>
      current.includes(key) ? current.filter((c) => c !== key) : [...current, key],
    );

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (!file) {
      setImageUrl(null);
      setImageName(null);
      return;
    }
    setImageUrl(URL.createObjectURL(file));
    setImageName(file.name);
  };

  // What a given network will actually receive.
  const textFor = (key: Channel) => {
    const own = variants[key];
    return own && own.trim() ? own : body;
  };

  const previews = CHANNELS.filter((c) => picked.includes(c.key));
  const customised = previews.filter((c) => (variants[c.key] ?? '').trim().length > 0);

  return (
    <form action={action} className="composer">
      <div className="composer-main">
        <div className="channel-chips" role="group" aria-label="Channels this post is for">
          {CHANNELS.map((c) => {
            const isConnected = connected.includes(c.key);
            return (
              <button
                key={c.key}
                type="button"
                className="chip"
                aria-pressed={picked.includes(c.key)}
                onClick={() => toggle(c.key)}
                title={isConnected ? c.label : `${c.label}: no account connected yet`}
              >
                <span className="chip-mark" aria-hidden="true">
                  {initials(c.key)}
                </span>
                {c.key}
                {isConnected ? null : <span className="chip-dot" aria-label="not connected" />}
              </button>
            );
          })}
        </div>

        <label className="editor">
          <span className="small muted">Post</span>
          <textarea
            name="body"
            required
            rows={9}
            maxLength={20000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What is worth saying? A number only with its source; the buyer is never named."
          />
        </label>

        <div className="counter-row" aria-live="polite">
          {previews.length === 0 ? (
            <span className="muted small">Pick a channel to see its limit.</span>
          ) : null}
          {previews.map((c) => {
            const text = textFor(c.key);
            const left = c.limit - text.length;
            return (
              <span
                key={c.key}
                className={`counter${left < 0 ? ' over' : ''}`}
                title={`${c.label} allows ${c.limit} characters`}
              >
                {c.key} {left < 0 ? `${Math.abs(left)} over` : `${left} left`}
                {c.needsMedia && !imageName ? ' · needs an image' : ''}
              </span>
            );
          })}
        </div>

        <details className="variants" open={customised.length > 0}>
          <summary>
            Different text per channel
            <span className="small muted">
              {customised.length > 0
                ? ` · ${customised.map((c) => c.key).join(', ')} differ`
                : ' · optional'}
            </span>
          </summary>
          {previews.length === 0 ? (
            <p className="small muted">Pick a channel first.</p>
          ) : (
            previews.map((c) => {
              const value = variants[c.key] ?? '';
              const length = textFor(c.key).length;
              return (
                <label key={c.key} className="variant-field">
                  <span className="small muted">
                    {c.label}
                    <span className={length > c.limit ? 'over-count' : ''}>
                      {' '}
                      {length}/{c.limit}
                    </span>
                  </span>
                  <textarea
                    name={`variant_${c.key}`}
                    rows={4}
                    maxLength={20000}
                    value={value}
                    onChange={(e) => setVariants((v) => ({ ...v, [c.key]: e.target.value }))}
                    placeholder="Leave empty to use the main post."
                  />
                </label>
              );
            })
          )}
        </details>

        <div className="composer-fields">
          <label>
            <span className="small muted">Title, for the queue only</span>
            <input name="title" maxLength={200} placeholder="Optional" />
          </label>
          <label>
            <span className="small muted">Link</span>
            <input
              name="link"
              maxLength={1000}
              placeholder="https://dataleasers.com/..."
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
        </div>

        <label className="upload">
          <span className="small muted">Image (PNG, JPEG or WebP, under 5 MB)</span>
          <input type="file" name="image" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
          {imageName ? <span className="small muted">{imageName}</span> : null}
        </label>

        <button className="btn" type="submit">
          Save draft
        </button>
      </div>

      <aside className="composer-side" aria-label="Preview">
        {previews.length === 0 ? (
          <div className="preview">
            <p className="preview-empty">No channel selected. Preview appears here.</p>
          </div>
        ) : null}
        {previews.map((c) => {
          const text = textFor(c.key);
          const over = text.length > c.limit;
          const own = (variants[c.key] ?? '').trim().length > 0;
          return (
            <div key={c.key} className="preview">
              <div className="preview-head">
                <span className="avatar" aria-hidden="true">
                  dl
                </span>
                <span>
                  <span className="preview-name">DataLeasers</span>
                  <span className="preview-meta">
                    {c.label} · {text.length}/{c.limit}
                    {over ? ' · too long' : ''}
                    {own ? ' · own text' : ''}
                  </span>
                </span>
              </div>
              <p className="preview-body">
                {text.trim() ? (
                  text.slice(0, 900)
                ) : (
                  <span className="preview-empty">Your post appears here.</span>
                )}
              </p>
              {imageUrl ? <img className="preview-media" src={imageUrl} alt="" /> : null}
              {link ? (
                <p className="preview-link">
                  {c.key === 'instagram'
                    ? 'Instagram captions do not carry clickable links: put it in the first comment.'
                    : link}
                </p>
              ) : null}
            </div>
          );
        })}
      </aside>
    </form>
  );
}
