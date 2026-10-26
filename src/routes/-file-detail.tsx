import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { artifactProfiles } from "../artifacts/profiles";
import { loadFileReviewQueue } from "../artifacts/file-review-queue";
import {
  validateArtifactSearch,
  type ArtifactSearch,
} from "../artifacts/library-query";
import { CsvDuplicateWarnings } from "../components/csv-duplicate-warnings";
import { useContextPane, usePaneGuard } from "../components/context-pane";
import { FileReviewActions } from "../components/file-review-actions";
import {
  FileMetadataEditor,
  type SavedFileMetadata,
} from "../components/file-metadata-editor";
import { MoneyText } from "../components/money-text";
import type { BankCsvPreview } from "../domain/bank-transactions";
import type { StripeImportPreview } from "../domain/stripe-csv";
import type { CsvDuplicateWarningReport } from "../database/repository";
import {
  approveArtifact,
  downloadArtifact,
  getArtifactDetails,
  importStripeCsv,
  listArtifacts,
  previewArtifactForReview,
  previewStripeCsv,
} from "../server/operations";
import {
  confirmBankImport,
  getCsvDuplicateWarnings,
  previewBankCsv,
} from "../server/bank-operations";

type FileDetails = Awaited<ReturnType<typeof getArtifactDetails>>;
type BankConfirmation = Awaited<ReturnType<typeof confirmBankImport>>;
type FileReviewQueueRow = Awaited<
  ReturnType<typeof loadFileReviewQueue>
>[number];

type FileReviewQueueState = {
  key: string;
  status: "loading" | "loaded" | "error";
  rows: FileReviewQueueRow[];
};

const reviewCandidatesAfter = (
  rows: readonly FileReviewQueueRow[],
  currentArtifactId: string,
  approvedArtifactIds: ReadonlySet<string>,
): FileReviewQueueRow[] => {
  const currentIndex = rows.findIndex((row) => row.id === currentArtifactId);
  const remaining = currentIndex < 0 ? rows : rows.slice(currentIndex + 1);

  return remaining.filter(
    (row) =>
      row.state === "awaiting_review" && !approvedArtifactIds.has(row.id),
  );
};

export const FileDetailPage = ({ artifact }: { artifact: FileDetails }) => {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const pane = useContextPane();
  const [importedBankArtifactId, setImportedBankArtifactId] = useState<
    string | null
  >(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [navigationCommitting, setNavigationCommitting] = useState(false);
  const [queueRetry, setQueueRetry] = useState(0);
  const [reviewQueue, setReviewQueue] = useState<FileReviewQueueState | null>(
    null,
  );
  const [reviewQueueEnd, setReviewQueueEnd] = useState<{
    key: string;
    artifactId: string;
  } | null>(null);
  const [navigationError, setNavigationError] = useState("");
  const [error, setError] = useState("");
  const [approvedArtifactIds, setApprovedArtifactIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [approvalMessageArtifactId, setApprovalMessageArtifactId] = useState<
    string | null
  >(null);
  const [metadataOverride, setMetadataOverride] =
    useState<SavedFileMetadata | null>(null);
  const previewRequest = useRef(0);
  const queueRequest = useRef(0);
  const navigationRequest = useRef(0);
  const approvalRequest = useRef(0);
  const mounted = useRef(false);
  const navigationInFlight = useRef(false);
  const approvalInFlight = useRef(false);
  const metadataOverrideMatches = Boolean(
    artifact &&
    metadataOverride &&
    metadataOverride?.id === artifact.id &&
    metadataOverride.expected.filename === artifact.filename &&
    metadataOverride.expected.periodStart === (artifact.periodStart ?? null) &&
    metadataOverride.expected.periodEnd === (artifact.periodEnd ?? null),
  );
  const file =
    artifact && metadataOverride && metadataOverrideMatches
      ? {
          ...artifact,
          filename: metadataOverride.filename,
          periodStart: metadataOverride.periodStart,
          periodEnd: metadataOverride.periodEnd,
        }
      : artifact;
  const libraryContext = location.pathname === "/imports/library";
  const parsedSearch = validateArtifactSearch(
    libraryContext ? (location.search as Record<string, unknown>) : {},
  );
  const queueQuery: Pick<ArtifactSearch, "filters" | "sort"> = {
    filters: parsedSearch.filters,
    sort: parsedSearch.sort,
  };
  const queueKey = `${libraryContext ? "library" : "standalone"}:${JSON.stringify(queueQuery)}`;
  const queueQueryRef = useRef(queueQuery);
  queueQueryRef.current = queueQuery;
  const queueKeyRef = useRef(queueKey);
  queueKeyRef.current = queueKey;
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const locallyApproved = Boolean(
    file?.state === "awaiting_review" && approvedArtifactIds.has(file.id),
  );
  const fileState = locallyApproved ? "available" : file?.state;
  const fileRef = useRef(file);
  fileRef.current = file;
  const readable =
    file && ["awaiting_review", "available"].includes(file.state);
  const activeReviewQueue = reviewQueue?.key === queueKey ? reviewQueue : null;
  const reviewCandidates =
    file && activeReviewQueue?.status === "loaded"
      ? reviewCandidatesAfter(
          activeReviewQueue.rows,
          file.id,
          approvedArtifactIds,
        )
      : [];
  const atEndOfReviewQueue = Boolean(
    file &&
    activeReviewQueue?.status === "loaded" &&
    (reviewQueueEnd?.key === queueKey && reviewQueueEnd.artifactId === file.id
      ? true
      : reviewCandidates.length === 0),
  );
  usePaneGuard({ dirty: false, pending: busy || csvBusy || navigationBusy });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      approvalRequest.current += 1;
      queueRequest.current += 1;
      navigationRequest.current += 1;
      navigationInFlight.current = false;
    };
  }, []);

  useEffect(() => {
    approvalRequest.current += 1;
    const request = ++queueRequest.current;
    navigationRequest.current += 1;
    navigationInFlight.current = false;
    setNavigationBusy(false);
    setNavigationCommitting(false);
    setNavigationError("");
    setReviewQueueEnd(null);
    setReviewQueue({ key: queueKey, status: "loading", rows: [] });

    void loadFileReviewQueue(queueQueryRef.current, (input) =>
      listArtifacts({ data: input }),
    ).then(
      (rows) => {
        if (request !== queueRequest.current) return;
        setReviewQueue({ key: queueKey, status: "loaded", rows });
      },
      () => {
        if (request !== queueRequest.current) return;
        setReviewQueue({ key: queueKey, status: "error", rows: [] });
      },
    );

    return () => {
      approvalRequest.current += 1;
      queueRequest.current += 1;
      navigationRequest.current += 1;
      navigationInFlight.current = false;
    };
  }, [queueKey, queueRetry]);

  useEffect(() => {
    navigationRequest.current += 1;
    navigationInFlight.current = false;
    setNavigationBusy(false);
    setNavigationCommitting(false);
    setNavigationError("");
    setReviewQueueEnd(null);
  }, [file?.id]);

  useEffect(() => {
    if (pane?.active) return;
    approvalRequest.current += 1;
    if (!navigationInFlight.current) return;
    navigationRequest.current += 1;
    navigationInFlight.current = false;
    setNavigationBusy(false);
    setNavigationCommitting(false);
  }, [pane?.active]);

  useEffect(() => {
    const request = ++previewRequest.current;
    setPreviewUrl(null);
    if (readable && file.mediaType === "application/pdf") {
      void previewArtifactForReview({ data: { id: file.id } }).then(
        (url) => {
          if (request === previewRequest.current) setPreviewUrl(url);
        },
        () => {
          if (request === previewRequest.current)
            setError("PDF preview could not be loaded. Retry the preview.");
        },
      );
    }
    return () => {
      previewRequest.current += 1;
    };
  }, [file?.id, file?.state, file?.mediaType, file?.filename, readable]);

  if (!file)
    return (
      <section>
        <h2>File not found</h2>
        <a href="/imports/library">Back to files</a>
      </section>
    );

  const invoice = file.artifactProfile === "manual_invoice_pdf_v1";
  const csv =
    file.artifactProfile === "stripe_balance_itemised_csv_v1" ||
    file.artifactProfile === "commbank_transaction_history_csv_v1";
  const refreshPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreviewUrl(await previewArtifactForReview({ data: { id: file.id } }));
    } catch {
      setError("PDF preview could not be loaded. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const navigateToReviewCandidate = async (
    rows: readonly FileReviewQueueRow[],
    currentArtifactId: string,
    sourceQueueKey: string,
    approvalPending = false,
  ) => {
    if (
      navigationInFlight.current ||
      fileRef.current?.id !== currentArtifactId ||
      queueKeyRef.current !== sourceQueueKey
    )
      return;

    const paneWasActive = Boolean(paneRef.current?.active);
    const request = ++navigationRequest.current;
    navigationInFlight.current = true;
    setNavigationBusy(true);
    setNavigationError("");
    setError("");

    const isCurrentRequest = () =>
      mounted.current &&
      request === navigationRequest.current &&
      fileRef.current?.id === currentArtifactId &&
      queueKeyRef.current === sourceQueueKey &&
      Boolean(paneRef.current?.active) === paneWasActive;

    try {
      const candidates = reviewCandidatesAfter(
        rows,
        currentArtifactId,
        approvedArtifactIds,
      );

      for (const candidate of candidates) {
        if (!isCurrentRequest()) return;

        let details: FileDetails;
        try {
          details = await getArtifactDetails({
            data: { id: candidate.id },
          });
        } catch {
          if (isCurrentRequest())
            setNavigationError(
              "The next file could not be checked. You are still on this file; try again.",
            );
          return;
        }

        if (!isCurrentRequest()) return;
        if (!details || details.state !== "awaiting_review") continue;

        const href = `/imports/files/${encodeURIComponent(details.id)}`;
        flushSync(() => {
          setNavigationBusy(false);
          setNavigationCommitting(true);
          if (approvalPending) setBusy(false);
        });

        if (!isCurrentRequest()) return;

        let navigation: Promise<unknown>;
        if (paneWasActive) {
          const activePane = paneRef.current;
          if (!activePane?.active) return;
          navigation = activePane.replace(href);
        } else {
          navigation = router.navigate({ href });
        }
        void navigation.catch(() => {
          if (isCurrentRequest())
            setNavigationError(
              "The next file could not be opened. You are still on this file; try again.",
            );
        });
        return;
      }

      if (isCurrentRequest())
        setReviewQueueEnd({
          key: sourceQueueKey,
          artifactId: currentArtifactId,
        });
    } catch {
      if (isCurrentRequest())
        setNavigationError(
          "The next file could not be opened. You are still on this file; try again.",
        );
    } finally {
      if (request === navigationRequest.current) {
        navigationInFlight.current = false;
        setNavigationBusy(false);
        setNavigationCommitting(false);
        if (approvalPending) setBusy(false);
      }
    }
  };

  const approve = async (advanceAfterApproval = false) => {
    if (
      busy ||
      csvBusy ||
      navigationBusy ||
      navigationCommitting ||
      approvalInFlight.current ||
      file.state !== "awaiting_review" ||
      file.mediaType !== "application/pdf" ||
      !invoice ||
      approvedArtifactIds.has(file.id)
    )
      return;

    const artifactId = file.id;
    const queueSnapshot = activeReviewQueue;
    if (advanceAfterApproval && queueSnapshot?.status !== "loaded") return;
    const approvalGeneration = ++approvalRequest.current;
    const sourceQueueKey = queueKey;
    const paneWasActive = Boolean(paneRef.current?.active);
    const approvalContextIsCurrent = () =>
      mounted.current &&
      approvalRequest.current === approvalGeneration &&
      fileRef.current?.id === artifactId &&
      queueKeyRef.current === sourceQueueKey &&
      Boolean(paneRef.current?.active) === paneWasActive;

    approvalInFlight.current = true;
    setBusy(true);
    setError("");
    setNavigationError("");

    try {
      try {
        const approvedArtifact = await approveArtifact({
          data: { id: artifactId },
        });
        if (
          approvedArtifact.id !== artifactId ||
          approvedArtifact.state !== "available"
        )
          throw new Error("Approval response did not confirm this artifact");
      } catch {
        if (approvalContextIsCurrent())
          setError(
            "Approval could not be confirmed. Reload the file before trying again.",
          );
        return;
      }

      if (approvalContextIsCurrent()) {
        setApprovedArtifactIds((current) => new Set(current).add(artifactId));
        setApprovalMessageArtifactId(artifactId);
      }
      void router.invalidate().catch(() => {
        if (approvalContextIsCurrent())
          setError(
            "Invoice was approved, but file details could not be refreshed. Reload the file.",
          );
      });

      if (
        advanceAfterApproval &&
        queueSnapshot?.status === "loaded" &&
        approvalContextIsCurrent()
      )
        await navigateToReviewCandidate(
          queueSnapshot.rows,
          artifactId,
          queueSnapshot.key,
          true,
        );
    } finally {
      approvalInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const nextUnapproved = async () => {
    if (!file || activeReviewQueue?.status !== "loaded") return;
    await navigateToReviewCandidate(
      activeReviewQueue.rows,
      file.id,
      activeReviewQueue.key,
    );
  };
  const handleCsvConfirmed = (advance: boolean) => {
    if (!advance || activeReviewQueue?.status !== "loaded") return;
    void navigateToReviewCandidate(
      activeReviewQueue.rows,
      file.id,
      activeReviewQueue.key,
    ).catch(() => {
      if (fileRef.current?.id === file.id)
        setNavigationError(
          "The next file could not be opened. You are still on this file; try again.",
        );
    });
  };
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      window.location.assign(await downloadArtifact({ data: { id: file.id } }));
    } catch {
      setError("Download could not be prepared. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const handleMetadataSaved = (metadata: SavedFileMetadata) => {
    if (fileRef.current?.id !== metadata.id) return;
    const preserveOriginalExpected =
      artifact &&
      metadataOverride &&
      artifact.id === metadata.id &&
      metadataOverride.id === metadata.id &&
      artifact.filename === metadataOverride.expected.filename &&
      (artifact.periodStart ?? null) ===
        metadataOverride.expected.periodStart &&
      (artifact.periodEnd ?? null) === metadataOverride.expected.periodEnd;
    setMetadataOverride(
      preserveOriginalExpected && metadataOverride
        ? { ...metadata, expected: metadataOverride.expected }
        : metadata,
    );
    setError("");
    void router.invalidate().catch(() => {
      if (fileRef.current?.id === metadata.id)
        setError(
          "File metadata was saved, but the file details could not be refreshed. Reload the file.",
        );
    });
  };

  return (
    <section className="file-detail">
      <header className="file-workspace-heading">
        <div>
          <a href="/imports/library">Back to files</a>
          <h2>{file.filename}</h2>
        </div>
        <div className="file-detail-actions">
          {invoice && fileState === "available" && (
            <a
              href={`/transactions/new?artifactId=${encodeURIComponent(file.id)}`}
            >
              Create transaction from invoice
            </a>
          )}
          <button
            type="button"
            disabled={busy || fileState !== "available"}
            title={
              fileState !== "available"
                ? "Available after approval or import"
                : undefined
            }
            onClick={() => void download()}
          >
            Download
          </button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {locallyApproved && approvalMessageArtifactId === file.id && (
        <p role="status">
          Invoice approved. You can now create a transaction from this file.
        </p>
      )}
      {importedBankArtifactId && (
        <p>
          <a
            href={`/banking/reconcile?artifact=${encodeURIComponent(importedBankArtifactId)}`}
          >
            Review imported bank activity
          </a>
        </p>
      )}
      <dl className="file-metadata">
        <div>
          <dt>Profile</dt>
          <dd>
            {artifactProfiles.find((p) => p.profile === file.artifactProfile)
              ?.label ?? file.artifactProfile}
          </dd>
        </div>
        <div>
          <dt>Download filename</dt>
          <dd>{file.filename}</dd>
        </div>
        <div>
          <dt>Original filename</dt>
          <dd>{file.originalFilename ?? file.filename}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{fileState?.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Coverage start</dt>
          <dd>{file.periodStart ?? "Not specified"}</dd>
        </div>
        <div>
          <dt>Coverage end</dt>
          <dd>{file.periodEnd ?? "Not specified"}</dd>
        </div>
        {invoice && (
          <>
            <div>
              <dt>Supplier</dt>
              <dd>{file.supplier ?? "Not specified"}</dd>
            </div>
            <div>
              <dt>Invoice date</dt>
              <dd>{file.documentDate ?? "Not specified"}</dd>
            </div>
            <div>
              <dt>Reference</dt>
              <dd>{file.reference ?? "Not specified"}</dd>
            </div>
          </>
        )}
        <div>
          <dt>Notes</dt>
          <dd>{file.notes || "None"}</dd>
        </div>
      </dl>
      <FileMetadataEditor
        key={`metadata-${file.id}`}
        artifact={file}
        onSaved={handleMetadataSaved}
      />
      {file.mediaType === "application/pdf" && readable && (
        <section aria-label="PDF preview">
          <header className="file-workspace-heading">
            <h3>PDF preview</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refreshPreview()}
            >
              Refresh preview
            </button>
          </header>
          {previewUrl ? (
            <>
              <iframe
                title={`PDF preview: ${file.filename}`}
                src={previewUrl}
                className="file-pdf-preview"
              />
              <p>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open PDF in a new tab
                </a>
              </p>
            </>
          ) : (
            <p role="status">Preparing PDF preview…</p>
          )}
        </section>
      )}
      {invoice && (
        <FileReviewActions
          canConfirm={Boolean(
            readable &&
            previewUrl &&
            file.state === "awaiting_review" &&
            !approvedArtifactIds.has(file.id),
          )}
          busy={busy || csvBusy}
          navigationBusy={navigationBusy || navigationCommitting}
          confirmed={fileState === "available"}
          queueStatus={activeReviewQueue?.status ?? "loading"}
          atEnd={atEndOfReviewQueue}
          navigationError={navigationError}
          onConfirm={(advance) => void approve(advance)}
          onSkip={() => void nextUnapproved()}
          onRetryQueue={() => setQueueRetry((retry) => retry + 1)}
        />
      )}
      {!readable && (
        <p>
          This file is not available for content review in its current state.
        </p>
      )}
      {csv && !readable && (
        <FileReviewActions
          canConfirm={false}
          busy={busy || csvBusy}
          navigationBusy={navigationBusy || navigationCommitting}
          confirmed={false}
          queueStatus={activeReviewQueue?.status ?? "loading"}
          atEnd={atEndOfReviewQueue}
          navigationError={navigationError}
          onConfirm={() => undefined}
          onSkip={() => void nextUnapproved()}
          onRetryQueue={() => setQueueRetry((retry) => retry + 1)}
        />
      )}
      {csv && readable && (
        <FileCsvReview
          key={file.id}
          artifactId={file.id}
          profile={file.artifactProfile}
          alreadyImported={file.state === "available"}
          onPendingChange={setCsvBusy}
          onConfirmed={handleCsvConfirmed}
          renderActions={({
            ready,
            busy: csvReviewBusy,
            confirmed,
            onConfirm,
          }) => (
            <FileReviewActions
              canConfirm={ready}
              busy={csvReviewBusy || busy || csvBusy}
              navigationBusy={navigationBusy || navigationCommitting}
              confirmed={confirmed}
              queueStatus={activeReviewQueue?.status ?? "loading"}
              atEnd={atEndOfReviewQueue}
              navigationError={navigationError}
              onConfirm={onConfirm}
              onSkip={() => void nextUnapproved()}
              onRetryQueue={() => setQueueRetry((retry) => retry + 1)}
            />
          )}
          onImported={async (bankArtifactId) => {
            if (bankArtifactId) setImportedBankArtifactId(bankArtifactId);
            try {
              await router.invalidate();
            } catch {
              if (fileRef.current?.id === file.id)
                setError(
                  bankArtifactId && bankArtifactId !== file.id
                    ? "A matching bank import was found, but file details could not be refreshed. The existing import remains available below."
                    : "File details could not be refreshed after confirmation. Reload the file.",
                );
            }
          }}
        />
      )}
      {!invoice &&
        !csv &&
        file.artifactProfile &&
        artifactProfiles.some(
          (profile) => profile.profile === file.artifactProfile,
        ) && (
          <FileReviewActions
            canConfirm={false}
            busy={busy || csvBusy}
            navigationBusy={navigationBusy || navigationCommitting}
            confirmed={false}
            queueStatus={activeReviewQueue?.status ?? "loading"}
            atEnd={atEndOfReviewQueue}
            navigationError={navigationError}
            disabledReason="Review and import actions are not supported for this file profile yet."
            onConfirm={() => undefined}
            onSkip={() => void nextUnapproved()}
            onRetryQueue={() => setQueueRetry((retry) => retry + 1)}
          />
        )}
      <section aria-label="Linked transactions">
        <h3>Linked transactions</h3>
        {file.linkedTransactionIds.length ? (
          <ul>
            {file.linkedTransactionIds.map((id) => (
              <li key={id}>
                <a href={`/transactions/${id}`}>View transaction {id}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p>No transactions linked yet.</p>
        )}
        {file.bankRowCount > 0 && (
          <p>
            {file.bankRowCount} imported bank activity rows.{" "}
            <a
              href={`/banking/reconcile?artifact=${encodeURIComponent(file.id)}`}
            >
              Review and create or match transactions
            </a>
          </p>
        )}
      </section>
    </section>
  );
};

const FileCsvReview = ({
  artifactId,
  profile,
  alreadyImported,
  onPendingChange,
  onImported,
  onConfirmed,
  renderActions,
}: {
  artifactId: string;
  profile: string | undefined;
  alreadyImported: boolean;
  onPendingChange: (pending: boolean) => void;
  onImported: (bankArtifactId?: string) => Promise<void>;
  onConfirmed: (advance: boolean) => void;
  renderActions: (state: {
    ready: boolean;
    busy: boolean;
    confirmed: boolean;
    onConfirm: (advance: boolean) => void;
  }) => ReactNode;
}) => {
  const [stripe, setStripe] = useState<StripeImportPreview | null>(null);
  const [bank, setBank] = useState<BankCsvPreview | null>(null);
  const [duplicates, setDuplicates] =
    useState<CsvDuplicateWarningReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(alreadyImported);
  const [duplicateBlocked, setDuplicateBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [overlap, setOverlap] = useState<Extract<
    BankConfirmation,
    { status: "overlap_acknowledgement_required" }
  > | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const artifactIdRef = useRef(artifactId);
  artifactIdRef.current = artifactId;
  const stripeProfile = profile === "stripe_balance_itemised_csv_v1";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (alreadyImported) setConfirmed(true);
  }, [alreadyImported]);

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        if (stripeProfile) {
          const result = await previewStripeCsv({ data: { artifactId, page } });
          if (version === requestVersion.current) setStripe(result);
        } else {
          const result = await previewBankCsv({ data: { artifactId } });
          if (version === requestVersion.current) setBank(result);
        }
      } catch {
        if (version === requestVersion.current)
          setError(
            "CSV preview could not be loaded. Check the selected profile and source format.",
          );
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    };
    void load();
    void getCsvDuplicateWarnings({ data: { artifactId } }).then(
      (result) => {
        if (version === requestVersion.current) setDuplicates(result);
      },
      () => {
        if (version === requestVersion.current)
          setMessage(
            "Duplicate-source warnings are unavailable. Import-time duplicate checks still apply.",
          );
      },
    );
    return () => {
      requestVersion.current += 1;
    };
  }, [artifactId, stripeProfile, page, reload]);

  const ready =
    !loading &&
    !busy &&
    !confirmed &&
    !duplicateBlocked &&
    !error &&
    (stripeProfile
      ? Boolean(
          stripe && stripe.willImportCount > 0 && stripe.conflictCount === 0,
        )
      : Boolean(
          !alreadyImported &&
          bank &&
          bank.rows.length &&
          bank.errors.length === 0,
        )) &&
    (!overlap || acknowledged);

  const confirm = async (advanceAfterConfirmation: boolean) => {
    if (!ready || inFlight.current) return;
    const operationArtifactId = artifactId;
    const operationVersion = requestVersion.current;
    const confirmNext = onConfirmed;
    const isCurrentOperation = () =>
      mounted.current &&
      requestVersion.current === operationVersion &&
      artifactIdRef.current === operationArtifactId;
    let shouldAdvance = false;

    inFlight.current = true;
    onPendingChange(true);
    setBusy(true);
    setError("");
    try {
      if (stripeProfile) {
        await importStripeCsv({ data: { artifactId: operationArtifactId } });
        if (!isCurrentOperation()) return;

        setConfirmed(true);
        setMessage(
          "Stripe import confirmed. Reopen the preview to see current row statuses.",
        );
        shouldAdvance = advanceAfterConfirmation;
        void previewStripeCsv({
          data: { artifactId: operationArtifactId, page },
        }).then(
          (result) => {
            if (isCurrentOperation()) setStripe(result);
          },
          () => {
            if (isCurrentOperation())
              setError(
                "Stripe import was confirmed, but source rows could not be refreshed. Refresh the source rows to retry.",
              );
          },
        );
        try {
          void onImported().catch(() => {
            if (isCurrentOperation())
              setError(
                "Stripe import was confirmed, but file details could not be refreshed. Reload the file.",
              );
          });
        } catch {
          if (isCurrentOperation())
            setError(
              "Stripe import was confirmed, but file details could not be refreshed. Reload the file.",
            );
        }
      } else {
        const result = await confirmBankImport({
          data: {
            artifactId: operationArtifactId,
            acknowledgedOverlapFingerprint: acknowledged
              ? (overlap?.overlapFingerprint ?? null)
              : null,
          },
        });
        if (!isCurrentOperation()) return;
        if (result.status === "invalid") {
          setError(
            "The CSV contains validation errors. No rows were imported.",
          );
          return;
        }
        if (result.status === "overlap_acknowledgement_required") {
          setOverlap(result);
          setAcknowledged(false);
          return;
        }
        const currentFileWasImported =
          result.artifactId === operationArtifactId;
        if (result.status === "imported" && currentFileWasImported) {
          setConfirmed(true);
          shouldAdvance = advanceAfterConfirmation;
        } else if (
          result.status === "already_imported" &&
          currentFileWasImported
        ) {
          setConfirmed(true);
          shouldAdvance = advanceAfterConfirmation;
        } else {
          setDuplicateBlocked(true);
        }
        setOverlap(null);
        setMessage(
          `${result.rowCount} bank activity rows ${result.status === "already_imported" ? "already imported" : "imported"}. Review them to create or match financial transactions.`,
        );
        try {
          void onImported(result.artifactId).catch(() => {
            if (isCurrentOperation())
              setError(
                currentFileWasImported
                  ? "Bank activity was confirmed, but file details could not be refreshed. Reload the file."
                  : "A matching bank import was found, but file details could not be refreshed. The existing import remains available below.",
              );
          });
        } catch {
          if (isCurrentOperation())
            setError(
              currentFileWasImported
                ? "Bank activity was confirmed, but file details could not be refreshed. Reload the file."
                : "A matching bank import was found, but file details could not be refreshed. The existing import remains available below.",
            );
        }
      }
    } catch {
      if (isCurrentOperation())
        setError(
          "Import outcome could not be confirmed. Refresh this file and inspect existing records before retrying.",
        );
    } finally {
      inFlight.current = false;
      flushSync(() => {
        setBusy(false);
        onPendingChange(false);
      });
    }
    if (shouldAdvance && isCurrentOperation()) confirmNext(true);
  };

  return (
    <section aria-label="Proposed transactions">
      <h3>Proposed transactions</h3>
      <button
        type="button"
        disabled={loading || busy}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh source rows
      </button>
      <p>
        Coverage dates describe the file. Every source row is reviewed and
        import dates come from the CSV.
      </p>
      {!stripeProfile && (
        <p>
          Confirming imports bank activity for reconciliation. Financial
          transactions are created or matched explicitly afterward.
        </p>
      )}
      {!stripeProfile && alreadyImported && (
        <p>
          This file's bank activity has already been imported. Use
          reconciliation to create or match transactions.
        </p>
      )}
      {loading && <p role="status">Loading source rows…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <CsvDuplicateWarnings report={duplicates} />
      {stripe && (
        <>
          <p>
            {stripe.totalCount} rows · {stripe.willImportCount} proposed ·{" "}
            {stripe.alreadyImportedCount} already imported ·{" "}
            {stripe.conflictCount} conflicts
          </p>
          <div className="file-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Kind</th>
                  <th>Gross</th>
                  <th>Fee</th>
                  <th>Net</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stripe.rows.map((row) => (
                  <tr key={row.reference}>
                    <td>{row.reference}</td>
                    <td>{row.occurredAt}</td>
                    <td>
                      {row.kind}
                      {row.mappingWarning && <p>{row.mappingWarning}</p>}
                    </td>
                    <td>
                      <MoneyText>{`${row.sourceGross} ${row.sourceCurrency}`}</MoneyText>
                    </td>
                    <td>
                      <MoneyText>{`${row.sourceFee} ${row.sourceCurrency}`}</MoneyText>
                    </td>
                    <td>
                      <MoneyText>{`${row.sourceNet} ${row.sourceCurrency}`}</MoneyText>
                    </td>
                    <td>{row.importStatus.replaceAll("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Source row pages">
            <button
              type="button"
              disabled={loading || busy || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous rows
            </button>
            <span>
              Page {stripe.page} of {stripe.totalPages}
            </span>
            <button
              type="button"
              disabled={loading || busy || page >= stripe.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next rows
            </button>
          </nav>
        </>
      )}
      {bank && (
        <>
          {bank.errors.length > 0 && (
            <ul role="alert">
              {bank.errors.map((issue, index) => (
                <li key={index}>
                  Row {issue.row}: {issue.message}
                </li>
              ))}
            </ul>
          )}
          <p>
            {bank.rows.length} proposed bank activity rows · {bank.earliestDate}{" "}
            to {bank.latestDate}
          </p>
          <div className="file-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount (AUD)</th>
                </tr>
              </thead>
              <tbody>
                {bank.rows.slice((page - 1) * 100, page * 100).map((row) => (
                  <tr key={row.sourceRow}>
                    <td>{row.sourceRow}</td>
                    <td>{row.postedDate}</td>
                    <td>{row.description}</td>
                    <td>
                      <MoneyText>{`${row.amountAud} AUD`}</MoneyText>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Source row pages">
            <button
              type="button"
              disabled={busy || page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous rows
            </button>
            <span>
              Page {page} of {Math.max(1, Math.ceil(bank.rows.length / 100))}
            </span>
            <button
              type="button"
              disabled={busy || page * 100 >= bank.rows.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next rows
            </button>
          </nav>
        </>
      )}
      {overlap && (
        <fieldset>
          <legend>Overlapping import dates</legend>
          <ul>
            {overlap.overlaps.map((item) => (
              <li key={item.artifactId}>
                {item.filename}: {item.overlapStart} to {item.overlapEnd}
              </li>
            ))}
          </ul>
          <label>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I reviewed these overlaps and intend to import every row.
          </label>
        </fieldset>
      )}
      {renderActions({
        ready,
        busy,
        confirmed,
        onConfirm: (advance) => void confirm(advance),
      })}
    </section>
  );
};
