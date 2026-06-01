import { smsCardStatuses } from "./constants.js";

const stoppedStatuses = new Set([
  smsCardStatuses.disabled,
  smsCardStatuses.void
]);

export function isSmsCardStopped(status) {
  return stoppedStatuses.has(status);
}
