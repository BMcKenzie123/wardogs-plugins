/**
 * Sponsor banner rules from the server config template (ServerImageURL):
 *   - 1024×256 PNG or JPEG
 *   - the host must be on the server's ImageURLWhitelist; approved: catbox.moe, imgbb.com, postimg.cc
 *   - a URL off that list is refused outright and nothing is downloaded
 *   - inappropriate images get the server blacklisted
 * The whitelist names the services; their image CDNs are what actually appears in a link.
 */

export const SPONSOR_BANNER = { width: 1024, height: 256 } as const;

export const APPROVED_SPONSOR_HOSTS = [
  'catbox.moe',
  'files.catbox.moe',
  'imgbb.com',
  'ibb.co',
  'i.ibb.co',
  'postimg.cc',
  'i.postimg.cc',
] as const;

/** True when the URL is https and its host is (or is under) an approved image host. */
export function isApprovedSponsorUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return APPROVED_SPONSOR_HOSTS.some((approved) => host === approved || host.endsWith(`.${approved}`));
}

export function sponsorUrlProblem(url: string): string | null {
  if (isApprovedSponsorUrl(url)) return null;
  return `"${url}" is not on the server's image whitelist (approved hosts: catbox.moe, imgbb.com, postimg.cc; https only). The server refuses such URLs outright.`;
}
