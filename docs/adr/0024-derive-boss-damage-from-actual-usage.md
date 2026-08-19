# Derive Boss Damage From Actual Usage

Boss Raid attacks are derived automatically from authoritative, deduplicated Sub2api usage records produced after a player enrolls, rather than from balance snapshots or a page action that spends additional balance. This keeps raid progress tied to real API use, reuses the existing Actual Sub2api Balance Consumption boundary, and prevents clients from choosing or replaying damage while allowing the raid page to remain an interactive presentation of server-recorded facts.
