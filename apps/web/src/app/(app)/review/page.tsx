import { requirePageUser } from "@/lib/auth";
import { loadNextReview } from "@/lib/next-review";
import ReviewPage from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPageShell({
  searchParams,
}: {
  searchParams: Promise<{ problemId?: string | string[] }>;
}) {
  const user = await requirePageUser();
  const rawProblemId = (await searchParams).problemId;
  const targetId =
    typeof rawProblemId === "string" && rawProblemId.length <= 128
      ? rawProblemId
      : null;
  const initialData = await loadNextReview(user.id, targetId);
  return <ReviewPage initialData={initialData} initialTargetId={targetId} />;
}
