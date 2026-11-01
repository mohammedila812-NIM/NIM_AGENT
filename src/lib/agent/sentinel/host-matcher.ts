/**
 * Hostname matching utility.
 * Checks whether `host` is identical to `targetDomain` or is a subdomain of `targetDomain`.
 * E.g.: hostMatches('mail.google.com', 'google.com') === true
 *       hostMatches('google.com', 'google.com') === true
 *       hostMatches('notgoogle.com', 'google.com') === false
 */
export function hostMatches(host: string, targetDomain: string): boolean {
  if (!host || !targetDomain) return false;
  const h = host.toLowerCase().trim();
  const d = targetDomain.toLowerCase().trim();
  return h === d || h.endsWith('.' + d);
}

/** Check if host matches any of the given domains. */
export function hostMatchesAny(host: string, domains: readonly string[]): boolean {
  return domains.some((d) => hostMatches(host, d));
}
