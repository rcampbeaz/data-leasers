// Turns a company form into the columns it saves.
//
// The company page is edited from two panels — owner and next action, then the profile — and both post
// to the same action. Writing every column from whichever form arrived would mean that saving one panel
// cleared the other, so a field the form did not send is left out of the patch entirely rather than
// written as null. The distinction matters: an empty input still clears its own column, an absent field
// touches nothing.
//
// This lives apart from the action, with no imports, so check:company-save can load it and prove that
// from a form on its own. Keep it dependency-free; the loader fails with a sentence if it stops being so.

export type CompanyPatchResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

export function companyPatch(form: FormData): CompanyPatchResult {
  const patch: Record<string, unknown> = {};
  const sent = (key: string) => form.has(key);
  const text = (key: string, max: number): string | null => {
    const value = String(form.get(key) ?? '').trim();
    return value ? value.slice(0, max) : null;
  };
  const put = (column: string, key: string, max: number) => {
    if (sent(key)) patch[column] = text(key, max);
  };

  // Whole numbers only, and fail loudly rather than silently storing NaN.
  const whole = (column: string, key: string, min: number, max: number): string | null => {
    if (!sent(key)) return null;
    const raw = String(form.get(key) ?? '').trim();
    if (!raw) {
      patch[column] = null;
      return null;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      return `Enter a whole number for ${key}.`;
    }
    patch[column] = value;
    return null;
  };

  if (sent('nextActionDue')) {
    const due = text('nextActionDue', 10);
    if (due && Number.isNaN(Date.parse(due))) return { ok: false, error: 'The due date is not valid.' };
    patch.next_action_due = due;
  }

  if (sent('country')) {
    // Read whole, not truncated to two characters: truncating first would turn "USA" into "US" and
    // the check below could never fire.
    const country = String(form.get('country') ?? '').trim();
    if (country && !/^[A-Za-z]{2}$/.test(country)) {
      return { ok: false, error: 'The country must be a two-letter code, such as US.' };
    }
    patch.country = country ? country.toUpperCase() : null;
  }

  // Staff countries drive the published eligibility rule, so they are normalised to upper-case
  // two-letter codes and de-duplicated on the way in.
  if (sent('staffCountries')) {
    patch.staff_countries = Array.from(
      new Set(
        String(form.get('staffCountries') ?? '')
          .split(',')
          .map((code) => code.trim().toUpperCase())
          .filter((code) => /^[A-Z]{2}$/.test(code)),
      ),
    ).slice(0, 20);
  }

  put('owner_id', 'ownerId', 64);
  put('introduced_by', 'introducedBy', 64);
  put('next_action', 'nextAction', 300);
  put('legal_name', 'legalName', 200);
  put('website', 'website', 300);
  put('industry', 'industry', 100);
  const countError = whole('employee_count', 'employeeCount', 0, 1000000);
  if (countError) return { ok: false, error: countError };
  const yearError = whole('founded_year', 'foundedYear', 1800, 2200);
  if (yearError) return { ok: false, error: yearError };
  put('registration_number', 'registrationNumber', 100);
  put('phone', 'phone', 60);
  put('address_line1', 'addressLine1', 200);
  put('address_line2', 'addressLine2', 200);
  put('city', 'city', 120);
  put('region', 'region', 120);
  put('postal_code', 'postalCode', 30);

  // A form that carried no field this action knows is a page out of step with the action; refusing is
  // better than redirecting as though something was saved.
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: 'That form did not contain anything to save.' };
  }

  return { ok: true, patch };
}
