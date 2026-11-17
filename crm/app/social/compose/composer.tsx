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
  type MediaLibraryItem,
  type Platform,
} from '@/lib/social';
import { createPost, updatePost } from '@/lib/social-actions';
import { uploadMedia } from '@/lib/media-actions';

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

// What an existing post hands back to the composer. The same component serves a new
// post and an edit, so the checks cannot differ between the two.
export type ComposerPost = {
  id: string;
  body: string;
  linkUrl: string | null;
  mediaUrl: string | null;
  mediaAlt: string | null;
  // Phoenix local time, already in the shape a datetime-local input wants.
  scheduledFor: string | null;
  channels: { channelId: string; body: string | null }[];
  // The uploaded asset, with the rights note recorded when it was uploaded.
  asset?: { id: string; rightsNote: string } | null;
};

export default function Composer({
  channels,
  post,
  library,
}: {
  channels: ChannelOption[];
  post?: ComposerPost;
  library: MediaLibraryItem[];
}) {
  const [body, setBody] = useState(post?.body ?? '');
  const [linkUrl, setLinkUrl] = useState(post?.linkUrl ?? '');
  const [mediaUrl, setMediaUrl] = useState(post?.mediaUrl ?? '');
  const [mediaAlt, setMediaAlt] = useState(post?.mediaAlt ?? '');
  const [when, setWhen] = useState(post?.scheduledFor ?? '');
  const [selected, setSelected] = useState<string[]>(
    post?.channels.map((channel) => channel.channelId) ?? [],
  );
  const [customised, setCustomised] = useState<Record<string, boolean>>(
    Object.fromEntries(
      (post?.channels ?? []).map((channel) => [channel.channelId, channel.body !== null]),
    ),
  );
  const [overrides, setOverrides] = useState<Record<string, string>>(
    Object.fromEntries(
      (post?.channels ?? []).map((channel) => [channel.channelId, channel.body ?? '']),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Media is uploaded rather than pasted: Instagram and TikTok fetch the asset themselves,
  // and a URL nobody can account for is a rights problem waiting to be published.
  const [asset, setAsset] = useState<{ id: string; rightsNote: string } | null>(
    post?.asset ?? null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [newAlt, setNewAlt] = useState('');
  const [rightsNote, setRightsNote] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const [chosenId, setChosenId] = useState('');

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

  // Reuse rather than re-upload: a second copy of the same photograph would carry a second
  // rights note, and the library would stop being a record of what we are licensed to use.
  function useExisting() {
    const item = library.find((entry) => entry.id === chosenId);
    if (!item) return;
    setMediaUrl(item.url);
    setMediaAlt(item.altText);
    setAsset({ id: item.id, rightsNote: item.rightsNote });
    setChosenId('');
  }

  function upload() {
    if (!file) return;
    setUploadError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('altText', newAlt);
    form.append('rightsNote', rightsNote);
    startUpload(async () => {
      const result = await uploadMedia(form);
      if ('error' in result) {
        setUploadError(result.error);
        return;
      }
      setMediaUrl(result.asset.url);
      setMediaAlt(result.asset.altText);
      setAsset({ id: result.asset.id, rightsNote: result.asset.rightsNote });
      setFile(null);
      setNewAlt('');
      setRightsNote('');
    });
  }

  function submit() {
    if (blocked || pending) return;
    setError(null);
    startTransition(async () => {
      const draft = {
        body,
        linkUrl: linkUrl.trim() || null,
        mediaUrl: mediaUrl.trim() || null,
        mediaAlt: mediaAlt.trim() || null,
        mediaId: asset?.id ?? null,
        scheduledFor: when || null,
        channels: selected.map((id) => ({
          channelId: id,
          body: customised[id] ? (overrides[id] ?? '') : null,
        })),
      };
      const result = post ? await updatePost(post.id, draft) : await createPost(draft);
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
          </div>
          <p className="muted small">Leave the time empty to keep it as a draft.</p>
        </div>

        <div className="panel">
          <h2>Media</h2>
          {mediaUrl.trim() ? (
            <div className="media-row">
              {mediaKindFor(mediaUrl.trim()) === 'video' ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={mediaUrl.trim()} controls muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl.trim()} alt={mediaAlt || 'Attached media'} />
              )}
              <div className="stack">
                <label>
                  Media description
                  <input
                    value={mediaAlt}
                    onChange={(event) => setMediaAlt(event.target.value)}
                    placeholder="What the asset shows, for screen readers"
                  />
                </label>
                <p className="muted small">
                  {asset
                    ? `Rights: ${asset.rightsNote}`
                    : 'Rights note not recorded for this asset.'}
                </p>
                <button
                  className="link-button"
                  type="button"
                  onClick={() => {
                    setMediaUrl('');
                    setMediaAlt('');
                    setAsset(null);
                  }}
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div className="stack">
              {library.length > 0 ? (
                <>
                  <label>
                    Use an asset already in the library
                    <select
                      value={chosenId}
                      onChange={(event) => setChosenId(event.target.value)}
                    >
                      <option value="">Choose an asset…</option>
                      {library.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.altText.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn" type="button" disabled={!chosenId} onClick={useExisting}>
                    Use this asset
                  </button>
                  <p className="muted small">
                    Reusing a file keeps one rights note for it, which is what makes the library
                    worth auditing.
                  </p>
                </>
              ) : null}

              <details>
                <summary className="muted small">Or upload a new file</summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  <label>
                    File
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <label>
                    Media description
                    <input
                      value={newAlt}
                      onChange={(event) => setNewAlt(event.target.value)}
                      placeholder="What the asset shows, for screen readers"
                    />
                  </label>
                  <label>
                    Rights note
                    <input
                      value={rightsNote}
                      onChange={(event) => setRightsNote(event.target.value)}
                      placeholder="Where it came from and what it may be used for"
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={upload}
                    disabled={!file || uploading || !newAlt.trim() || !rightsNote.trim()}
                  >
                    {uploading ? 'Uploading…' : 'Upload media'}
                  </button>
                  {uploadError ? <p className="notice blocked">{uploadError}</p> : null}
                </div>
              </details>

              <details>
                <summary className="muted small">Or attach a public URL</summary>
                <input
                  type="url"
                  value={mediaUrl}
                  onChange={(event) => setMediaUrl(event.target.value)}
                  placeholder="https://…"
                />
              </details>

              <p className="muted small">
                Instagram and TikTok fetch the asset themselves, which is why the file is
                uploaded rather than referenced. The rights note is the record of why this
                asset is ours to publish.
              </p>
            </div>
          )}
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
            {pending ? 'Saving…' : post ? 'Save changes' : when ? 'Schedule post' : 'Save draft'}
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
