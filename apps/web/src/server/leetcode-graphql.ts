/** POST a query to LeetCode's public GraphQL. Never sends cookies or a
 *  LeetCode session; only data LeetCode shows to anonymous visitors. */
export async function leetcodeGraphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: "https://leetcode.com/",
      "user-agent": "Mozilla/5.0 (compatible; ankify)",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`leetcode_http_${res.status}`);
  return res.json();
}
