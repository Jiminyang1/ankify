/**
 * The two LeetCode sites. Every problem on leetcode.com has the same slug and
 * frontend id on leetcode.cn, and problems only on leetcode.cn (LCP, LCR, LCS,
 * 面试题) have slugs of their own, so a slug names one problem on either site.
 * Accounts and solved lists are separate per site.
 */

export type LeetcodeSite = "com" | "cn";

export const LEETCODE_SITES: readonly LeetcodeSite[] = ["com", "cn"];

export function leetcodeOrigin(site: LeetcodeSite): string {
  return `https://leetcode.${site}`;
}

export function leetcodeProblemUrl(slug: string, site: LeetcodeSite): string {
  return `${leetcodeOrigin(site)}/problems/${slug}/`;
}

/** leetcode-cn.com is leetcode.cn's old name, and old links still redirect. */
export function leetcodeSiteOfHost(host: string): LeetcodeSite | null {
  const name = host.toLowerCase().replace(/^www\./, "");
  if (name === "leetcode.com") return "com";
  if (name === "leetcode.cn" || name === "leetcode-cn.com") return "cn";
  return null;
}

/** The site and slug of a problem page's URL; null for any other page. */
export function parseLeetcodeProblemUrl(url: string | undefined): { site: LeetcodeSite; slug: string } | null {
  if (!url) return null;
  const match = /^https?:\/\/([^/?#]+)\/problems\/([^/?#]+)/.exec(url);
  const site = match ? leetcodeSiteOfHost(match[1]!) : null;
  return site ? { site, slug: match![2]! } : null;
}
