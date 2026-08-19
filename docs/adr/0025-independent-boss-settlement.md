# Settle Each Raid Boss Independently

Each Raid Boss is settled as an immutable stage: authoritative usage is assigned by occurrence time, the usage event that crosses the remaining health belongs wholly to the current boss, and the next boss starts with zero contribution after the recorded defeat time. This preserves an auditable ranking window and prevents an early leader or a single synchronized batch from carrying opaque progress across bosses.
