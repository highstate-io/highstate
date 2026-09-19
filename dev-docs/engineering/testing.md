# Testing

Tests verify behavior and externally meaningful contracts.
Each assertion must be capable of failing because of a plausible defect in the code path exercised by the test.

Do not add tests whose only purpose is to assert static data, prose, metadata, document inventories, or constants.
Those tests duplicate implementation content without verifying behavior.

Do not assert that an outcome cannot occur when neither the setup nor the implementation can produce that outcome.
Negative assertions are useful only when they exclude a plausible regression, competing result, or side effect of the
exercised behavior.

Prefer assertions on observable results, state transitions, calls across a boundary, ordering, validation failures,
and error handling.
Regression tests reproduce the failing condition and distinguish the corrected behavior from the defect.
