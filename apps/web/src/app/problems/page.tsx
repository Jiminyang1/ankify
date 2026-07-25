import { requirePageUser } from "@/lib/auth";
import ProblemsPage from "./problems-client";

export const dynamic = "force-dynamic";

export default async function ProblemsPageShell() {
  await requirePageUser();
  return <ProblemsPage />;
}
