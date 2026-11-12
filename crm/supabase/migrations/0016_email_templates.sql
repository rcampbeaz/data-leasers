-- dataleasers CRM: email templates. Run after 0015_referral_escalation.sql.
--
-- One library for the copy that actually goes out, so a follow-up is written once and reused
-- rather than retyped per contact. Templates are text only: the sender adds the legal footer and
-- the unsubscribe headers itself, and nothing here can put mail on the wire.
--
-- Merge fields are substituted at send time by lib/template-render.ts, not stored expanded, so
-- correcting a template fixes every future step that uses it.

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  -- Named for the job it does, which is how staff look for it: "opener", "break-up", "no reply".
  name text not null check (char_length(name) between 1 and 200),
  purpose text not null check (purpose in (
    'opener', 'follow_up', 'value_add', 'break_up', 'reply', 'partner')),
  subject text not null check (char_length(subject) between 1 and 300),
  body text not null check (char_length(body) between 1 and 8000),
  -- Why this message exists and when to use it. Kept with the copy so the reasoning survives.
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create index if not exists email_templates_purpose_idx on public.email_templates (purpose, name);

alter table public.email_templates enable row level security;

-- Every staff member can read the library; only an admin changes what a sequence will send.
create policy "staff read templates" on public.email_templates
  for select using (public.is_staff());

create policy "admins write templates" on public.email_templates
  for all using (public.is_staff(array['admin']))
  with check (public.is_staff(array['admin']));

-- Starter copy for the cadence the research supports: a specific opener, two follow-ups that each
-- add something new, and a real break-up. Deliberately free of figures: a number without a source
-- is the one thing the agents are not allowed to write, and templates are held to the same rule.
-- on conflict do nothing keeps this file safe to run on a database that already has it, and stops
-- it overwriting copy somebody has since edited.
insert into public.email_templates (name, purpose, subject, body, notes)
values
  (
    'Opener — data licensing question',
    'opener',
    'A question about {{company}} and its data',
    'Hi {{first_name}},

I am writing about something specific rather than a general introduction: whether {{company}} would consider licensing its own operational data to a buyer that builds AI systems on it.

We introduce companies to those buyers. The company keeps ownership of its records and approves every buyer and every term in writing, and the fee is paid by the buyer rather than the seller.

If that is out of scope for you, tell me and I will not write again. If it is worth ten minutes, reply with a time that suits and I will send an outline of what a first conversation covers.

Roderick',
    'Keep the first line specific to the company: one fact from their own site or accounts. This is the touch to personalise by hand. No figures in the copy without a source link.'
  ),
  (
    'Follow-up — new angle, no pressure',
    'follow_up',
    'Re: data licensing for {{company}}',
    'Hi {{first_name}},

Following up once, with a different angle rather than a repeat.

The question most finance and operations leads ask first is what a buyer actually receives. In practice it is a defined extract, not the database: named fields, a fixed refresh, and a contract that says what may and may not be done with it.

If it helps, I can send the one-page summary of what those agreements usually cover. Reply "send it" and it is with you the same day.

Roderick',
    'Adds information instead of asking again. Safe to send as step two, two to four days after the opener.'
  ),
  (
    'Value add — the buyer side',
    'value_add',
    'Who is on the other side of this',
    'Hi {{first_name}},

One thing that is rarely clear from the outside: the buyer here is not a broker. It is an organisation that licenses data to train or evaluate models, which is why the terms are about permitted use rather than resale.

That changes what a first conversation is for. It is not a valuation exercise, it is a check on whether your records are the kind a buyer can use at all.

Happy to say plainly whether {{company}} looks like a fit, including if the answer is no.

Roderick',
    'Gives something away: an honest fit check. Use as step three, roughly a week after the opener.'
  ),
  (
    'Break-up — closing the loop',
    'break_up',
    'Closing the loop, {{first_name}}',
    'Hi {{first_name}},

I have written a few times and had no reply, so I will assume this is not a priority and stop here.

If that is wrong, reply with a single word and I will pick it back up whenever suits you. Otherwise this is the last message from me on it, and I will not add you to anything else.

Roderick',
    'The highest-replying message in most cadences, so send it rather than letting a sequence fade. This is the last step.'
  ),
  (
    'Reply — after a positive answer',
    'reply',
    'Re: data licensing — next step',
    'Hi {{first_name}},

Thanks for coming back to me.

Two things worth settling before a call, so the time is not wasted on either side:

1. Whether {{company}} owns the records outright, or whether a client or platform restricts reuse.
2. Who signs off on a licensing agreement, even if that person is not on the call.

If it is easier, send those in a line each and I will come back with what a first conversation would cover.

Roderick',
    'Sent by hand after a reply. The sequence stops automatically on reply, so this is never automated.'
  ),
  (
    'Partner — referral ask',
    'partner',
    'A question about your clients, {{first_name}}',
    'Hi {{first_name}},

You work with companies whose data is probably more valuable than they realise, and mine is a narrow question: do you ever get asked what a firm could do with its own operational records beyond reporting?

We introduce companies to buyers that license data for AI. The company keeps ownership, approves every term in writing, and pays nothing for the introduction.

If one client comes to mind, a name and a line of context is enough. If none does, no follow-up from me on this.

Roderick',
    'For accountants, brokers, MSPs and association contacts. Never send to a client without the partner knowing.'
  )
on conflict (name) do nothing;
