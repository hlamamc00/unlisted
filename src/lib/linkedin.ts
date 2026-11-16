/**
 * One form for a LinkedIn profile address, so the same person matches across sources:
 * "linkedin.com/in/<name>" in lowercase, or null when it isn't a profile address.
 */
export function normalizeLinkedIn(url: string | null | undefined): string | null {
  const m = url?.trim().match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? `linkedin.com/in/${decodeURIComponent(m[1]).toLowerCase()}` : null;
}

export const linkedInHref = (normalized: string) => `https://www.${normalized}`;
