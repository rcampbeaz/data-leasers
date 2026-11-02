import { createStaffClient } from '@/lib/supabase';
import { currentStaff } from '@/lib/data';
import { ROLE_LABELS, type Role } from '@/lib/nav';
import { addStaff, changeRole, removeStaff } from '@/lib/staff-actions';

type Row = { user_id: string; full_name: string; role: string; created_at: string };

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: message } = await searchParams;
  const supabase = await createStaffClient();
  const me = await currentStaff(supabase);
  const { data, error } = await supabase
    .from('crm_staff')
    .select('user_id, full_name, role, created_at')
    .order('full_name');
  const rows = (data ?? []) as Row[];

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

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Added</th>
            <th>Change role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isMe = r.user_id === me?.user_id;
            return (
              <tr key={r.user_id}>
                <td>{r.full_name}{isMe ? <span className="muted"> (you)</span> : null}</td>
                <td>{ROLE_LABELS[r.role as Role] ?? r.role}</td>
                <td>{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
                <td>
                  <form action={changeRole} className="inline-form">
                    <input type="hidden" name="userId" value={r.user_id} />
                    <select name="role" defaultValue={r.role}>
                      {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                    <button className="link-button" type="submit">Save</button>
                  </form>
                </td>
                <td>
                  {isMe ? null : (
                    <form action={removeStaff}>
                      <input type="hidden" name="userId" value={r.user_id} />
                      <button className="link-button overdue" type="submit">Remove access</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
