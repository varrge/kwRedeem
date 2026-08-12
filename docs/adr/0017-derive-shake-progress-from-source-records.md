# Derive Shake Progress From Source Records

KaWang advances actual-balance-consumption progress only from remote Sub2api consumption records with stable identities, imported through a resumable per-connection cursor and filtered to exclude non-qualifying balance changes. It does not infer consumption from balance snapshots because concurrent credits, adjustments, and other product flows would make net differences ambiguous and could issue incorrect Shake Cards.
