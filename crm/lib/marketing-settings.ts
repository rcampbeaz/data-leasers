// Shared shape for the Marketing switches. Kept out of the "use server" action file
// because a server-action module may only export async functions.

export type MarketingControls = {
  publishing_enabled: boolean;
  drafting_enabled: boolean;
  require_approval: boolean;
};

// Safe defaults: sending on, drafting on, approval off. A missing row means these.
export const MARKETING_DEFAULTS: MarketingControls = {
  publishing_enabled: true,
  drafting_enabled: true,
  require_approval: false,
};

export function mergeControls(value: unknown): MarketingControls {
  if (typeof value !== 'object' || value === null) return MARKETING_DEFAULTS;
  const stored = value as Partial<Record<keyof MarketingControls, unknown>>;
  return {
    publishing_enabled:
      typeof stored.publishing_enabled === 'boolean'
        ? stored.publishing_enabled
        : MARKETING_DEFAULTS.publishing_enabled,
    drafting_enabled:
      typeof stored.drafting_enabled === 'boolean'
        ? stored.drafting_enabled
        : MARKETING_DEFAULTS.drafting_enabled,
    require_approval:
      typeof stored.require_approval === 'boolean'
        ? stored.require_approval
        : MARKETING_DEFAULTS.require_approval,
  };
}
