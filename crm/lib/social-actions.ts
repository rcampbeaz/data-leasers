'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { MEDIA_BUCKET, checkImage, isPostableMediaUrl, mediaObjectPath } from '@/lib/social-media';
import { currentStaff } from '@/lib/data';
import {
  CHANNELS,
  blockingProblems,
  channelSpec,
  lintPost,
  retryAdvice,
  retryRoute,
  type Channel,
} from '@/lib/social';
import { phoenixInputToUtc } from '@/lib/time';

// Everything here writes drafts, schedules them, or cancels them. Publishing happens in
// the cron route, which is the only place that talks to a provider.

const PATH = '/marketing';
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
// Any OpenAI-compatible endpoint works, so a free provider (Groq, Google AI Studio, OpenRouter) can
// replace a paid OpenAI key by changing two values. Blank keeps OpenAI.
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function text(formData: FormData, key: string, max: number): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

function chosenChannels(formData: FormData): Channel[] {
  const raw = formData.getAll('channels').map(String);
  return CHANNELS.map((c) => c.key).filter((key) => raw.includes(key));
}

async function requireWriter() {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    fail('Your role does not allow this. Admin or introducer access is needed.');
  }
  return { supabase, me };
}

// Proves the provider works from inside the app, so nobody needs a terminal on the server to find
// out why drafting is refused. It ignores the agent switches on purpose: a test you cannot run while
// the feature is switched off is not a test. It also does not write an agent_runs row, so it never
// counts against the daily cap.
export async function testAi() {
  await requireWriter();

  const key = process.env.OPENAI_API_KEY ?? '';
  if (!key) {
    fail('No OPENAI_API_KEY on the server. Add it to .env, redeploy, then test again.');
  }

  const started = Date.now();

  // The key check and the model list, in one call that costs nothing.
  let listStatus = 0;
  let models: string[] = [];
  let listError: string | null = null;
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    listStatus = response.status;
    if (response.ok) {
      const body = (await response.json()) as { data?: { id?: string }[] };
      models = (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    }
  } catch (error) {
    listError = error instanceof Error ? error.message : 'unknown error';
  }

  if (listError) fail(`Could not reach ${OPENAI_BASE_URL}: ${listError}`);
  if (listStatus === 401 || listStatus === 403) {
    fail(`The provider rejected the key (HTTP ${listStatus}). Revoke it and create a new one.`);
  }
  if (listStatus !== 200) {
    fail(
      `The provider answered HTTP ${listStatus} for ${OPENAI_BASE_URL}/models. Check OPENAI_BASE_URL; for Groq it is exactly https://api.groq.com/openai/v1`,
    );
  }

  // A model can be configured and invisible to the key. Saying which ids are visible beats guessing,
  // and speech and embedding models are left out because they cannot write a post.
  if (models.length > 0 && !models.includes(MODEL)) {
    const chatModels = models
      .filter((id) => !/(whisper|tts|guard|orpheus|embed)/i.test(id))
      .slice(0, 6);
    fail(
      `The model "${MODEL}" is not available to this key. Set OPENAI_MODEL to one of: ${chatModels.join(', ') || 'see the provider dashboard'}.`,
    );
  }

  // One real call, because a listed model can still fail on tier, capacity or context.
  let chatStatus = 0;
  let reply = '';
  let chatError: string | null = null;
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        max_tokens: 10,
        temperature: 0,
      }),
    });
    chatStatus = response.status;
    const body = (await response.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    reply = (body.choices?.[0]?.message?.content ?? '').trim();
    if (!response.ok) chatError = body.error?.message ?? '';
  } catch (error) {
    fail(`The test call could not be made: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  if (chatStatus === 429) {
    fail('The provider rate-limited the test (429). The free Groq plan allows 30 calls a minute, 1,000 a day.');
  }
  if (chatStatus !== 200) {
    fail(`The test call failed with HTTP ${chatStatus}${chatError ? `: ${chatError.slice(0, 200)}` : '.'}`);
  }

  const ms = Date.now() - started;
  revalidatePath(PATH);
  redirect(
    `${PATH}?ai=${encodeURIComponent(
      `AI works. ${MODEL} answered in ${ms} ms${reply ? ` with "${reply.slice(0, 40)}"` : ''}.`,
    )}&aiok=1`,
  );
}

// Writes a set of channel variants from a topic or an existing page. The model is told
// what it may not do: invent figures, name the buyer, or promise an outcome.
export async function generateDraft(formData: FormData) {
  const { supabase, me } = await requireWriter();

  const topic = text(formData, 'topic', 400);
  if (!topic) fail('Describe what the post is about first.');
  const link = text(formData, 'link', 1000);

  // Two switches gate a drafting run: the agent switch on the Agents page, and the
  // drafting switch on this console, so either place can stop spending money.
  const [{ data: setting }, { data: marketing }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'agents').maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', 'marketing').maybeSingle(),
  ]);
  const marketingControls = (marketing?.value ?? {}) as { drafting_enabled?: boolean };
  if (marketingControls.drafting_enabled === false) {
    fail('Agent drafting is switched off in the Marketing console.');
  }

  const controls = (setting?.value ?? { enabled: false, daily_cap: 0 }) as {
    enabled?: boolean;
    daily_cap?: number;
  };
  if (controls.enabled !== true) fail('Agents are switched off. Turn them on in the Agents page.');

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .gte('started_at', startOfDay.toISOString());
  if ((count ?? 0) >= Number(controls.daily_cap ?? 0)) {
    fail(`Today's cap of ${controls.daily_cap} agent runs has been reached.`);
  }

  if (!process.env.OPENAI_API_KEY) fail('OpenAI is not configured on the server yet.');

  const system =
    'You write social posts for DataLeasers, which introduces companies to a buyer that ' +
    'licenses company data for AI. Never invent a statistic, price, customer or outcome. ' +
    'Never name the buyer; write "the data buyer". Plain English, no hype, no emoji spam. ' +
    'If you cite a number, it must already be in the material you were given.';

  const user =
    `Topic: ${topic}\n` +
    (link ? `Link to include: ${link}\n` : '') +
    'Write one version for each of these channels, each under its character limit: ' +
    'linkedin (900 characters of substance), x (under 280), bluesky (under 300), ' +
    'and a shorter instagram caption under 1200 characters.\n' +
    'Use exactly this format, one block per channel, nothing else:\n' +
    '---CHANNEL:linkedin---\n<text>\n---CHANNEL:x---\n<text>\n' +
    '---CHANNEL:bluesky---\n<text>\n---CHANNEL:instagram---\n<text>';

  const run = await supabase
    .from('agent_runs')
    .insert({
      agent: 'content_drafter',
      model: MODEL,
      input_summary: topic.slice(0, 300),
      status: 'running',
      requested_by: me.user_id,
    })
    .select('id')
    .single();
  if (run.error || !run.data) fail('Could not start the run.');

  let output = '';
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const json = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    output = json.choices[0]?.message?.content?.trim() ?? '';
    promptTokens = json.usage?.prompt_tokens ?? null;
    completionTokens = json.usage?.completion_tokens ?? null;

    await supabase
      .from('agent_runs')
      .update({
        status: 'succeeded',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.data.id);
  } catch (error) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.data.id);
    fail('The draft run failed. Check the Agents page for the recorded error.');
  }

  // Parse the marked blocks. Anything unparseable is kept as one body rather than lost.
  const variants: Record<string, string> = {};
  const blocks = output.split(/---CHANNEL:([a-z]+)---/i);
  for (let i = 1; i < blocks.length; i += 2) {
    const key = blocks[i]?.toLowerCase();
    const value = blocks[i + 1]?.trim();
    if (key && value && channelSpec(key)) variants[key] = value;
  }

  const first = variants.linkedin ?? variants.x ?? output.trim();
  if (!first) fail('The model returned nothing usable. Try a shorter topic.');

  const { error } = await supabase.from('social_contents').insert({
    title: topic.slice(0, 200),
    body: first.slice(0, 20000),
    variants,
    link,
    status: 'draft',
    created_by: me.user_id,
  });
  if (error) fail('Could not save the draft.');

  revalidatePath(PATH);
  redirect(`${PATH}?drafted=1`);
}

// Uploads one image and returns its public URL. Service role, because the bucket is written from the
// server and the file has already been checked here. Returns null when no file was chosen.
async function uploadImage(file: File | null): Promise<string | null> {
  if (!file || !file.name) return null;

  const check = checkImage({ type: file.type, size: file.size });
  if (!check.ok) fail(check.reason);

  const storage = createIntakeClient().storage.from(MEDIA_BUCKET);
  const path = mediaObjectPath(check.ext);

  const { error } = await storage.upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) fail('Could not upload the image. Check the social-media bucket exists (0018).');

  const { data } = storage.getPublicUrl(path);
  if (!data?.publicUrl || !isPostableMediaUrl(data.publicUrl)) {
    fail('The image uploaded but its public URL looks wrong. Is the bucket public?');
  }
  return data.publicUrl;
}

// Writing a post by hand. Without this, every post had to come out of a model run, which put a paid
// API key on the critical path to publishing anything at all - the console could draft but not be
// used. The agent stays an option rather than a dependency.
export async function writePost(formData: FormData) {
  const { supabase, me } = await requireWriter();

  const body = text(formData, 'body', 20000);
  if (!body) fail('Write the post first.');
  if (body.length < 20) fail('That is too short to be worth posting.');

  const link = text(formData, 'link', 1000);
  if (link && !/^https?:\/\//i.test(link)) fail('A link must start with http:// or https://.');

  const imageUrl = await uploadImage(formData.get('image') as File | null);

  // Optional text per channel. An empty box means "use the main post", which is exactly what the
  // scheduler already falls back to, so a variant is stored only when it genuinely differs - otherwise
  // a copy would freeze at the moment of writing and stop tracking later edits.
  const variants: Record<string, string> = {};
  for (const spec of CHANNELS) {
    const own = text(formData, `variant_${spec.key}`, 20000);
    if (own && own !== body) variants[spec.key] = own;
  }

  const { error } = await supabase.from('social_contents').insert({
    title: text(formData, 'title', 200) ?? body.slice(0, 80),
    body,
    variants,
    link,
    media: imageUrl ? [imageUrl] : [],
    status: 'draft',
    created_by: me.user_id,
  });
  if (error) fail('Could not save the post.');

  revalidatePath(PATH);
  redirect(`${PATH}?wrote=1`);
}

// Attaches an image to a draft that already exists. This is what makes an agent draft usable on
// Instagram at all: the model writes text, it cannot supply a picture.
export async function attachImage(contentId: string, formData: FormData) {
  const { supabase } = await requireWriter();

  const { data: content } = await supabase
    .from('social_contents')
    .select('id, status')
    .eq('id', contentId)
    .maybeSingle();
  if (!content) fail('That draft could not be found.');
  if (!['draft', 'approved'].includes(String(content.status))) {
    fail('That content is already scheduled. Cancel it first to change the image.');
  }

  const imageUrl = await uploadImage(formData.get('image') as File | null);
  if (!imageUrl) fail('Choose an image to attach.');

  const { error } = await supabase
    .from('social_contents')
    .update({ media: [imageUrl] })
    .eq('id', contentId);
  if (error) fail('Could not attach the image.');

  revalidatePath(PATH);
  redirect(`${PATH}?attached=1`);
}

// Removes the image from a draft, for the case where the wrong one was chosen.
export async function removeImage(contentId: string) {
  const { supabase } = await requireWriter();
  const { error } = await supabase
    .from('social_contents')
    .update({ media: [] })
    .eq('id', contentId)
    .in('status', ['draft', 'approved']);
  if (error) fail('Could not remove the image.');
  revalidatePath(PATH);
  redirect(`${PATH}?attached=0`);
}

// Schedules one content item to the chosen channels. Every channel is validated against
// its own limit and the brand rules before a single row is written, so a post is either
// scheduled everywhere it was asked for, or nowhere.
export async function scheduleContent(contentId: string, formData: FormData) {
  const { supabase } = await requireWriter();

  const channels = chosenChannels(formData);
  if (channels.length === 0) fail('Choose at least one channel.');

  const scheduledFor = phoenixInputToUtc(String(formData.get('scheduledFor') ?? ''));
  if (!scheduledFor) fail('Choose a date and time in Phoenix time.');
  if (scheduledFor.getTime() < Date.now() - 60_000) fail('That time has already passed.');

  const { data: content } = await supabase
    .from('social_contents')
    .select('id, body, variants, media, link, status')
    .eq('id', contentId)
    .maybeSingle();
  if (!content) fail('That draft could not be found.');
  if (!['draft', 'approved'].includes(String(content.status))) {
    fail('That content has already been scheduled or cancelled.');
  }

  // Approval is a real gate, not a banner: with the switch on, an unapproved draft
  // cannot be scheduled at all.
  const { data: marketing } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'marketing')
    .maybeSingle();
  const requireApproval = ((marketing?.value ?? {}) as { require_approval?: boolean }).require_approval === true;
  if (requireApproval && content.status !== 'approved') {
    fail('Approval is required. Approve this draft first, then schedule it.');
  }

  const variants = (content.variants ?? {}) as Record<string, string>;
  const media = Array.isArray(content.media) ? (content.media as string[]) : [];
  const { data: channelRows } = await supabase
    .from('social_channels')
    .select('id, platform, status')
    .in('platform', channels);

  const byPlatform = new Map<string, { id: string; platform: string; status: string }>();
  for (const row of (channelRows ?? []) as { id: string; platform: string; status: string }[]) {
    byPlatform.set(row.platform, row);
  }

  const problems: string[] = [];
  for (const channel of channels) {
    const row = byPlatform.get(channel);
    if (!row) {
      problems.push(`${channelSpec(channel)?.label ?? channel} is not connected yet.`);
      continue;
    }
    if (row.status !== 'active') {
      problems.push(`${channelSpec(channel)?.label ?? channel} needs reconnecting.`);
      continue;
    }
    const body = variants[channel] ?? String(content.body ?? '');
    const lints = lintPost(body, { channel, hasMedia: media.length > 0 });
    for (const message of blockingProblems(lints)) {
      problems.push(`${channelSpec(channel)?.label ?? channel}: ${message}`);
    }
  }
  if (problems.length > 0) fail(problems.slice(0, 4).join(' '));

  const rows = channels.map((channel) => ({
    content_id: contentId,
    channel_id: byPlatform.get(channel)!.id,
    body: (variants[channel] ?? String(content.body ?? '')).slice(0, 20000),
    first_comment: channel === 'instagram' && content.link ? String(content.link) : null,
    media,
    scheduled_for: scheduledFor.toISOString(),
    status: 'scheduled' as const,
  }));

  // A cancelled row still holds its (content, channel) pair, and the table is uniquely constrained
  // on it, so scheduling the same content to a channel it was cancelled from would be rejected.
  // Cancelled rows can never send, so the pair is cleared for the channels being scheduled now — but
  // only the insert decides whether that was the right move, so the rows it removed are kept rather
  // than trusted to be unnecessary.
  const { data: dropped } = await supabase
    .from('social_posts')
    .delete()
    .eq('content_id', contentId)
    .eq('status', 'cancelled')
    .in('channel_id', rows.map((row) => row.channel_id))
    .select('*');

  const { error } = await supabase.from('social_posts').insert(rows);
  if (error) {
    // A rejected insert writes nothing, so the pairs are free again and the cancelled rows go back
    // exactly as they were — same ids, same timestamps. If even that fails the error says so, rather
    // than reporting a plain scheduling failure over a record that is now gone.
    const restore = (dropped ?? []) as Record<string, unknown>[];
    let restoreFailed = false;
    if (restore.length > 0) {
      const { error: restoreError } = await supabase.from('social_posts').insert(restore);
      restoreFailed = Boolean(restoreError);
    }
    fail(
      restoreFailed
        ? 'Could not schedule, and the cancelled post on that channel could not be put back. Schedule it again to recreate it.'
        : 'Could not schedule. One of these channels may already have this post.',
    );
  }

  await supabase.from('social_contents').update({ status: 'scheduled' }).eq('id', contentId);

  revalidatePath(PATH);
  redirect(`${PATH}?scheduled=1`);
}

// The other exit from a stopped post. Cancelling throws the work away, which is wrong when the
// reason it stopped has since been fixed — a reconnected channel is holding a queue it can now
// send. Retry clears what was recorded and puts the row back in the queue: zero attempts, so the
// whole backoff ladder is available again, and no retry time, so the next cron tick claims it.
// scheduled_for is deliberately left where it is; being in the past is what makes it due.
export async function retryPost(postId: string) {
  const { supabase } = await requireWriter();

  const { data: post } = await supabase
    .from('social_posts')
    .select('id, status, channel_id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) fail('That post could not be found.');
  if (!['failed', 'needs_manual'].includes(String(post.status))) {
    fail('Only a post that has stopped can be retried.');
  }

  // The commonest reason a post is sitting here is a dead token, so check the channel first.
  // Retrying into a channel that still needs reconnecting only spends another attempt to reach
  // the same ending. The question and the explanation both come from lib/social, which is also where
  // the stop messages get theirs.
  const { data: channel } = await supabase
    .from('social_channels')
    .select('status')
    .eq('id', post.channel_id)
    .maybeSingle();
  const status = channel ? String(channel.status) : null;
  if (retryRoute(status) !== 'retry') fail(retryAdvice(status));

  const { error } = await supabase
    .from('social_posts')
    .update({
      status: 'scheduled',
      attempts: 0,
      next_retry_at: null,
      last_error_code: null,
      last_error: null,
    })
    .eq('id', postId)
    .in('status', ['failed', 'needs_manual']);
  if (error) fail('Could not put that post back in the queue.');

  revalidatePath(PATH);
}

// A post that has stopped and asked for a person can only leave the queue this way, so
// 'needs_manual' belongs here as well as the two states that are still moving on their own.
// Cancelling is the way out the alert recommends when a channel has gone, so it has to leave the
// content usable. Scheduling moves the content to 'scheduled' and nothing moved it back, which left
// the content invisible on Ready to schedule with no way to schedule it again.
export async function cancelPost(postId: string) {
  const { supabase } = await requireWriter();

  const { data: cancelled } = await supabase
    .from('social_posts')
    .update({ status: 'cancelled' })
    .eq('id', postId)
    .in('status', ['scheduled', 'failed', 'needs_manual'])
    .select('id, content_id');
  if (!cancelled || cancelled.length === 0) {
    // Already published or already cancelled: leave the content's own state alone.
    revalidatePath(PATH);
    return;
  }

  const contentId = String((cancelled[0] as { content_id: string }).content_id);
  const { data: siblings } = await supabase
    .from('social_posts')
    .select('status')
    .eq('content_id', contentId)
    .neq('id', postId);

  const states = ((siblings ?? []) as { status: string }[]).map((row) => String(row.status));
  const queued = states.some((s) => s === 'scheduled' || s === 'publishing');
  const published = states.some((s) => s === 'published');

  // Back to approved rather than draft: cancelling one channel does not withdraw the approval. A
  // content with another channel still published cannot be scheduled as a whole again, so it is
  // recorded as published instead of being offered as ready.
  const next = queued ? 'scheduled' : published ? 'published' : 'approved';
  await supabase
    .from('social_contents')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', contentId)
    .in('status', ['scheduled', 'published']);

  revalidatePath(PATH);
}

// The other half of what the publisher does. A dead token sets the channel needs_reauth, and
// addChannel only inserts, so a channel that had been reconnected at the provider stayed unusable
// for ever and the posts waiting on it could never be retried. Reconnecting itself happens with the
// provider; this records that it has, and clears the error left by the failure that took it down.
// No attempt count is touched, because that belongs to the posts, not the channel.
export async function reactivateChannel(channelId: string) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') fail('Only an admin can mark a channel active.');

  const { error } = await supabase
    .from('social_channels')
    .update({ status: 'active', last_error: null })
    .eq('id', channelId)
    .in('status', ['needs_reauth', 'revoked']);
  if (error) fail('Could not mark that channel active.');

  revalidatePath(PATH);
}

// Registers a channel by hand, storing only the provider's profile key. OAuth flows are
// per-platform and arrive with the provider; this is enough to schedule and publish.
export async function addChannel(formData: FormData) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || me.role !== 'admin') fail('Only an admin can connect a channel.');

  const platform = String(formData.get('platform') ?? '') as Channel;
  if (!channelSpec(platform)) fail('Choose a supported platform.');

  const displayName = text(formData, 'displayName', 200);
  if (!displayName) fail('Enter the account name as it appears on the platform.');

  const externalId = text(formData, 'externalId', 200);
  if (!externalId) fail('Enter the provider profile id for this account.');

  const expiresRaw = String(formData.get('tokenExpiresAt') ?? '');
  const expires = expiresRaw ? new Date(expiresRaw) : null;
  if (expires && Number.isNaN(expires.getTime())) fail('The expiry date is not valid.');

  const { error } = await supabase.from('social_channels').insert({
    platform,
    external_id: externalId,
    display_name: displayName,
    username: text(formData, 'username', 200),
    provider: 'aggregator',
    credentials: { profile_id: externalId },
    token_expires_at: expires ? expires.toISOString() : null,
    status: 'active',
  });
  if (error) fail('Could not save the channel. It may already be connected.');

  revalidatePath(PATH);
  redirect(`${PATH}?channel=1`);
}
