'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  PLATFORM_LABELS,
  RULES,
  charCount,
  issuesForChannel,
  mediaKindFor,
  phoenixToUtc,
  type Issue,
  type Platform,
} from '@/lib/social';
import { createPost } from '@/lib/social-actions';

export type ChannelOption = {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  status: string;
};

function unique(issues: Issue[]): Issue[] {
  const seen = new Map<string, Issue>();
  for (const issue of issues) if (!seen.has(issue.message)) seen.set(issue.message, issue);
  return [...seen.values()];
}

function Media({
  url,
  alt,
  platform,
}: {
  url: string;
  alt: string;
  platform: Platform;
}) {
  const video = mediaKindFor(url) === 'video';
  return (
    <div className={`preview-media ${platform === 'tiktok' ? 'vertical' : ''}`}>
      {video ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={url} controls muted playsInline />
      ) : (
        // A preview of the asset that will be published, not decoration.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt || 'Media attached to this post'} />
      )}
    </div>
  );
}

function Chrome({ platform }: { platform: Platform }) {
  const subline =
    platform === 'facebook'
      ? 'Page'
      : platform === 'instagram'
        ? 'dataleasers'
        : platform === 'linkedin'
          ? 'Company page'
          : 'Business account';
  return (
    <div className="preview-head">
      <span className="preview-avatar" aria-hidden="true">
        DL
      </span>
      <span className="preview-who">
        DataLeasers
        <span>{subline}</span>
      </span>
    </div>
  );
}

export default function Composer({ channels }: { channels: ChannelOption[] }) {
  const [body, setBody] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaAlt, setMediaAlt] = useState('');
  const [when, setWhen] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [customised, setCustomised] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const mediaKind = mediaKindFor(mediaUrl.trim() || null);
  const hasLink = Boolean(linkUrl.trim()) || /https?:\/\//i.test(body);

  const rows = useMemo(
    () =>
      channels
        .filter((channel) => selected.includes(channel.id))
        .map((channel) => {
          const platform = channel.platform as Platform;
          const text = customised[channel.id] ? (overrides[channel.id] ?? '') : body;
          return {
            channel,
            platform,
            text,
            issues: issuesForChannel(platform, text, { mediaKind, hasLink }),
          };
        }),
    [channels, selected, customised, overrides, body, mediaKind, hasLink],
  );

  const problems: string[] = useMemo(() => {
    const list: string[] = [];
    if (selected.length === 0) list.push('Choose at least one channel.');
    for (const issue of unique(rows.flatMap((row) => row.issues))) {
      if (issue.level === 'error') list.push(issue.message);
    }
    if (when) {
      const iso = phoenixToUtc(when);
      if (!iso) list.push('That is not a date and time I can read.');
      else if (Date.parse(iso) < Date.now() - 60_000) list.push('That time has already passed.');
    }
    return list;
  }, [rows, selected, when]);

  const warnings = useMemo(
    () => unique(rows.flatMap((row) => row.issues)).filter((issue) => issue.level === 'warning'),
    [rows],
  );

  const blocked = problems.length > 0;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function submit() {
    if (blocked || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createPost({
        body,
        linkUrl: linkUrl.trim() || null,
        mediaUrl: mediaUrl.trim() || null,
        mediaAlt: mediaAlt.trim() || null,
        scheduledFor: when || null,
        channels: selected.map((id) => ({
          channelId: id,
          body: customised[id] ? (overrides[id] ?? '') : null,
        })),
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="composer">
      <div>
        <div className="panel">
          <h2>The post</h2>
          <label>
            Text
            <textarea
              rows={9}
              maxLength={10_000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write once, then adjust per channel if a platform needs it."
            />
          </label>
          <p className="muted small">{charCount(body)} characters.</p>

          <div className="form-grid">
            <label>
              Link
              <input
                type="url"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://dataleasers.com/..."
              />
            </label>
            <label>
              Publish at (Phoenix)
              <input
                type="datetime-local"
                value={when}
                onChange={(event) => setWhen(event.target.value)}
              />
            </label>
            <label>
              Media URL
              <input
                type="url"
                value={mediaUrl}
                onChange={(event) => setMediaUrl(event.target.value)}
                placeholder="A public image or video address"
              />
            </label>
            <label>
              Media description
              <input
                value={mediaAlt}
                onChange={(event) => setMediaAlt(event.target.value)}
                placeholder="What the image shows, for screen readers"
              />
            </label>
          </div>
          <p className="muted small">
            Leave the time empty to keep it as a draft. Media has to be at a public address because
            that is what Instagram and TikTok fetch.
          </p>
        </div>

        <div className="panel">
          <h2>Channels</h2>
          <div className="channel-picker">
            {channels.map((channel) => {
              const platform = channel.platform as Platform;
              return (
                <label key={channel.id} className="channel-option">
                  <input
                    type="checkbox"
                    checked={selected.includes(channel.id)}
                    onChange={() => toggle(channel.id)}
                  />
                  <span>
                    <strong>{PLATFORM_LABELS[platform]}</strong>
                    <span className="muted small"> {channel.handle}</span>
                    {channel.status !== 'connected' ? (
                      <span className="status review"> Not connected yet</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="panel">
            <h2>Adjust per channel</h2>
            <p className="muted small">
              Leave a channel alone to use the text above. Only a channel you change here is stored
              separately.
            </p>
            {rows.map((row) => (
              <div key={row.channel.id} className="stack">
                <label className="channel-option">
                  <input
                    type="checkbox"
                    checked={!!customised[row.channel.id]}
                    onChange={(event) =>
                      setCustomised((current) => ({
                        ...current,
                        [row.channel.id]: event.target.checked,
                      }))
                    }
                  />
                  <span>
                    Write a separate version for {PLATFORM_LABELS[row.platform]}
                  </span>
                </label>
                {customised[row.channel.id] ? (
                  <textarea
                    rows={4}
                    value={overrides[row.channel.id] ?? ''}
                    onChange={(event) =>
                      setOverrides((current) => ({
                        ...current,
                        [row.channel.id]: event.target.value,
                      }))
                    }
                    placeholder={body.slice(0, 200)}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div>
        <div className="panel">
          <h2>Checks</h2>
          {problems.length === 0 ? (
            <p className="issue ok">Nothing to fix.</p>
          ) : (
            <ul className="checks">
              {problems.map((problem) => (
                <li key={problem} className="issue error">
                  {problem}
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 ? (
            <ul className="checks">
              {warnings.map((warning) => (
                <li key={warning.message} className="issue warning">
                  {warning.message}
                </li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="notice blocked">{error}</p> : null}
          <button className="btn" type="button" onClick={submit} disabled={blocked || pending}>
            {pending ? 'Saving…' : when ? 'Schedule post' : 'Save draft'}
          </button>
          <p className="muted small" style={{ marginTop: 10 }}>
            Saving records the post and its channels. Nothing is sent to a platform yet: publishing
            is the next phase.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="muted">Choose a channel to see how the post will look on it.</p>
        ) : null}

        {rows.map((row) => (
          <div key={row.channel.id} className="preview-wrap">
            <div className={`preview ${row.platform}`}>
              {row.platform === 'instagram' ? (
                <div className="preview-head">
                  <span className="preview-avatar" aria-hidden="true">
                    DL
                  </span>
                  <span className="preview-who">
                    dataleasers
                    <span>Instagram</span>
                  </span>
                </div>
              ) : null}
              {row.platform === 'tiktok' || row.platform === 'instagram' ? (
                mediaUrl.trim() ? (
                  <Media url={mediaUrl.trim()} alt={mediaAlt} platform={row.platform} />
                ) : (
                  <div className={`preview-media ${row.platform === 'tiktok' ? 'vertical' : ''}`}>
                    {row.platform === 'tiktok' ? 'A video is required' : 'A photo or video is required'}
                  </div>
                )
              ) : null}
              {row.platform === 'facebook' || row.platform === 'linkedin' ? (
                <Chrome platform={row.platform} />
              ) : null}
              <div className={`preview-body ${row.platform === 'tiktok' ? 'caption' : ''}`}>
                {row.text.trim() || <span className="muted">Nothing yet.</span>}
              </div>
              {linkUrl.trim() ? <div className="preview-link">{linkUrl.trim()}</div> : null}
              {row.platform === 'facebook' || row.platform === 'linkedin' ? (
                mediaUrl.trim() ? (
                  <Media url={mediaUrl.trim()} alt={mediaAlt} platform={row.platform} />
                ) : null
              ) : null}
              <div className="preview-foot">
                <span className={charCount(row.text) > RULES[row.platform].maxChars ? 'overdue' : ''}>
                  {charCount(row.text).toLocaleString('en-US')} /{' '}
                  {RULES[row.platform].maxChars.toLocaleString('en-US')}
                </span>
                <span>{PLATFORM_LABELS[row.platform]}</span>
              </div>
            </div>
            <p className="muted small">{RULES[row.platform].note}</p>
            {unique(row.issues).map((issue) => (
              <p key={issue.message} className={`issue ${issue.level}`}>
                {issue.message}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
