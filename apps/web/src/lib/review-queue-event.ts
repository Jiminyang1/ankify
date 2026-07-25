export const REVIEW_QUEUE_UPDATED_EVENT = "ankify:review-queue-updated";

export type ReviewQueueUpdatedEvent = CustomEvent<{
  dueCount?: number;
}>;

export function notifyReviewQueueUpdated(dueCount?: number) {
  window.dispatchEvent(
    new CustomEvent(REVIEW_QUEUE_UPDATED_EVENT, {
      detail: { dueCount },
    }),
  );
}
