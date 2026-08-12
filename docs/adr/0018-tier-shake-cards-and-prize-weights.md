# Tier Shake Cards And Prize Weights

Shake Cards have an explicit low, medium, or high tier. Eligibility rules and manual grants choose the tier they issue, while each configured prize stores an independent relative weight for every tier. The server consumes only the tier requested by the player, selects the result using that tier's weights, and persists the tier and full weight snapshot with the draw. An extra-draw prize grants one replacement card of the consumed tier.

Existing rules, cards, progress, grants, prizes, and draws migrate to low tier. A legacy prize's single weight is copied to all three tier weights so deployment does not change its effective probability until an administrator publishes a new configuration version.
