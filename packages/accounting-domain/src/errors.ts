export class NotFoundError extends Error { readonly code = 'NOT_FOUND' }
export class InvalidReferenceError extends Error { readonly code = 'INVALID_REFERENCE' }
export class LedgerIntegrityError extends Error { readonly code = 'LEDGER_INTEGRITY' }
export class InvalidStateError extends Error { readonly code = 'INVALID_STATE' }
