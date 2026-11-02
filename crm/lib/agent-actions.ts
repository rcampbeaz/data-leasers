'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';

// Agents only write drafts. Nothing is sent from here. A staff member approves a draft
// in the Agents page, and sending is a separate step that is not built yet.

const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

async function loadControls() {
  const admin = createIntakeClient();
  const { data } = await admin.from('app_settings').select('value').eq('key', 'agents').maybeSingle();
  const value = (data?.value ?? {}) as { enabled?: boolean; daily_cap?: number };
  return { enabled: value.enabled === true, dailyCap: Number(value.daily_cap ?? 0) };
}

// Blocks a run if agents are off, the daily cap is used up, or no key is configured.
async function checkBeforeRun(path: string) {
  const { enabled, dailyCap } = await loadControls();
  if (!enabled) fail(path, 'Agents are switched off. An admin can turn them on in this page.');

  const admin = createIntakeClient();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count } = await admin
    .from('agent_runs')
    .select('id', { count: 'exact', head: true })
    .gte('started_at', startOfDay.toISOString());
  if ((count ?? 0) >= dailyCap) fail(path, `Today's cap of ${dailyCap} agent runs has been reached.`);

  if (!process.env.OPENAI_API_KEY) fail(path, 'OpenAI is not configured on the server yet.');
}

// One call to the OpenAI chat API. Returns the text and token counts.
async function callOpenAI(system: string, user: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
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
  return {
    text: json.choices[0]?.message?.content?.trim() ?? '',
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
  };
}

const RULES =
  'You are an internal assistant for a data-licensing introducer. ' +
  'Never invent facts. If something is unknown, say so. ' +
  'Flag any personal data or rights questions. Do not promise outcomes or prices. ' +
  'Write plain English.';

async function runAndDraft(opts: {
  path: string;
  agent: 'lead_triage' | 'follow_up_drafter';
  kind: 'triage_summary' | 'follow_up_email';
  title: string;
  leadId?: string;
  companyId?: string;
  inputSummary: string;
  user: string;
  requestedBy: string;
}) {
  const admin = createIntakeClient();
  const { data: run, error } = await admin
    .from('agent_runs')
    .insert({
      agent: opts.agent,
      lead_id: opts.leadId ?? null,
      company_id: opts.companyId ?? null,
      model: MODEL,
      input_summary: opts.inputSummary,
      status: 'running',
      requested_by: opts.requestedBy,
    })
    .select('id')
    .single();
  if (error || !run) fail(opts.path, 'Could not start the run.');

  try {
    const result = await callOpenAI(RULES, opts.user);
    await admin.from('agent_drafts').insert({
      run_id: run.id,
      lead_id: opts.leadId ?? null,
      company_id: opts.companyId ?? null,
      kind: opts.kind,
      title: opts.title,
      body: result.text || '(empty response)',
    });
    await admin
      .from('agent_runs')
      .update({
        status: 'succeeded',
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
  } catch (err) {
    await admin
      .from('agent_runs')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 300) : 'Unknown error',
        finished_at: new Date().toISOString(),
      })
      .eq('id', run.id);
  }

  revalidatePath('/agents');
  redirect('/agents?ran=1');
}

// Triage a website or manual lead. Sends company, role and data note only; not the email address.
export async function runLeadTriage(formData: FormData) {
  const path = '/agents';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) fail(path, 'Your role does not allow this.');

  const leadId = String(formData.get('leadId') ?? '');
  await checkBeforeRun(path);

  const { data: lead } = await createIntakeClient()
    .from('leads')
    .select('name, company, role_title, data_note')
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) fail(path, 'That lead could not be found.');

  await runAndDraft({
    path,
    agent: 'lead_triage',
    kind: 'triage_summary',
    title: `Triage: ${lead.company}`,
    leadId,
    inputSummary: lead.company,
    requestedBy: me.user_id,
    user:
      `Company: ${lead.company}\nContact role: ${lead.role_title ?? 'not given'}\n` +
      `Data they describe: ${lead.data_note ?? 'not given'}\n\n` +
      'Write a short triage: likely fit, what to ask on the first call, and any rights or personal-data risks to check first.',
  });
}

// Drafts a follow-up email for a company. Uses the latest notes; the draft is never sent.
export async function runFollowUpDraft(formData: FormData) {
  const path = '/agents';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) fail(path, 'Your role does not allow this.');

  const companyId = String(formData.get('companyId') ?? '');
  await checkBeforeRun(path);

  const admin = createIntakeClient();
  const [{ data: company }, { data: activities }, { data: contacts }] = await Promise.all([
    admin.from('companies').select('name, stage, next_action').eq('id', companyId).maybeSingle(),
    admin.from('activities').select('kind, body, call_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
    admin.from('contacts').select('name, role_title').eq('company_id', companyId).limit(1),
  ]);
  if (!company) fail(path, 'That company could not be found.');

  const notes = (activities ?? [])
    .map((a) => `${a.kind}${a.call_at ? ` (${a.call_at})` : ''}: ${a.body ?? ''}`)
    .join('\n');
  const contact = contacts?.[0];

  await runAndDraft({
    path,
    agent: 'follow_up_drafter',
    kind: 'follow_up_email',
    title: `Follow-up: ${company.name}`,
    companyId,
    inputSummary: company.name,
    requestedBy: me.user_id,
    user:
      `Company: ${company.name}\nStage: ${company.stage}\nNext action: ${company.next_action ?? 'none set'}\n` +
      `Contact: ${contact?.name ?? 'unknown'}${contact?.role_title ? `, ${contact.role_title}` : ''}\n` +
      `Recent notes:\n${notes || 'none'}\n\n` +
      'Draft a short, polite follow-up email from Data Leasers to the contact. Use a subject line on the first line, then the body. Do not promise terms.',
  });
}

// Approve or reject a draft. Approval is recorded as a row in approvals, which sets the draft status.
export async function decideDraft(formData: FormData) {
  const path = '/agents';
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) fail(path, 'Your role does not allow this.');

  const draftId = String(formData.get('draftId') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (decision !== 'approved' && decision !== 'rejected') fail(path, 'Choose approve or reject.');

  const { error } = await supabase.from('approvals').insert({
    draft_id: draftId,
    decision,
    decided_by: me.user_id,
  });
  if (error) fail(path, 'Could not record the decision.');

  revalidatePath(path);
  redirect(path);
}
