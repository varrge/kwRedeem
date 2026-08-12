# Persist Shake Results Before Reward Delivery

KaWang reserves one campaign-bound Shake Card and persists a single server-selected draw result before attempting remote reward delivery. Balance-credit failures leave that result pending for idempotent retry under the draw identity rather than returning the card or rerolling, which prevents duplicate credit and preserves the result across refreshes, timeouts, and remote Sub2api failures.
