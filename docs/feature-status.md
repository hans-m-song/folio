# Feature acceptance

25 October 2026: operator confirms existing-draft bank suggestions work. A follow-up
attached-PDF layout defect is separate: its approved top-preview correction is
implemented locally and awaits operator verification. Existing acceptance stands.

Updated22October2026 from direct operator feedback. Functional confirmation is
recorded at feature level; it does not imply every edge case, operational gate or
later change was tested. TaskView retains live task status and remaining criteria.

23 October 2026: operator confirms disabled confirmation state, ordered next-file
review and shared Confirm / Confirm and next / Skip controls work as expected.
Moving metadata editing into the header and matching invoice-link button sizing
are a separate presentation follow-up; prior general feature acceptance is preserved.

| Feature                          | Operator confirmation                                               | Remaining work                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File uploads                     | Works                                                               | No new upload issue reported.                                                                                                                                         |
| File library                     | Library, renaming and CSV coverage editing work                     | No new library/metadata issue reported.                                                                                                                               |
| PDF workflow                     | Works                                                               | No new PDF issue reported.                                                                                                                                            |
| Reconciliation                   | Works                                                               | Flow feels cumbersome; plan a usability refinement.                                                                                                                   |
| Panes/navigation                 | Works                                                               | No new navigation issue reported.                                                                                                                                     |
| CSV imports                      | Works                                                               | Duplicate handling untested.                                                                                                                                          |
| MCP                              | Earlier implementation worked; latest tools exercised live22October | June preparation tested metadata read/save/stale rejection, metadata uploads/retry and checksum-pinned PDF extraction. Human review of resulting drafts remains open. |
| Recurring bills                  | Works                                                               | No new recurrence issue reported.                                                                                                                                     |
| Owner funding                    | Works                                                               | No new funding issue reported.                                                                                                                                        |
| Reports/tax preparation          | Worked                                                              | Presentation feels verbose; plan a simplification. This is not independent validation of financial/tax policy.                                                        |
| Token copying                    | Confirmed21October2026; fix committed581b4d6                        | Latest below-button toast appearance not explicitly confirmed.                                                                                                        |
| Storage/recovery/access controls | No blanket operational confirmation                                 | Existing provider, backup/restore, migration and deployed-authentication gates remain.                                                                                |

The detailed numbered verification checklist is superseded. The operator prefers
general feature confirmations rather than item-by-item scripts. Preserve the
exceptions above without requiring a new exhaustive manual testing exercise.

## Follow-up scope

1. Complete duplicate-handling acceptance and human review of the latest MCP output.
2. Review reconciliation friction and report verbosity before proposing code.
3. Complete separately scoped operational evidence where still required.

Commit operator-verified code in coherent scopes, keeping unrelated/unverified
changes separate. The current shared dirty tree needs dependency-aware staging;
feature confirmation does not authorize an indiscriminate whole-tree commit.
