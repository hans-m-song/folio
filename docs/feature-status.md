# Feature acceptance

Updated22October2026 from direct operator feedback. Functional confirmation is
recorded at feature level; it does not imply every edge case, operational gate or
later change was tested. TaskView retains live task status and remaining criteria.

| Feature                          | Operator confirmation                        | Remaining work                                                                                                 |
| -------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| File uploads                     | Works                                        | No new upload issue reported.                                                                                  |
| File library                     | Basic library works                          | Existing-file renaming and CSV coverage editing untested.                                                      |
| PDF workflow                     | Works                                        | No new PDF issue reported.                                                                                     |
| Reconciliation                   | Works                                        | Flow feels cumbersome; plan a usability refinement.                                                            |
| Panes/navigation                 | Works                                        | No new navigation issue reported.                                                                              |
| CSV imports                      | Works                                        | Duplicate handling untested.                                                                                   |
| MCP                              | Previous implementation worked               | Latest metadata/edit/extraction/scope updates untested.                                                        |
| Recurring bills                  | Works                                        | No new recurrence issue reported.                                                                              |
| Owner funding                    | Works                                        | No new funding issue reported.                                                                                 |
| Reports/tax preparation          | Worked                                       | Presentation feels verbose; plan a simplification. This is not independent validation of financial/tax policy. |
| Token copying                    | Confirmed21October2026; fix committed581b4d6 | Latest below-button toast appearance not explicitly confirmed.                                                 |
| Storage/recovery/access controls | No blanket operational confirmation          | Existing provider, backup/restore, migration and deployed-authentication gates remain.                         |

The detailed numbered verification checklist is superseded. The operator prefers
general feature confirmations rather than item-by-item scripts. Preserve the
exceptions above without requiring a new exhaustive manual testing exercise.

## Follow-up scope

1. Verify renaming/CSV coverage editing, duplicate handling and latest MCP parity.
2. Review reconciliation friction and report verbosity before proposing code.
3. Complete separately scoped operational evidence where still required.

Commit operator-verified code in coherent scopes, keeping unrelated/unverified
changes separate. The current shared dirty tree needs dependency-aware staging;
feature confirmation does not authorize an indiscriminate whole-tree commit.
