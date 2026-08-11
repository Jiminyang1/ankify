import { requirePageUser } from "@/server/auth";
import { loadProblemsList } from "@/server/problems-list";
import ProblemsPage from "./problems-client";

export const dynamic = "force-dynamic";

export default async function ProblemsPageShell() {
  const user = await requirePageUser();
  const initialData = await loadProblemsList(user.id, { limit: 100 });
  return <ProblemsPage initialData={initialData} />;
}
