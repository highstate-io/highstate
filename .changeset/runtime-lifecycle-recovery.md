---
"@highstate/backend": patch
"@highstate/backend-api": patch
"@highstate/designer": patch
---

Fix packaged runtime execution, composite evaluation transaction reads, and historical destruction after removing a library package. Preserve cancellation status for remote action failures and recover stale Pulumi locks after interrupted actions. Handle runtime connection errors without terminating the backend and initialize the project library before subscribing in Designer.
