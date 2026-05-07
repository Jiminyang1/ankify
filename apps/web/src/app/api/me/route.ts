import { NextResponse } from "next/server";
import { getRequestUser, unauthorizedResponse } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return unauthorizedResponse();
  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}
