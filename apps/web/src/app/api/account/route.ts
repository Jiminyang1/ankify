import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAccount } from "@/server/account";
import { getRequestSessionUser, unauthorizedResponse } from "@/server/auth";

const deleteAccountSchema = z
  .object({
    email: z.string().email().max(320),
    confirmation: z.literal("DELETE"),
    /** Required when the account still holds purchased AI credits. */
    acknowledgeCreditForfeit: z.boolean().optional(),
  })
  .strict();

export async function DELETE(req: Request) {
  const user = await getRequestSessionUser(req);
  if (!user) return unauthorizedResponse();

  const body = await req.json().catch(() => null);
  const parsed = deleteAccountSchema.safeParse(body);
  if (!parsed.success || parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
  }

  const result = await deleteAccount(user.id, {
    acknowledgeCreditForfeit: parsed.data.acknowledgeCreditForfeit === true,
  });
  if (!result.ok) {
    return result.error === "credit_forfeit_unacknowledged"
      ? NextResponse.json({ error: result.error, paidBalance: result.paidBalance }, { status: 409 })
      : NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Clear-Site-Data": '"cookies", "storage"',
      },
    },
  );
}
