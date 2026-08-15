# P-000 validation gates

1. Template immutability: domain instantiation tests compare source before/after; PostgreSQL update/delete triggers reject mutations.
2. Ledger integrity: integer-cent validation rejects malformed/imbalanced lines before persistence; deferred constraint trigger rejects unbalanced commits atomically; reports derive only from journal lines.
3. Isolation: authenticated identity is supplied by the API context; owned lookup hides absent vs foreign attempts; attempt-scoped account validation and composite database keys reject cross-attempt references.
4. Instructor secrecy: separate instructor columns are absent from student domain/API types; fixed errors omit source data; adversarial serialization tests reject instructor vocabulary and fixture secrets.
