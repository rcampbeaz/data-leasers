'use client';

import { useState } from 'react';
import { CHANNELS, type Channel } from '@/lib/social';

// The composer the scheduling tools have: pick channels, write once, see how the post will look on
// each network, and watch the limits as you type instead of finding out when scheduling is refused.
//
// One body is still sent, because that is what is stored and what the per-channel rules are applied
// to at scheduling time. The previews are honest about that: they show the same text at each
// network's width, and count characters against each network's limit.

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  connected: string[];
};

const initials = (key: Channel) =>
  ({ linkedin: 'in', facebook: 'f', instagram: 'ig', tiktok: 'tt', bluesky: 'bs', x: 'x' })[key];

export function SocialComposer({ action, connected }: Props) {
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
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

  const previews = CHANNELS.filter((c) => picked.includes(c.key));

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
          {previews.length === 0 ? <span className="muted small">Pick a channel to see its limit.</span> : null}
          {previews.map((c) => {
            const left = c.limit - body.length;
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
          const over = body.length > c.limit;
          return (
            <div key={c.key} className="preview">
              <div className="preview-head">
                <span className="avatar" aria-hidden="true">
                  dl
                </span>
                <span>
                  <span className="preview-name">DataLeasers</span>
                  <span className="preview-meta">
                    {c.label} · {body.length}/{c.limit}
                    {over ? ' · too long' : ''}
                  </span>
                </span>
              </div>
              <p className="preview-body">
                {body.trim() ? body.slice(0, 900) : <span className="preview-empty">Your post appears here.</span>}
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
