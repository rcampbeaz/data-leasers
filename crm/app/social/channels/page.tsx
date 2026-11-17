import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { addChannel } from '@/lib/social-actions';
import { PLATFORMS, PLATFORM_LABELS, phoenixLabel, type Platform } from '@/lib/social';

type Channel = {
  id: string;
  platform: string;
  handle: string;
  display_name: string | null;
  identity_kind: string;
  status: string;
  token_expires_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

const IDENTITIES: { value: string; label: string }[] = [
  { value: 'page', label: 'Facebook Page' },
  { value: 'company', label: 'LinkedIn company page' },
  { value: 'profile', label: 'LinkedIn personal profile' },
  { value: 'business', label: 'TikTok business account' },
];

function statusClass(status: string): string {
  if (status === 'connected') return 'status approved';
  if (status === 'pending') return 'status review';
  return 'status blocked';
}

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error: message, saved } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';

  const { data, error } = await supabase
    .from('social_channels')
    .select(
      'id, platform, handle, display_name, identity_kind, status, token_expires_at, last_checked_at, last_error',
    )
    .order('platform')
    .order('handle');

  const channels = (data ?? []) as Channel[];

  return (
    <main className="page">
      <header className="page-head">
        <h1>Channels</h1>
        <p className="muted">
          The accounts a post can go to. A channel is listed here once the account exists; it is
          marked connected when the provider authorises it.
        </p>
      </header>

      <nav className="filters" aria-label="Social">
        <Link href="/social">Queue</Link>
        <Link href="/social/calendar">Calendar</Link>
        <Link href="/social/channels" className="active">
          Channels
        </Link>
        <Link href="/social/media">Media</Link>
        <Link href="/social/compose">New post</Link>
      </nav>

      {message ? <p className="notice blocked">{message}</p> : null}
      {saved ? <p className="notice">Channel added.</p> : null}
      {error ? (
        <p className="notice blocked">
          Could not load the channels. Run <code>0009_social.sql</code> in Supabase, then reload.
        </p>
      ) : null}

      <p className="notice review">
        Connecting is not built yet: the provider&rsquo;s authorisation flow arrives with the
        publishing engine. Until then a channel can be listed here, which is enough to write and
        schedule against it.
      </p>

      {channels.length === 0 && !error ? (
        <p className="muted">No channels listed yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Account</th>
              <th>Posts as</th>
              <th>Status</th>
              <th>Last checked</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id}>
                <td>{PLATFORM_LABELS[channel.platform as Platform] ?? channel.platform}</td>
                <td>
                  {channel.display_name ?? channel.handle}
                  <br />
                  <span className="muted small">{channel.handle}</span>
                </td>
                <td className="small">
                  {IDENTITIES.find((entry) => entry.value === channel.identity_kind)?.label ??
                    channel.identity_kind}
                </td>
                <td>
                  <span className={statusClass(channel.status)}>{channel.status}</span>
                  {channel.token_expires_at ? (
                    <span className="muted small">
                      <br />
                      Token until {phoenixLabel(channel.token_expires_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  ) : null}
                  {channel.last_error ? (
                    <span className="muted small wrap-cell">
                      <br />
                      {channel.last_error}
                    </span>
                  ) : null}
                </td>
                <td className="small">
                  {channel.last_checked_at
                    ? phoenixLabel(channel.last_checked_at)
                    : <span className="muted">Never</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isAdmin ? (
        <details className="panel">
          <summary>Add a channel</summary>
          <form action={addChannel} className="form-grid">
            <label>
              Platform
              <select name="platform" required defaultValue="facebook">
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {PLATFORM_LABELS[platform]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Handle
              <input name="handle" required maxLength={200} placeholder="@dataleasers" />
            </label>
            <label>
              Display name
              <input name="displayName" maxLength={200} placeholder="DataLeasers" />
            </label>
            <label>
              Posts as
              <select name="identity" defaultValue="page">
                {IDENTITIES.map((identity) => (
                  <option key={identity.value} value={identity.value}>
                    {identity.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn" type="submit">
              Add channel
            </button>
          </form>
          <p className="muted small">
            Facebook and Instagram use the Page; LinkedIn uses the company page, and a personal
            profile is a separate channel because it is a different identity.
          </p>
        </details>
      ) : null}
    </main>
  );
}
