import { getDb, schema } from "@ankify/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export type DeleteAccountResult =
  | { ok: true; forfeitedCredits: number }
  | { ok: false; error: "credit_forfeit_unacknowledged"; paidBalance: number }
  | { ok: false; error: "account_not_found" };

/**
 * Deletes the user and, by cascade, their data. Purchased AI credits are
 * non-refundable: deleting forfeits any remaining balance, so the caller must
 * pass the user's explicit acknowledgement when a balance exists. The forfeit
 * is written to the ledger, and the purchase and ledger rows are kept (they
 * have no foreign key to `user`) for accounting and payment disputes.
 * Balance check, forfeit record, and delete share one transaction, so a
 * purchase landing mid-request is either acknowledged or blocks the delete.
 */
export async function deleteAccount(
  userId: string,
  options: { acknowledgeCreditForfeit: boolean },
): Promise<DeleteAccountResult> {
  return getDb().transaction(async (tx): Promise<DeleteAccountResult> => {
    const [account] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!account) return { ok: false, error: "account_not_found" };

    const [row] = await tx
      .select({ balance: schema.aiCreditBalances.balance })
      .from(schema.aiCreditBalances)
      .where(eq(schema.aiCreditBalances.userId, userId))
      .limit(1);
    const paidBalance = row?.balance ?? 0;
    if (paidBalance > 0 && !options.acknowledgeCreditForfeit) {
      return { ok: false, error: "credit_forfeit_unacknowledged", paidBalance };
    }

    if (paidBalance > 0) {
      await tx.insert(schema.aiCreditLedger).values({
        id: nanoid(16),
        userId,
        bucket: "paid",
        delta: -paidBalance,
        reason: "forfeit",
        refType: "account",
        refId: userId,
      });
    }
    await tx.delete(schema.user).where(eq(schema.user.id, userId));
    return { ok: true, forfeitedCredits: paidBalance };
  });
}
