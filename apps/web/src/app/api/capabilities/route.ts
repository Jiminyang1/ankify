import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/server/auth";
import { getCapabilities } from "@/server/capabilities";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json(getCapabilities(), { headers: { "Cache-Control": "private, no-store" } });
}
