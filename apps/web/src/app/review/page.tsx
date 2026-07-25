import { requirePageUser } from "@/lib/auth";
import ReviewPage from "./review-client";

export const dynamic = "force-dynamic";

export default async function ReviewPageShell() {
  await requirePageUser();
  return <ReviewPage />;
}
