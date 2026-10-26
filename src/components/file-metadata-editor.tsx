import { useEffect, useRef, useState } from "react";
import { artifactMetadataEditSchema } from "../artifacts/metadata";
import {
  applyFileFilenameSuggestions,
  parseCsvFilename,
  parseFileFilename,
  type FileFilenameSuggestions,
} from "../domain/file-filename";
import {
  updateArtifactMetadata,
  type getArtifactDetails,
} from "../server/operations";
import { SidePane } from "./context-pane";

type Artifact = NonNullable<Awaited<ReturnType<typeof getArtifactDetails>>>;
type EditableArtifact = Pick<
  Artifact,
  | "id"
  | "artifactProfile"
  | "filename"
  | "originalFilename"
  | "periodStart"
  | "periodEnd"
  | "state"
>;

export interface SavedFileMetadata {
  id: string;
  filename: string;
  periodStart: string | null;
  periodEnd: string | null;
  expected: {
    filename: string;
    periodStart: string | null;
    periodEnd: string | null;
  };
}

interface MetadataDraft {
  filename: string;
  periodStart: string;
  periodEnd: string;
}

interface EditSession {
  artifactId: string;
  expected: SavedFileMetadata["expected"];
  draft: MetadataDraft;
}

const csvProfiles = [
  "stripe_balance_itemised_csv_v1",
  "commbank_transaction_history_csv_v1",
] as const;

const isCsvProfile = (profile: string): boolean =>
  csvProfiles.some((csvProfile) => csvProfile === profile);

const isEditableState = (state: string): boolean =>
  state === "awaiting_review" || state === "available";

const metadataMatches = (
  artifact: EditableArtifact,
  expected: SavedFileMetadata["expected"],
): boolean =>
  artifact.filename === expected.filename &&
  (artifact.periodStart ?? null) === expected.periodStart &&
  (artifact.periodEnd ?? null) === expected.periodEnd;

const csvCoverageSuggestions = (
  filename: string,
  profile: string,
): FileFilenameSuggestions | null => {
  const csvFilename = parseCsvFilename(filename);
  if (csvFilename) {
    if (csvFilename.profile !== profile) return null;
    return {
      supplier: null,
      documentDate: null,
      reference: null,
      periodStart: csvFilename.periodStart,
      periodEnd: csvFilename.periodEnd,
    };
  }

  if (!filename.toLowerCase().endsWith(".csv")) return null;
  const basename = filename.replace(/^.*[\\/]/, "");
  const legacyProvider = /^(stripe|commbank|combank)[_-]/i.exec(basename)?.[1];
  if (legacyProvider) {
    const providerProfile =
      legacyProvider.toLowerCase() === "stripe"
        ? "stripe_balance_itemised_csv_v1"
        : "commbank_transaction_history_csv_v1";
    if (providerProfile !== profile) return null;
  }
  const legacyFilename = parseFileFilename(filename);
  if (!legacyFilename?.periodStart || !legacyFilename.periodEnd) return null;

  return {
    supplier: null,
    documentDate: null,
    reference: null,
    periodStart: legacyFilename.periodStart,
    periodEnd: legacyFilename.periodEnd,
  };
};

export const FileMetadataEditor = ({
  artifact,
  onSaved,
}: {
  artifact: EditableArtifact;
  onSaved: (metadata: SavedFileMetadata) => void;
}) => {
  const [session, setSession] = useState<EditSession | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);
  const artifactRef = useRef(artifact);
  artifactRef.current = artifact;

  useEffect(
    () => () => {
      requestVersion.current += 1;
      pendingRef.current = false;
    },
    [],
  );

  const editable = isEditableState(artifact.state);
  const csv = isCsvProfile(artifact.artifactProfile);
  const originalFilename = artifact.originalFilename ?? artifact.filename;
  const originalCoverage = csv
    ? csvCoverageSuggestions(originalFilename, artifact.artifactProfile)
    : null;
  const draftCoverage =
    csv && session
      ? csvCoverageSuggestions(session.draft.filename, artifact.artifactProfile)
      : null;
  const showDraftCoverage =
    Boolean(draftCoverage) &&
    session?.draft.filename.trim() !== originalFilename.trim();
  const dirty = Boolean(
    session &&
    (session.draft.filename !== session.expected.filename ||
      (csv &&
        (session.draft.periodStart !== (session.expected.periodStart ?? "") ||
          session.draft.periodEnd !== (session.expected.periodEnd ?? "")))),
  );

  const beginEditing = () => {
    if (!editable || pendingRef.current) return;
    setError("");
    setMessage("");
    setSession({
      artifactId: artifact.id,
      expected: {
        filename: artifact.filename,
        periodStart: artifact.periodStart ?? null,
        periodEnd: artifact.periodEnd ?? null,
      },
      draft: {
        filename: artifact.filename,
        periodStart: artifact.periodStart ?? "",
        periodEnd: artifact.periodEnd ?? "",
      },
    });
    setOpen(true);
  };

  const closeEditor = () => {
    if (pendingRef.current) return;
    setSession(null);
    setError("");
    setMessage("");
    setOpen(false);
  };

  const updateDraft = (field: keyof MetadataDraft, value: string) => {
    setSession((current) =>
      current
        ? { ...current, draft: { ...current.draft, [field]: value } }
        : null,
    );
    setError("");
    setMessage("");
  };

  const applyCoverage = (suggestions: FileFilenameSuggestions) => {
    if (!session || pendingRef.current) return;
    const application = applyFileFilenameSuggestions(
      {
        supplier: "",
        documentDate: "",
        reference: "",
        periodStart: session.draft.periodStart,
        periodEnd: session.draft.periodEnd,
      },
      suggestions,
    );

    if (application.conflicts.length) {
      setError(
        "The filename coverage conflicts with a date you entered. Clear or adjust the coverage dates first.",
      );
      setMessage("");
      return;
    }

    if (!application.filled.length) {
      setMessage("No blank coverage fields were filled.");
      setError("");
      return;
    }

    setSession((current) =>
      current
        ? {
            ...current,
            draft: {
              ...current.draft,
              periodStart: application.values.periodStart,
              periodEnd: application.values.periodEnd,
            },
          }
        : null,
    );
    setError("");
    setMessage("Filename coverage was applied to blank fields only.");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || pendingRef.current) return;

    const currentArtifact = artifactRef.current;
    if (
      currentArtifact.id !== session.artifactId ||
      !isEditableState(currentArtifact.state) ||
      !metadataMatches(currentArtifact, session.expected)
    ) {
      setError(
        "File metadata changed. Cancel and reopen the editor to reload it.",
      );
      setMessage("");
      return;
    }

    const periodStart = csv
      ? session.draft.periodStart.trim() || null
      : session.expected.periodStart;
    const periodEnd = csv
      ? session.draft.periodEnd.trim() || null
      : session.expected.periodEnd;
    const parsed = artifactMetadataEditSchema.safeParse({
      id: session.artifactId,
      filename: session.draft.filename,
      periodStart,
      periodEnd,
      expected: session.expected,
    });

    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the file metadata fields.",
      );
      setMessage("");
      return;
    }

    const version = ++requestVersion.current;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setMessage("");

    try {
      const updated = await updateArtifactMetadata({ data: parsed.data });
      if (requestVersion.current !== version) return;
      if (artifactRef.current.id !== session.artifactId) return;
      if (updated.id !== session.artifactId) {
        setError(
          "File metadata could not be confirmed. Reload the file before retrying.",
        );
        return;
      }

      const saved: SavedFileMetadata = {
        id: updated.id,
        filename: updated.filename ?? parsed.data.filename,
        periodStart:
          updated.periodStart === undefined
            ? periodStart
            : (updated.periodStart ?? null),
        periodEnd:
          updated.periodEnd === undefined
            ? periodEnd
            : (updated.periodEnd ?? null),
        expected: session.expected,
      };
      onSaved(saved);
      setSession(null);
      setMessage("File metadata saved.");
      setOpen(false);
    } catch {
      if (requestVersion.current !== version) return;
      setError(
        "File metadata could not be saved. Reload the file before trying again.",
      );
    } finally {
      if (requestVersion.current === version) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  return (
    <section className="file-metadata-editor" aria-label="File metadata">
      <button
        type="button"
        disabled={!editable || pending}
        onClick={beginEditing}
      >
        Edit metadata
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      <SidePane
        title="Edit file metadata"
        isOpen={open}
        onClose={closeEditor}
        pending={pending}
        dirty={dirty}
      >
        {({ requestClose }) =>
          session ? (
            <form
              className="file-metadata-editor-form"
              noValidate
              onSubmit={(event) => void save(event)}
            >
              <div className="file-metadata-editor-fields">
                <label>
                  Filename
                  <input
                    type="text"
                    maxLength={255}
                    value={session.draft.filename}
                    disabled={pending}
                    onChange={(event) =>
                      updateDraft("filename", event.currentTarget.value)
                    }
                  />
                </label>
                {csv && (
                  <>
                    <label>
                      Coverage start
                      <input
                        type="date"
                        value={session.draft.periodStart}
                        disabled={pending}
                        onChange={(event) =>
                          updateDraft("periodStart", event.currentTarget.value)
                        }
                      />
                    </label>
                    <label>
                      Coverage end
                      <input
                        type="date"
                        value={session.draft.periodEnd}
                        disabled={pending}
                        onChange={(event) =>
                          updateDraft("periodEnd", event.currentTarget.value)
                        }
                      />
                    </label>
                  </>
                )}
              </div>

              {csv && (originalCoverage || showDraftCoverage) && (
                <fieldset className="file-metadata-coverage-suggestions">
                  <legend>Coverage suggestions</legend>
                  {originalCoverage && (
                    <div>
                      <p>
                        Original filename ({originalFilename}) suggests coverage{" "}
                        {originalCoverage.periodStart} to{" "}
                        {originalCoverage.periodEnd}.
                      </p>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => applyCoverage(originalCoverage)}
                      >
                        Apply original filename coverage
                      </button>
                    </div>
                  )}
                  {showDraftCoverage && draftCoverage && (
                    <div>
                      <p>
                        Edited filename ({session.draft.filename}) suggests
                        coverage {draftCoverage.periodStart} to{" "}
                        {draftCoverage.periodEnd}.
                      </p>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => applyCoverage(draftCoverage)}
                      >
                        Apply edited filename coverage
                      </button>
                    </div>
                  )}
                  <p>Each action fills only blank coverage fields.</p>
                </fieldset>
              )}

              {error && <p role="alert">{error}</p>}
              {message && <p role="status">{message}</p>}
              <div className="file-metadata-editor-actions">
                <button type="submit" disabled={pending}>
                  {pending ? "Saving metadata…" : "Save metadata"}
                </button>
                <button type="button" disabled={pending} onClick={requestClose}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null
        }
      </SidePane>
    </section>
  );
};
