'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createIntakeClient, createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import {
  BUYER_KINDS,
  DELETION_DAYS,
  DOCUMENT_KINDS,
  OFFER_STATUSES,
  REFERRAL_STATUSES,
  addDays,
  addMonths,
  deadlineFor,
} from '@/lib/deals';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function text(form: FormData, key: string, max: number): string | null {
  const value = String(form.get(key) ?? '').trim();
  return value ? value.slice(0, max) : null;
}

function int(form: FormData, key: string, min: number, max: number): number | null {
  const raw = String(form.get(key) ?? '').trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function day(form: FormData, key: string): string | null {
  const raw = String(form.get(key) ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : raw;
}

// Writes are checked against the staff table as well as row-level security, so the
// message names the problem instead of a generic database error.
async function requireWriter(path: string) {
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  if (!me || !['admin', 'introducer'].includes(me.role)) {
    fail(path, 'Your role does not allow that change.');
  }
  return { supabase, me };
}

// Deal writes are recorded in the append-only log, the same as lead and staff writes.
// Uses the service-role client because staff cannot insert arbitrary log rows for
// entities they do not otherwise write.
async function audit(
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  detail: Record<string, unknown> = {},
) {
  await createIntakeClient().from('audit_log').insert({
    actor_id: actorId,
    entity,
    entity_id: entityId,
    action,
    detail,
  });
}

function refreshDeal(companyId?: string) {
  revalidatePath('/buyers');
  revalidatePath('/partners');
  revalidatePath('/dashboard');
  revalidatePath('/pipeline');
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

export async function addBuyer(formData: FormData) {
  const path = '/buyers';
  const { supabase, me } = await requireWriter(path);

  const name = text(formData, 'name', 200);
  const kind = String(formData.get('kind') ?? 'program');
  if (!name) fail(path, 'Enter the buyer name.');
  if (!BUYER_KINDS.includes(kind as (typeof BUYER_KINDS)[number])) fail(path, 'Choose a buyer type.');

  const { data, error } = await supabase
    .from('buyers')
    .insert({ name, kind, notes: text(formData, 'notes', 2000) })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not add the buyer. It may already exist by that name.');

  await audit(me.user_id, 'buyer', data.id, 'created', { name, kind });
  refreshDeal();
  redirect(`${path}?saved=buyer`);
}

export async function setBuyerActive(buyerId: string, active: boolean) {
  const path = '/buyers';
  const { supabase, me } = await requireWriter(path);
  const { error } = await supabase.from('buyers').update({ active }).eq('id', buyerId);
  if (error) fail(path, 'Could not update the buyer.');
  await audit(me.user_id, 'buyer', buyerId, active ? 'reactivated' : 'deactivated');
  refreshDeal();
  redirect(path);
}

export async function addIntroduction(companyId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);

  const buyerId = text(formData, 'buyerId', 64);
  if (!buyerId) fail(path, 'Choose the buyer you introduced the company to.');

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('introductions')
    .insert({
      company_id: companyId,
      buyer_id: buyerId,
      introduced_on: day(formData, 'introducedOn') ?? undefined,
      introduced_by: auth.user?.id ?? null,
      notes: text(formData, 'notes', 2000),
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not record the introduction. This buyer may already be recorded.');

  await audit(me.user_id, 'introduction', data.id, 'created', { company_id: companyId, buyer_id: buyerId });
  refreshDeal(companyId);
  redirect(path);
}

export async function addOffer(companyId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);

  const buyerId = text(formData, 'buyerId', 64);
  const rawAmount = String(formData.get('amount') ?? '').replace(/[^0-9.]/g, '');
  const amount = rawAmount ? Number(rawAmount) : Number.NaN;
  if (!buyerId) fail(path, 'Choose the buyer who made the offer.');
  if (!Number.isFinite(amount) || amount <= 0) fail(path, 'Enter the offer amount as a number.');

  const currency = (text(formData, 'currency', 3) ?? 'USD').toUpperCase();

  const { data: introduction } = await supabase
    .from('introductions')
    .select('id')
    .eq('company_id', companyId)
    .eq('buyer_id', buyerId)
    .maybeSingle();

  const { data, error } = await supabase
    .from('offers')
    .insert({
      company_id: companyId,
      buyer_id: buyerId,
      introduction_id: introduction?.id ?? null,
      amount: Math.round(amount * 100) / 100,
      currency: currency.length === 3 ? currency : 'USD',
      term_months: int(formData, 'termMonths', 0, 120),
      exclusivity_months: int(formData, 'exclusivityMonths', 0, 120),
      status: 'offered',
      offered_on: day(formData, 'offeredOn') ?? undefined,
      notes: text(formData, 'notes', 2000),
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not record the offer.');

  await audit(me.user_id, 'offer', data.id, 'created', {
    company_id: companyId,
    buyer_id: buyerId,
    amount: Math.round(amount * 100) / 100,
    currency,
  });
  refreshDeal(companyId);
  redirect(path);
}

export async function setOfferStatus(companyId: string, offerId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);

  const status = String(formData.get('status') ?? '');
  if (!OFFER_STATUSES.includes(status as (typeof OFFER_STATUSES)[number])) {
    fail(path, 'Choose a valid offer status.');
  }

  const { error } = await supabase
    .from('offers')
    .update({
      status,
      decided_on: status === 'offered' ? null : new Date().toISOString().slice(0, 10),
    })
    .eq('id', offerId)
    .eq('company_id', companyId);
  if (error) fail(path, 'Could not update the offer.');

  await audit(me.user_id, 'offer', offerId, 'status_changed', { status, company_id: companyId });
  refreshDeal(companyId);
  redirect(path);
}

export async function addPartner(formData: FormData) {
  const path = '/partners';
  const { supabase, me } = await requireWriter(path);

  const name = text(formData, 'name', 200);
  if (!name) fail(path, 'Enter the partner name.');

  const rateRaw = String(formData.get('feeRate') ?? '').replace(/[^0-9.]/g, '');
  const floorRaw = String(formData.get('feeFloor') ?? '').replace(/[^0-9.]/g, '');
  const rate = rateRaw ? Number(rateRaw) / 100 : 0.06;
  const floor = floorRaw ? Number(floorRaw) : 50000;

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('partners')
    .insert({
      name,
      email: text(formData, 'email', 320),
      organisation: text(formData, 'organisation', 200),
      fee_rate: Math.min(Math.max(rate, 0), 1),
      fee_floor: Math.max(floor, 0),
      notes: text(formData, 'notes', 2000),
      created_by: auth.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not add the partner.');

  await audit(me.user_id, 'partner', data.id, 'created', {});
  refreshDeal();
  redirect(`${path}?saved=partner`);
}

export async function registerReferral(formData: FormData) {
  const path = '/partners';
  const { supabase, me } = await requireWriter(path);

  const partnerId = text(formData, 'partnerId', 64);
  const companyName = text(formData, 'companyName', 200);
  if (!partnerId) fail(path, 'Choose the partner who made the referral.');
  if (!companyName) fail(path, 'Enter the company that was referred.');

  const registeredOn = day(formData, 'registeredOn') ?? new Date().toISOString().slice(0, 10);
  const deadline = deadlineFor(registeredOn);

  const { data, error } = await supabase
    .from('referrals')
    .insert({
      partner_id: partnerId,
      company_id: text(formData, 'companyId', 64),
      company_name: companyName,
      registered_on: registeredOn,
      deadline_on: deadline,
      notes: text(formData, 'notes', 2000),
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not register the referral.');

  await audit(me.user_id, 'referral', data.id, 'registered', {
    partner_id: partnerId,
    company_name: companyName,
    deadline_on: deadline,
  });
  refreshDeal();
  redirect(`${path}?saved=referral`);
}

export async function updateReferral(formData: FormData) {
  const path = '/partners';
  const { supabase, me } = await requireWriter(path);

  const id = text(formData, 'id', 64);
  if (!id) fail(path, 'That referral could not be found.');

  const status = String(formData.get('status') ?? '');
  if (!REFERRAL_STATUSES.includes(status as (typeof REFERRAL_STATUSES)[number])) {
    fail(path, 'Choose a valid referral status.');
  }

  const feeRaw = String(formData.get('feeAmount') ?? '').replace(/[^0-9.]/g, '');
  const patch: Record<string, unknown> = { status };
  if (feeRaw) patch.fee_amount = Math.round(Number(feeRaw) * 100) / 100;
  patch.paid_on = status === 'paid' ? (day(formData, 'paidOn') ?? new Date().toISOString().slice(0, 10)) : null;

  const { error } = await supabase.from('referrals').update(patch).eq('id', id);
  if (error) fail(path, 'Could not update the referral.');

  await audit(me.user_id, 'referral', id, 'status_changed', { status, fee: patch.fee_amount ?? null });
  refreshDeal();
  redirect(path);
}

export async function addAgreement(companyId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);

  const licenceStart = day(formData, 'licenceStart');
  if (!licenceStart) fail(path, 'Enter the date the licence starts.');

  const licenceMonths = int(formData, 'licenceMonths', 0, 120);
  const exclusivityMonths = int(formData, 'exclusivityMonths', 0, 120);
  const deliveredOn = day(formData, 'deliveredOn');
  const deletionDue = deliveredOn ? addDays(deliveredOn, DELETION_DAYS) : null;

  const { data, error } = await supabase
    .from('agreements')
    .insert({
      company_id: companyId,
      buyer_id: text(formData, 'buyerId', 64),
      licence_start: licenceStart,
      licence_end: licenceMonths ? addMonths(licenceStart, licenceMonths) : null,
      exclusivity_end: exclusivityMonths ? addMonths(licenceStart, exclusivityMonths) : null,
      delivered_on: deliveredOn,
      deletion_due: deletionDue,
      audit_right: String(formData.get('auditRight') ?? '') === 'on',
      status: 'signed',
      signed_on: day(formData, 'signedOn') ?? new Date().toISOString().slice(0, 10),
      notes: text(formData, 'notes', 2000),
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not record the agreement.');

  await audit(me.user_id, 'agreement', data.id, 'created', { company_id: companyId, deletion_due: deletionDue });
  refreshDeal(companyId);
  redirect(path);
}

export async function addDocument(companyId: string, formData: FormData) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);

  const title = text(formData, 'title', 200);
  const kind = String(formData.get('kind') ?? 'rights-file');
  if (!title) fail(path, 'Give the document a name.');
  if (!DOCUMENT_KINDS.includes(kind as (typeof DOCUMENT_KINDS)[number])) fail(path, 'Choose a document type.');

  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      company_id: companyId,
      kind,
      title,
      location: text(formData, 'location', 1000),
      signed_on: day(formData, 'signedOn'),
      notes: text(formData, 'notes', 2000),
      created_by: auth.user?.id ?? null,
    })
    .select('id')
    .single();
  if (error || !data) fail(path, 'Could not save the document record.');

  await audit(me.user_id, 'document', data.id, 'created', { company_id: companyId, kind });
  refreshDeal(companyId);
  redirect(path);
}

// A partner is an outside person, so their record has to answer an erasure request
// too. The row is anonymised rather than deleted: deleting it would cascade the
// referrals and destroy the fee history the ledger exists to keep.
export async function anonymisePartner(partnerId: string) {
  const path = '/partners';
  const { supabase, me } = await requireWriter(path);
  if (me.role !== 'admin') fail(path, 'Only an admin can erase a partner record.');

  const { error } = await supabase
    .from('partners')
    .update({
      name: `Erased partner ${partnerId.slice(0, 8)}`,
      email: null,
      organisation: null,
      notes: null,
      erased_at: new Date().toISOString(),
    })
    .eq('id', partnerId)
    .is('erased_at', null);
  if (error) {
    fail(path, 'Could not erase the partner details. Check that 0008_partner_erasure.sql has been run.');
  }

  await audit(me.user_id, 'partner', partnerId, 'details_erased', {});
  refreshDeal();
  redirect(`${path}?erased=1`);
}

export async function removeDocument(companyId: string, documentId: string) {
  const path = `/companies/${companyId}`;
  const { supabase, me } = await requireWriter(path);
  const { error } = await supabase.from('documents').delete().eq('id', documentId).eq('company_id', companyId);
  if (error) fail(path, 'Could not remove the document.');
  await audit(me.user_id, 'document', documentId, 'removed', { company_id: companyId });
  refreshDeal(companyId);
  redirect(path);
}
