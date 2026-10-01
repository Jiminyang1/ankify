import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth";

export const dynamic = "force-dynamic";

/** The web review page is retired: reviews happen on LeetCode with the
 *  extension. Old links land on the dashboard, which explains why. */
export default async function ReviewPage() {
  await requirePageUser();
  redirect("/today?retired=review");
}
