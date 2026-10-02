import type { BankProposalSuggestion } from "../database/proposal-repository";

interface BankProposalSuggestionsProps {
  bankTransactionId: string;
  suggestions: readonly BankProposalSuggestion[];
  onEditDraft?: (transactionId: string) => void;
}

export const BankProposalSuggestions = ({
  bankTransactionId,
  suggestions,
  onEditDraft,
}: BankProposalSuggestionsProps) => {
  const active = suggestions.filter((suggestion) =>
    suggestion.kind === "draft_transaction"
      ? suggestion.transaction.status === "draft"
      : suggestion.actionability === "actionable" ||
        suggestion.actionability === "stale",
  );
  if (active.length === 0) return null;

  return (
    <section className="banking-proposal-suggestions" aria-label="Suggestions">
      <h2>Suggestions</h2>
      <p className="banking-muted">
        Review each suggestion. Recording a draft does not match the bank row.
      </p>
      <div className="banking-proposal-list">
        {active.map((suggestion) => {
          const draft = suggestion.kind === "draft_transaction";
          const transactionHref = draft
            ? `/transactions/${suggestion.transaction.id}/edit?bank=${bankTransactionId}`
            : `/transactions/${suggestion.transaction.id}`;
          return (
            <article
              className="banking-proposal-card"
              key={suggestion.submissionId}
            >
              <div className="banking-proposal-card__heading">
                <span className="banking-proposal-badge">
                  {draft
                    ? "Suggested draft"
                    : suggestion.kind === "existing_match"
                      ? "Suggested match"
                      : "Recorded transaction"}
                </span>
                <strong>
                  {suggestion.transaction.counterparty ??
                    suggestion.transaction.reference ??
                    "Transaction without counterparty"}
                </strong>
              </div>
              <p>
                {suggestion.transaction.kind.replaceAll("_", " ")}
                {suggestion.transaction.documentAmount &&
                suggestion.transaction.documentCurrency
                  ? ` · ${suggestion.transaction.documentCurrency} ${suggestion.transaction.documentAmount}`
                  : ""}
                {suggestion.transaction.settlementAmount &&
                suggestion.transaction.settlementCurrency
                  ? ` · ${suggestion.transaction.settlementCurrency} ${suggestion.transaction.settlementAmount} settlement`
                  : ""}
              </p>
              {suggestion.note && <p>{suggestion.note}</p>}
              {suggestion.actionability === "stale" && (
                <p className="banking-proposal-warning">
                  The bank row changed after this suggestion. Review it before
                  any match.
                </p>
              )}
              {suggestion.actionability === "resolved" && (
                <p className="banking-proposal-warning">
                  This bank row is already resolved. The draft can be reviewed,
                  but matching requires resetting the bank row.
                </p>
              )}
              {draft && onEditDraft ? (
                <button
                  type="button"
                  className="banking-button-link banking-button-secondary"
                  onClick={() => onEditDraft(suggestion.transaction.id)}
                >
                  Edit draft here
                </button>
              ) : (
                <a
                  className="banking-button-link banking-button-secondary"
                  href={transactionHref}
                >
                  {draft ? "Review draft" : "Review transaction"}
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
