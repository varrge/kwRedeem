# Local registration invite rebate layer

KaWang will keep creating official remote Sub2api `type=invitation` redeem codes for registration and will add invite-rebate behavior in KaWang's own data model and API layer.

This avoids modifying the upstream/reference `sub2api/` checkout and avoids using Sub2api native `aff_code`, which does not gate registration and does not match KaWang's required review, level, quota, and rebate rules.

KaWang records who issued each registration invite code, discovers who used it through remote admin APIs, calculates pending rebates from the invited user's first balance acquisition, and pays or revokes approved rebates through the stored Sub2api admin-key integration path.
