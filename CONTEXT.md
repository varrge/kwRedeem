# KaWang Domain

KaWang manages redeemable cards, external site integrations, and operational data that must survive deployment and server moves.

## Language

**Full Server Migration**:
Moving one KaWang deployment from an old server to a new server so the same service continues with its business data and operational settings intact.
_Avoid_: Version upgrade, code-only deployment

**Migration Asset**:
A piece of KaWang business data or operational configuration that must be preserved during a full server migration because losing it would change user-visible state or break integrations.
_Avoid_: Cache, dependency, temporary file

**Sensitive Migration Package**:
A full server migration archive that contains KaWang migration assets, including secret-bearing configuration such as `.env`, and must be handled as confidential operational material.
_Avoid_: Public backup, export bundle

**Migration Asset Whitelist**:
The explicit list of files or directories allowed into a sensitive migration package. It includes required business assets and excludes source code, dependencies, caches, logs, temporary files, and reference checkouts.
_Avoid_: Full project archive, directory dump

**Online Restore**:
A full server migration restore initiated from the KaWang admin UI while the service is reachable, with the backend first moving the system into maintenance mode to block user-facing writes.
_Avoid_: Hot restore, direct database overwrite
