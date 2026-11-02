import { leetcodeOrigin, type LeetcodeSite } from "@ankify/core";

/** leetcode.cn keeps part of its schema (calendar, recent accepted) on a second
 *  endpoint. */
const ENDPOINTS = {
  com: "https://leetcode.com/graphql",
  cn: "https://leetcode.cn/graphql/",
  "cn-noj": "https://leetcode.cn/graphql/noj-go/",
} as const;

/** POST a query to LeetCode's public GraphQL. Never sends cookies or a
 *  LeetCode session; only data LeetCode shows to anonymous visitors. */
export async function leetcodeGraphql(
  query: string,
  variables: Record<string, unknown>,
  endpoint: keyof typeof ENDPOINTS = "com",
): Promise<unknown> {
  const site: LeetcodeSite = endpoint === "com" ? "com" : "cn";
  const res = await fetch(ENDPOINTS[endpoint], {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: `${leetcodeOrigin(site)}/`,
      "user-agent": "Mozilla/5.0 (compatible; ankify)",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`leetcode_http_${res.status}`);
  return res.json();
}
