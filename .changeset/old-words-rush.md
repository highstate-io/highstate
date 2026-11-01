---
"@highstate/common": patch
"@highstate/cloudflare": patch
---

Order DNS record-set replacements so CNAME records are removed before incompatible A/AAAA records are created, including the reverse transition and CNAME target changes. Preserve ordinary address-set updates without replacing unchanged records.

Run propagation checks only after provider resources succeed, stop after 60 failed lookups, and match complete address fields. Existing wait commands pick up the bounded script on reconciliation.

When upgrading an existing deployment, first reconcile its DNS record sets without changing their values to establish the lifecycle dependency. Change record families in a subsequent update; the initial upgrade cannot order records that have no saved lifecycle dependency.
