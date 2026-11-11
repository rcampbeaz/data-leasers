import Link from 'next/link';
import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { addBuyer, setBuyerActive } from '@/lib/deal-actions';
import { BUYER_KINDS, money } from '@/lib/deals';

type Buyer = {
  id: string;
  name: string;
  kind: string;
  notes: string | null;
  active: boolean;
};

type OfferRow = { buyer_id: string; amount: number; currency: string; status: string };

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { error, saved } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const canEdit = me?.role === 'admin' || me?.role === 'introducer';

  const [{ data: buyers, error: buyersError }, { data: offers }, { data: introductions }] =
    await Promise.all([
      supabase.from('buyers').select('id, name, kind, notes, active').order('name'),
      supabase.from('offers').select('buyer_id, amount, currency, status'),
      supabase.from('introductions').select('buyer_id'),
    ]);

  const rows = (buyers ?? []) as Buyer[];
  const allOffers = (offers ?? []) as OfferRow[];
  const intros = (introductions ?? []) as { buyer_id: string }[];

  const summary = rows.map((buyer) => {
    const mine = allOffers.filter((o) => o.buyer_id === buyer.id);
    const accepted = mine.filter((o) => o.status === 'accepted');
    const best = accepted.reduce((top, o) => Math.max(top, Number(o.amount)), 0);
    return {
      buyer,
      introductions: intros.filter((i) => i.buyer_id === buyer.id).length,
      offers: mine.length,
      accepted: accepted.length,
      best: best ? money(best, accepted[0]?.currency ?? 'USD') : '-',
    };
  });

  return (
    <main className="page">
      <header className="page-head">
        <h1>Buyers</h1>
        <p className="muted">
          The programs, labs and brokers a company can be introduced to. Offers and agreements point
          at these records, so a deal always names the buyer that made it.
        </p>
      </header>

      {error ? <p className="notice blocked">{error}</p> : null}
      {saved ? <p className="notice">Saved.</p> : null}

      {canEdit ? (
        <details className="panel">
          <summary>Add a buyer</summary>
          <form action={addBuyer} className="form-grid">
            <label>
              Name
              <input name="name" required maxLength={200} placeholder="Buyer or program name" />
            </label>
            <label>
              Type
              <select name="kind" defaultValue="program">
                {BUYER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Notes
              <textarea name="notes" rows={2} maxLength={2000} />
            </label>
            <button className="btn" type="submit">
              Save buyer
            </button>
          </form>
        </details>
      ) : null}

      {buyersError ? (
        <p className="notice blocked">Could not load buyers. Check your staff access.</p>
      ) : rows.length === 0 ? (
        <p className="muted">No buyers yet. Add the first one above.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Type</th>
              <th>Introductions</th>
              <th>Offers</th>
              <th>Accepted</th>
              <th>Highest accepted</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {summary.map(({ buyer, introductions: introCount, offers: offerCount, accepted, best }) => (
              <tr key={buyer.id}>
                <td>{buyer.name}</td>
                <td>{buyer.kind}</td>
                <td>{introCount}</td>
                <td>{offerCount}</td>
                <td>{accepted}</td>
                <td>{best}</td>
                <td>{buyer.active ? 'Active' : <span className="muted">Inactive</span>}</td>
                <td>
                  {canEdit ? (
                    <form action={setBuyerActive.bind(null, buyer.id, !buyer.active)}>
                      <button className="link-button" type="submit">
                        {buyer.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted small-note">
        Deactivating a buyer hides it from new introductions. Existing offers and agreements keep
        their record. <Link href="/pipeline">Back to the pipeline</Link>.
      </p>
    </main>
  );
}
