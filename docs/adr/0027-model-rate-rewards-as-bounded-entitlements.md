# Model Rate Rewards As Bounded Entitlements

A Timed Group Rate Reward is stored as a bounded entitlement rather than by overwriting and later restoring a user's Sub2api group multiplier. Its absolute rate competes with other active rates by taking the lowest value, it ends on the earlier of its duration or discounted-usage cap, and it waits or falls back when an existing better rate would make it valueless. This avoids unbounded subsidy and prevents expiry jobs from erasing administrator changes or overlapping rewards made after the prize was granted.
