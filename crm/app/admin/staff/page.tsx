import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { ROLE_LABELS, type Role } from '@/lib/nav';
import { addStaff, changeRole, removeStaff, updateStaffProfile } from '@/lib/staff-actions';

type Row = {
  user_id: string;
  full_name: string;
  role: string;
  created_at: string;
  crm_staff_profiles: Profile | Profile[] | null;
};

type Profile = {
  email: string | null;
  job_title: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postcode: string | null;
  country: string | null;
  notes: string | null;
};

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: message } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const isAdmin = me?.role === 'admin';
  const { data, error } = await supabase
    .from('crm_staff')
    .select(
      'user_id, full_name, role, created_at, crm_staff_profiles(email, job_title, phone, address_line1, address_line2, city, region, postcode, country, notes)',
    )
    .order('full_name');
  const rows = (data ?? []) as unknown as Row[];
  const profileOf = (r: Row): Profile => {
    const p = r.crm_staff_profiles;
    const one = Array.isArray(p) ? p[0] : p;
    return one ?? ({} as Profile);
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Staff</h1>
        <p className="muted">
          Add people who already have an account. Their role decides what they can see and change.
          Every change is recorded in the activity log.
        </p>
      </header>

      {message ? <p className="notice blocked">{message}</p> : null}
      {error ? <p className="notice blocked">Could not load staff. Admin access is needed.</p> : null}

      {isAdmin ? (
        <section className="panel">
          <h2>Add a staff member</h2>
          <form action={addStaff} className="inline-form">
            <input name="fullName" placeholder="Full name" required />
            <input name="email" type="email" placeholder="Work email" required />
            <select name="role" defaultValue="introducer">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <button className="btn" type="submit">Add</button>
          </form>
        </section>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Role</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const p = profileOf(r);
            const isMe = r.user_id === me?.user_id;
            return (
              <tr key={r.user_id}>
                <td>
                  {r.full_name}
                  {p.job_title ? <><br /><span className="muted">{p.job_title}</span></> : null}
                  {isMe ? <span className="muted"> (you)</span> : null}
                </td>
                <td>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : <span className="muted">-</span>}</td>
                <td>{p.phone ?? <span className="muted">-</span>}</td>
                <td>{ROLE_LABELS[r.role as Role] ?? r.role}</td>
                <td>{new Date(r.created_at).toLocaleDateString('en-US')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {isAdmin ? (
        <section>
          <h2>Edit staff details</h2>
          {rows.map((r) => {
            const p = profileOf(r);
            const isMe = r.user_id === me?.user_id;
            return (
              <details key={r.user_id} className="panel">
                <summary>{r.full_name} ({ROLE_LABELS[r.role as Role] ?? r.role})</summary>
                <form action={updateStaffProfile} className="form-grid">
                  <input type="hidden" name="userId" value={r.user_id} />
                  <label>Full name<input name="fullName" defaultValue={r.full_name} required maxLength={200} /></label>
                  <label>Job title<input name="jobTitle" defaultValue={p.job_title ?? ''} maxLength={200} /></label>
                  <label>Email<input name="email" type="email" defaultValue={p.email ?? ''} maxLength={320} /></label>
                  <label>Phone<input name="phone" defaultValue={p.phone ?? ''} maxLength={40} /></label>
                  <label>Address line 1<input name="addressLine1" defaultValue={p.address_line1 ?? ''} maxLength={200} /></label>
                  <label>Address line 2<input name="addressLine2" defaultValue={p.address_line2 ?? ''} maxLength={200} /></label>
                  <label>City<input name="city" defaultValue={p.city ?? ''} maxLength={100} /></label>
                  <label>Region / state<input name="region" defaultValue={p.region ?? ''} maxLength={100} /></label>
                  <label>Postcode / ZIP<input name="postcode" defaultValue={p.postcode ?? ''} maxLength={20} /></label>
                  <label>Country<input name="country" defaultValue={p.country ?? ''} maxLength={100} /></label>
                  <label>Role
                    <select name="role" defaultValue={r.role} disabled={isMe}>
                      {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                    {isMe ? <input type="hidden" name="role" value={r.role} /> : null}
                  </label>
                  <label className="span-2">Notes<textarea name="notes" rows={3} defaultValue={p.notes ?? ''} maxLength={2000} /></label>
                  <button className="btn" type="submit">Save details</button>
                </form>
                {isMe ? null : (
                  <form action={removeStaff} className="inline-form">
                    <input type="hidden" name="userId" value={r.user_id} />
                    <button className="link-button overdue" type="submit">Remove access</button>
                  </form>
                )}
              </details>
            );
          })}
        </section>
      ) : null}
    </main>
  );
}
