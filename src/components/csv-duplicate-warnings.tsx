import type { CsvDuplicateWarningReport } from "../database/repository";

const reasonText: Record<
  CsvDuplicateWarningReport["warnings"][number]["reason"],
  string
> = {
  same_checksum: "Exact same-profile file checksum",
  same_filename: "Matching filename only — weak signal",
  overlapping_rows: "Overlapping source-row identities",
};

export const CsvDuplicateWarnings = ({
  report,
}: {
  report: CsvDuplicateWarningReport | null;
}) => {
  if (
    !report ||
    (report.warnings.length === 0 && !report.rowIdentityLimitReached)
  )
    return null;

  return (
    <aside className="csv-duplicate-warnings" aria-label="Duplicate warnings">
      <strong>Possible duplicate source</strong>
      <p>
        These warnings do not block review. Import-time duplicate and conflict
        checks remain authoritative.
      </p>
      {report.rowIdentityLimitReached && (
        <p>Row-overlap checking reached its limit for this file.</p>
      )}
      {report.warnings.map((warning) => (
        <div key={warning.reason}>
          <strong>{reasonText[warning.reason]}</strong>
          <ul>
            {warning.matches.map((match) => (
              <li key={match.artifactId}>
                {match.filename} · {match.artifactId}
                {match.matchingRowCount !== null
                  ? ` · ${match.matchingRowCount} overlapping ${match.matchingRowCount === 1 ? "row" : "rows"}`
                  : ""}
              </li>
            ))}
          </ul>
          {warning.truncated && (
            <p>
              Showing some of {warning.totalArtifactCount} matching artifacts.
            </p>
          )}
        </div>
      ))}
    </aside>
  );
};
