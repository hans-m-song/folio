import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SourceTabs } from "../components/import-profile-tabs";
import { CsvDuplicateWarnings } from "../components/csv-duplicate-warnings";
import { MoneyText } from "../components/money-text";
import type { BankCsvPreview } from "../domain/bank-transactions";
import type { CsvDuplicateWarningReport } from "../database/repository";
import {
  cancelBankImport,
  confirmBankImport,
  getCsvDuplicateWarnings,
  previewBankCsv,
} from "../server/bank-operations";
import {
  confirmArtifactUpload,
  findArtifactFilenameMatches,
  listArtifacts,
  rejectArtifact,
  startArtifactUpload,
} from "../server/operations";

export const Route = createFileRoute("/banking/imports/new")({
  beforeLoad: () => {
    throw redirect({ to: "/imports/commbank" });
  },
});

const sha256Base64 = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
};

export type BankImportDecision = "pending" | "accepted" | "rejected";

export type BankImportConfirmationStatus =
  | "overlap"
  | "invalid"
  | "failed"
  | "imported"
  | "already_imported";

export interface BankImportConfirmationCandidate {
  decision: BankImportDecision;
  artifactId: string | null;
  preview: BankCsvPreview | null;
  confirmationStatus: BankImportConfirmationStatus | null;
  overlapFingerprint: string | null;
  acknowledgedOverlapFingerprint: string | null;
}

export const bankImportConfirmationEnabled = (
  preview: Pick<BankCsvPreview, "errors" | "rows">,
  overlapFingerprint: string | null,
  acknowledgedOverlapFingerprint: string | null,
  confirming: boolean,
): boolean =>
  preview.errors.length === 0 &&
  preview.rows.length > 0 &&
  (overlapFingerprint === null ||
    acknowledgedOverlapFingerprint === overlapFingerprint) &&
  !confirming;

export const bankImportConfirmationCandidates = <
  T extends BankImportConfirmationCandidate,
>(
  items: readonly T[],
  confirming: boolean,
): T[] =>
  confirming
    ? []
    : items.filter(
        (item) =>
          item.decision === "accepted" &&
          item.artifactId !== null &&
          item.preview !== null &&
          item.confirmationStatus !== "invalid" &&
          item.confirmationStatus !== "imported" &&
          item.confirmationStatus !== "already_imported" &&
          bankImportConfirmationEnabled(
            item.preview,
            item.overlapFingerprint,
            item.acknowledgedOverlapFingerprint,
            false,
          ),
      );

export const signedBankImportTotal = (
  preview: Pick<BankCsvPreview, "errors" | "rows">,
): string | null => {
  if (preview.errors.length || preview.rows.length === 0) return null;

  let total = 0n;
  for (const row of preview.rows) {
    const match = /^(-?)(\d+)\.(\d{4})$/.exec(row.amountAud);
    if (!match) return null;
    const amount = BigInt(match[2]!) * 10_000n + BigInt(match[3]!);
    total += match[1] === "-" ? -amount : amount;
  }

  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const whole = (absolute / 10_000n).toString();
  const fraction = (absolute % 10_000n).toString().padStart(4, "0");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}A$${groupedWhole}.${fraction}`;
};

export type FailedBankUploadCleanup =
  | "not_started"
  | "abandoned"
  | "abandon_failed";

export const abandonFailedBankUpload = async (
  artifactId: string | null,
  abandon: (artifactId: string) => Promise<unknown>,
): Promise<FailedBankUploadCleanup> => {
  if (!artifactId) return "not_started";
  try {
    await abandon(artifactId);
    return "abandoned";
  } catch {
    return "abandon_failed";
  }
};

export const bankUploadFailureMessage = (
  stage: "prepare" | "upload" | "confirm" | "preview",
  cleanup: FailedBankUploadCleanup,
): string => {
  const failure = {
    prepare:
      "The import could not be prepared. Check the selected file and retry.",
    upload: "The browser upload failed. Check the connection and retry.",
    confirm: "Upload confirmation failed. Retry the saved artifact.",
    preview:
      "The uploaded CSV could not be parsed. Check the fixed CommBank format and retry.",
  }[stage];
  return cleanup === "abandon_failed"
    ? `${failure} The pending artifact could not be abandoned; use Cancel pending upload before retrying or leaving this page.`
    : `${failure} No pending import was retained.`;
};

export const bankCancelFailureMessage = (original: string): string =>
  original
    ? `${original} Cancellation failed; the pending artifact is still retained. Retry Cancel pending upload before leaving this page.`
    : "Cancellation failed; the pending artifact is still retained. Retry before leaving this page.";

interface BankOverlapWarning {
  overlapFingerprint: string;
  overlaps: {
    artifactId: string;
    filename: string;
    overlapStart: string;
    overlapEnd: string;
  }[];
}

type Stage =
  | "choose"
  | "uploading"
  | "confirm_failed"
  | "preview_failed"
  | "review"
  | "rejecting"
  | "confirming"
  | "complete";

interface BankImportQueueItem extends BankImportConfirmationCandidate {
  id: string;
  file: File | null;
  filename: string;
  checksumSha256: string | null;
  completedArtifactId: string | null;
  stage: Stage;
  message: string;
  errorMessage: string | null;
  overlapWarning: BankOverlapWarning | null;
  filenameMatchCount: number | null;
  filenameMatchCheckFailed: boolean;
  duplicateWarnings: CsvDuplicateWarningReport | null;
  duplicateWarningCheckFailed: boolean;
}

const bankImportQueueStatus = (item: BankImportQueueItem): string => {
  if (item.decision === "rejected") return "Rejected";
  if (item.confirmationStatus === "imported") return "Imported";
  if (item.confirmationStatus === "already_imported") return "Already imported";
  if (item.stage === "uploading") return "Uploading";
  if (item.stage === "confirm_failed") return "Confirm upload to continue";
  if (item.stage === "preview_failed") return "Load preview to continue";
  if (item.stage === "rejecting") return "Rejecting";
  if (item.stage === "confirming") return "Importing";
  if (item.confirmationStatus === "overlap") return "Needs acknowledgement";
  if (item.confirmationStatus === "invalid") return "Server validation errors";
  if (item.confirmationStatus === "failed") return "Result unknown";
  if (item.errorMessage) return "Failed";
  if (item.decision === "accepted") return "Added to batch";
  if (item.stage === "review")
    return item.preview?.errors.length ? "Review errors" : "Awaiting decision";
  if (item.artifactId) return "Pending upload cleanup";
  return "Queued";
};

const BankPreviewDetails = ({ item }: { item: BankImportQueueItem }) => {
  if (!item.preview) return null;

  return (
    <>
      {item.preview.errors.length > 0 && (
        <div className="form-error-summary" role="alert">
          <strong>Review each source-file error before importing.</strong>
          <ul>
            {item.preview.errors.map((error, index) => (
              <li key={`${error.row}-${error.field}-${index}`}>
                Row {error.row}, {error.field}: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="banking-table-scroll">
        <table className="banking-table banking-records-table banking-preview-table">
          <thead>
            <tr>
              <th scope="col">Row</th>
              <th scope="col">Posted</th>
              <th scope="col">Description</th>
              <th scope="col" className="money-column">
                Movement
              </th>
              <th scope="col" className="money-column">
                Source running balance
              </th>
            </tr>
          </thead>
          <tbody>
            {item.preview.rows.map((row) => (
              <tr key={row.sourceRow}>
                <td data-label="Row">{row.sourceRow}</td>
                <td data-label="Posted">
                  <time dateTime={row.postedDate}>{row.postedDate}</time>
                </td>
                <td data-label="Description">{row.description}</td>
                <td
                  data-label="Movement"
                  className={`money-column ${row.amountAud.startsWith("-") ? "amount-negative" : "amount-positive"}`}
                >
                  <MoneyText>{row.amountAud}</MoneyText>
                </td>
                <td
                  data-label="Source running balance"
                  className="money-column"
                >
                  <MoneyText>{row.metadata.runningBalance}</MoneyText>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

const BankPreviewCounts = ({ item }: { item: BankImportQueueItem }) => {
  if (!item.preview) return null;

  return (
    <div className="banking-preview-counts" aria-label="Preview counts">
      <p className="banking-row-count">
        <strong>{item.preview.rows.length}</strong> valid{" "}
        {item.preview.rows.length === 1 ? "row" : "rows"}
      </p>
      <p className="banking-row-count banking-error-count">
        <strong>{item.preview.errors.length}</strong>{" "}
        {item.preview.errors.length === 1 ? "error" : "errors"}
      </p>
    </div>
  );
};

export function NewBankImportPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [queue, setQueue] = useState<BankImportQueueItem[]>([]);
  const queueRef = useRef<BankImportQueueItem[]>([]);
  const nextId = useRef(0);
  const abortControllers = useRef(new Map<string, AbortController>());
  const cancellationRequested = useRef(new Set<string>());
  const confirmingBatch = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"files" | "batch">("files");
  const [queueMessage, setQueueMessage] = useState("");
  const [batchMessage, setBatchMessage] = useState("");
  const [checkingFiles, setCheckingFiles] = useState(false);
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [savedQueueOffset, setSavedQueueOffset] = useState(0);
  const [savedQueueTotal, setSavedQueueTotal] = useState(0);
  const [loadingSavedQueue, setLoadingSavedQueue] = useState(false);
  const activeItem = queue.find((item) => item.id === activeId) ?? null;
  const acceptedItems = queue.filter((item) => item.decision === "accepted");
  const pendingPreviewCount = queue.filter(
    (item) => item.stage === "review" && item.decision === "pending",
  ).length;
  const hasActiveUpload = queue.some(
    (item) => item.stage === "uploading" || item.stage === "rejecting",
  );
  const confirmationCandidates = bankImportConfirmationCandidates(
    queue,
    batchConfirming,
  );
  const acceptedRowCount = acceptedItems.reduce(
    (total, item) => total + (item.preview?.rows.length ?? 0),
    0,
  );
  const acceptedErrorCount = acceptedItems.reduce(
    (total, item) => total + (item.preview?.errors.length ?? 0),
    0,
  );

  const commitQueue = (nextQueue: BankImportQueueItem[]) => {
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  };

  const updateItem = (
    id: string,
    update: (item: BankImportQueueItem) => BankImportQueueItem,
  ) => {
    commitQueue(
      queueRef.current.map((item) => (item.id === id ? update(item) : item)),
    );
  };

  const checkDuplicateWarnings = async (id: string, artifactId: string) => {
    try {
      const duplicateWarnings = await getCsvDuplicateWarnings({
        data: { artifactId },
      });
      updateItem(id, (current) => ({
        ...current,
        duplicateWarnings,
        duplicateWarningCheckFailed: false,
      }));
    } catch {
      updateItem(id, (current) => ({
        ...current,
        duplicateWarningCheckFailed: true,
      }));
    }
  };

  const loadSavedQueue = async (offset: number) => {
    setLoadingSavedQueue(true);
    try {
      const result = await listArtifacts({
        data: {
          search: "",
          profile: "commbank_transaction_history_csv_v1",
          state: "awaiting_review",
          from: null,
          to: null,
          linkage: "all",
          limit: 100,
          offset,
        },
      });
      const existingIds = new Set(
        queueRef.current.map((item) => item.artifactId),
      );
      const restored = result.rows
        .filter((row) => !existingIds.has(row.id))
        .map(
          (row): BankImportQueueItem => ({
            id: `saved-bank-import-${row.id}`,
            file: null,
            filename: row.filename,
            checksumSha256: null,
            artifactId: row.id,
            completedArtifactId: null,
            preview: null,
            decision: "pending",
            confirmationStatus: null,
            overlapFingerprint: null,
            acknowledgedOverlapFingerprint: null,
            stage: "preview_failed",
            message: "Validated upload awaits preview and a per-file decision.",
            errorMessage: null,
            overlapWarning: null,
            filenameMatchCount: 0,
            filenameMatchCheckFailed: false,
            duplicateWarnings: null,
            duplicateWarningCheckFailed: false,
          }),
        );
      commitQueue([...queueRef.current, ...restored]);
      setSavedQueueOffset(offset + result.rows.length);
      setSavedQueueTotal(result.total);
    } catch {
      setQueueMessage(
        "Saved CommBank files could not be loaded. Retry from the file library.",
      );
    } finally {
      setLoadingSavedQueue(false);
    }
  };

  useEffect(() => {
    void loadSavedQueue(0);
  }, []);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setView("files");
    setCheckingFiles(true);
    setQueueMessage("Checking selected files for duplicates…");
    const prepared = await Promise.all(
      files.map(async (file) => {
        try {
          return { file, checksumSha256: await sha256Base64(file) };
        } catch {
          return { file, checksumSha256: null };
        }
      }),
    );
    const knownChecksums = new Set(
      queueRef.current.flatMap((item) =>
        item.checksumSha256 ? [item.checksumSha256] : [],
      ),
    );
    const added: BankImportQueueItem[] = [];
    let duplicateCount = 0;
    for (const item of prepared) {
      if (item.checksumSha256 && knownChecksums.has(item.checksumSha256)) {
        duplicateCount += 1;
        continue;
      }
      if (item.checksumSha256) knownChecksums.add(item.checksumSha256);
      const id = `bank-import-${nextId.current++}`;
      added.push({
        id,
        file: item.file,
        filename: item.file.name,
        checksumSha256: item.checksumSha256,
        artifactId: null,
        completedArtifactId: null,
        preview: null,
        decision: "pending",
        confirmationStatus: null,
        overlapFingerprint: null,
        acknowledgedOverlapFingerprint: null,
        stage: "choose",
        message: "",
        errorMessage: item.checksumSha256
          ? null
          : "The file could not be prepared for duplicate checking. Retry to try again.",
        overlapWarning: null,
        filenameMatchCount: null,
        filenameMatchCheckFailed: false,
        duplicateWarnings: null,
        duplicateWarningCheckFailed: false,
      });
    }
    if (added.length) {
      commitQueue([...queueRef.current, ...added]);
      setActiveId(added[0]!.id);
      void findArtifactFilenameMatches({
        data: {
          profile: "commbank_transaction_history_csv_v1",
          filenames: added.map((item) => item.filename),
        },
      })
        .then((matchCounts) => {
          added.forEach((item, index) =>
            updateItem(item.id, (current) => ({
              ...current,
              filenameMatchCount: matchCounts[index] ?? 0,
            })),
          );
        })
        .catch(() => {
          added.forEach((item) =>
            updateItem(item.id, (current) => ({
              ...current,
              filenameMatchCheckFailed: true,
            })),
          );
        });
    }
    setQueueMessage(
      [
        duplicateCount
          ? `${duplicateCount} duplicate ${duplicateCount === 1 ? "file was" : "files were"} rejected because the same content is already queued.`
          : "",
        added.some((item) => item.errorMessage)
          ? "A file could not be prepared; select it and retry."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    setCheckingFiles(false);
  };

  const upload = async (id: string) => {
    const item = queueRef.current.find((candidate) => candidate.id === id);
    if (!item?.file || item.stage !== "choose" || item.artifactId) return;
    const file = item.file;
    let checksumSha256 = item.checksumSha256;
    if (!checksumSha256) {
      try {
        checksumSha256 = await sha256Base64(file);
      } catch {
        updateItem(id, (current) => ({
          ...current,
          errorMessage:
            "The file could not be read for upload. Check the file and retry.",
          message:
            "The file could not be read for upload. Check the file and retry.",
        }));
        return;
      }
    }
    const duplicate = queueRef.current.some(
      (candidate) =>
        candidate.id !== id && candidate.checksumSha256 === checksumSha256,
    );

    if (duplicate) {
      updateItem(id, (current) => ({
        ...current,
        errorMessage: "This file duplicates another file already in the queue.",
        message: "This file duplicates another file already in the queue.",
      }));
      return;
    }
    updateItem(id, (current) => ({
      ...current,
      checksumSha256,
      stage: "uploading",
      message: "Uploading and preparing the source CSV preview…",
      errorMessage: null,
    }));
    cancellationRequested.current.delete(id);
    let pendingArtifactId: string | null = null;
    let failureStage: "prepare" | "upload" | "confirm" | "preview" = "prepare";
    let confirmed = false;
    try {
      if (cancellationRequested.current.has(id)) throw new Error("Cancelled");
      const started = await startArtifactUpload({
        data: {
          ownerId: null,
          artifactProfile: "commbank_transaction_history_csv_v1",
          filename: item.filename,
          mediaType: "text/csv",
          byteSize: file.size,
          checksumSha256,
        },
      });
      pendingArtifactId = started.artifact.id;
      updateItem(id, (current) => ({
        ...current,
        artifactId: started.artifact.id,
      }));
      failureStage = "upload";
      const controller = new AbortController();
      abortControllers.current.set(id, controller);
      if (cancellationRequested.current.has(id)) controller.abort();
      const response = await fetch(started.uploadUrl, {
        method: "PUT",
        body: file,
        signal: controller.signal,
        headers: {
          "content-type": "text/csv",
          "x-amz-checksum-sha256": checksumSha256,
          "x-amz-meta-folio-artifact-id": started.artifact.id,
        },
      });
      if (!response.ok) throw new Error("The CSV upload failed");
      if (cancellationRequested.current.has(id))
        throw new Error("The import was cancelled");
      failureStage = "confirm";
      await confirmArtifactUpload({ data: { id: started.artifact.id } });
      confirmed = true;
      failureStage = "preview";
      const parsed = await previewBankCsv({
        data: { artifactId: started.artifact.id },
      });
      if (cancellationRequested.current.has(id))
        throw new Error("The import was cancelled");
      updateItem(id, (current) => ({
        ...current,
        preview: parsed,
        decision: "pending",
        stage: "review",
        message: parsed.errors.length
          ? "Choose whether to add this preview to the batch or reject it. Files with errors cannot be imported."
          : `Review all ${parsed.rows.length} rows, then add this file to the batch or reject it.`,
      }));
      void checkDuplicateWarnings(id, started.artifact.id);
    } catch {
      if (confirmed && pendingArtifactId) {
        updateItem(id, (current) => ({
          ...current,
          stage: "preview_failed",
          message:
            "The validated CSV is retained for review. Retry loading its preview.",
          errorMessage: "Preview could not be loaded.",
        }));
        return;
      }
      if (failureStage === "confirm" && pendingArtifactId) {
        updateItem(id, (current) => ({
          ...current,
          stage: "confirm_failed",
          message:
            "Upload confirmation is uncertain. Retry confirmation for this artifact; do not upload it again.",
          errorMessage: "Confirmation could not be verified.",
        }));
        return;
      }
      const cleanup = await abandonFailedBankUpload(
        pendingArtifactId,
        async (artifactId) => cancelBankImport({ data: { artifactId } }),
      );
      const message = cancellationRequested.current.has(id)
        ? cleanup === "abandon_failed"
          ? bankCancelFailureMessage("")
          : "Import cancelled. No bank rows were created."
        : bankUploadFailureMessage(failureStage, cleanup);
      updateItem(id, (current) => ({
        ...current,
        artifactId: cleanup === "abandon_failed" ? pendingArtifactId : null,
        preview: null,
        stage: "choose",
        message,
        errorMessage: cancellationRequested.current.has(id)
          ? cleanup === "abandon_failed"
            ? message
            : null
          : message,
      }));
    } finally {
      abortControllers.current.delete(id);
      cancellationRequested.current.delete(id);
    }
  };

  const resumeReview = async (item: BankImportQueueItem) => {
    if (!item.artifactId) return;
    const mustConfirm = item.stage === "confirm_failed";
    try {
      if (mustConfirm)
        await confirmArtifactUpload({ data: { id: item.artifactId } });
      const parsed = await previewBankCsv({
        data: { artifactId: item.artifactId },
      });
      updateItem(item.id, (current) => ({
        ...current,
        preview: parsed,
        decision: "pending",
        stage: "review",
        message: parsed.errors.length
          ? "Review the errors, then add this file to the batch or reject it."
          : `Review all ${parsed.rows.length} rows, then add this file to the batch or reject it.`,
        errorMessage: null,
      }));
      void checkDuplicateWarnings(item.id, item.artifactId);
    } catch {
      updateItem(item.id, (current) => ({
        ...current,
        stage: mustConfirm ? "confirm_failed" : "preview_failed",
        message: mustConfirm
          ? "Confirmation could not be verified. Retry the same artifact."
          : "Preview could not be loaded. Retry the saved artifact.",
        errorMessage: "Review could not continue.",
      }));
    }
  };

  const addToBatch = (item: BankImportQueueItem) => {
    if (
      !item.artifactId ||
      !item.preview ||
      item.stage !== "review" ||
      item.decision !== "pending"
    )
      return;
    updateItem(item.id, (current) => ({
      ...current,
      decision: "accepted",
      errorMessage: null,
      message:
        "Added to the batch. It will import only after batch confirmation.",
    }));
  };

  const reject = async (item: BankImportQueueItem) => {
    if (
      !item.artifactId ||
      !item.preview ||
      item.stage === "uploading" ||
      item.stage === "rejecting" ||
      item.stage === "confirming" ||
      item.confirmationStatus === "failed" ||
      item.confirmationStatus === "imported" ||
      item.confirmationStatus === "already_imported" ||
      item.decision === "rejected"
    )
      return;

    updateItem(item.id, (current) => ({
      ...current,
      stage: "rejecting",
      errorMessage: null,
      message: "Rejecting this uploaded CSV…",
    }));
    try {
      await rejectArtifact({ data: { id: item.artifactId } });
      updateItem(item.id, (current) => ({
        ...current,
        decision: "rejected",
        confirmationStatus: null,
        stage: "review",
        message: "This uploaded CSV was rejected and will not be imported.",
        errorMessage: null,
      }));
    } catch {
      updateItem(item.id, (current) => ({
        ...current,
        stage: "review",
        message:
          "The CSV could not be rejected. Retry Reject file to try again.",
        errorMessage: "Rejection failed; this file remains outside the batch.",
      }));
    }
  };

  const removeFromBatch = (item: BankImportQueueItem) => {
    if (
      item.decision !== "accepted" ||
      item.confirmationStatus === "failed" ||
      item.confirmationStatus === "imported" ||
      item.confirmationStatus === "already_imported"
    )
      return;
    updateItem(item.id, (current) => ({
      ...current,
      decision: "pending",
      confirmationStatus: null,
      stage: "review",
      message: "Removed from the batch. Choose Add to batch or Reject file.",
    }));
    setView("files");
    setActiveId(item.id);
  };

  const confirmBatch = async () => {
    if (confirmingBatch.current) return;
    const candidates = bankImportConfirmationCandidates(
      queueRef.current,
      false,
    );
    if (!candidates.length) return;
    confirmingBatch.current = true;
    setBatchConfirming(true);
    setBatchMessage("");
    for (const candidate of candidates) {
      const current = queueRef.current.find((item) => item.id === candidate.id);
      if (!current?.artifactId || !current.preview) continue;
      updateItem(current.id, (item) => ({
        ...item,
        stage: "confirming",
        confirmationStatus: null,
        message:
          "Revalidating the pinned source object and importing atomically…",
        errorMessage: null,
      }));
      try {
        const result = await confirmBankImport({
          data: {
            artifactId: current.artifactId,
            acknowledgedOverlapFingerprint:
              current.overlapWarning?.overlapFingerprint ===
              current.acknowledgedOverlapFingerprint
                ? current.acknowledgedOverlapFingerprint
                : null,
          },
        });
        if (result.status === "overlap_acknowledgement_required") {
          updateItem(current.id, (item) => ({
            ...item,
            overlapWarning: {
              overlapFingerprint: result.overlapFingerprint,
              overlaps: result.overlaps,
            },
            overlapFingerprint: result.overlapFingerprint,
            acknowledgedOverlapFingerprint: null,
            confirmationStatus: "overlap",
            stage: "review",
            message: `This file overlaps ${result.overlaps
              .map(
                (overlap) =>
                  `${overlap.filename} (${overlap.overlapStart} to ${overlap.overlapEnd})`,
              )
              .join(
                ", ",
              )}. Review and acknowledge the overlap before importing this file.`,
          }));
          continue;
        }
        if (result.status === "invalid") {
          updateItem(current.id, (item) => ({
            ...item,
            stage: "review",
            preview: item.preview
              ? { ...item.preview, errors: result.errors }
              : item.preview,
            overlapWarning: null,
            overlapFingerprint: null,
            acknowledgedOverlapFingerprint: null,
            confirmationStatus: "invalid",
            message:
              "The pinned CSV failed server-side validation and was not imported.",
          }));
          continue;
        }
        updateItem(current.id, (item) => ({
          ...item,
          completedArtifactId: result.artifactId,
          stage: "complete",
          confirmationStatus: result.status,
          message:
            result.status === "already_imported"
              ? `This source was already imported as ${result.artifactId}.`
              : `Imported ${result.rowCount} bank rows.`,
        }));
      } catch {
        updateItem(current.id, (item) => ({
          ...item,
          stage: "review",
          confirmationStatus: "failed",
          message:
            "The confirmation response was unavailable. Retry this file to check its idempotent result.",
          errorMessage:
            "The import result is unknown; retry will check this file only.",
        }));
      }
    }
    confirmingBatch.current = false;
    setBatchConfirming(false);
    setBatchMessage(
      "Batch confirmation finished. Review each file’s result; completed imports are excluded from retry.",
    );
  };

  const cancelPendingUpload = async (item: BankImportQueueItem) => {
    const id = item.id;
    if (item.stage === "uploading") {
      if (cancellationRequested.current.has(id)) return;
      cancellationRequested.current.add(id);
      abortControllers.current.get(id)?.abort();
      updateItem(id, (current) => ({
        ...current,
        message: "Cancelling the upload and cleaning up its pending artifact…",
      }));
      return;
    }
    if (item.artifactId && item.stage === "choose") {
      try {
        await cancelBankImport({ data: { artifactId: item.artifactId } });
      } catch {
        updateItem(id, (current) => ({
          ...current,
          message: bankCancelFailureMessage(current.message),
          errorMessage: bankCancelFailureMessage(current.message),
        }));
        return;
      }
    }
    updateItem(id, (current) => ({
      ...current,
      artifactId: null,
      completedArtifactId: null,
      preview: null,
      stage: "choose",
      message: "Import cancelled. No bank rows were created.",
      errorMessage: null,
      overlapWarning: null,
      overlapFingerprint: null,
      acknowledgedOverlapFingerprint: null,
    }));
  };

  const PageElement = embedded ? "div" : "main";

  return (
    <PageElement
      className={
        embedded ? "banking-page banking-import-embedded" : "banking-page"
      }
    >
      {!embedded && (
        <>
          <header className="banking-header">
            <p className="eyebrow">Banking</p>
            <h1>Banking</h1>
            <p className="banking-lead">
              Upload CommBank transaction history CSVs, choose which previews
              join a batch, and confirm all accepted files together.
            </p>
          </header>

          <nav className="banking-tabs" aria-label="Banking sections">
            <a href="/banking/activity">Activity</a>
            <a href="/banking/reconcile">Reconcile</a>
            <a href="/banking/imports" aria-current="location">
              Imports
            </a>
          </nav>

          <SourceTabs active="commbank" />
        </>
      )}

      <section className="banking-panel banking-import-panel">
        <div className="banking-panel-heading">
          <div>
            <p className="banking-kicker">New source</p>
            <h2>Import CommBank CSVs</h2>
            <p className="banking-muted">
              Each bank statement row remains source activity. It does not
              become a Folio transaction unless you explicitly create or match
              one.
            </p>
          </div>
        </div>

        <section
          className="banking-import-queue"
          aria-labelledby="queue-heading"
        >
          <div className="banking-panel-heading">
            <div>
              <h3 id="queue-heading">File queue</h3>
              <p className="banking-muted">
                Upload each headerless CommBank export, inspect its preview, and
                choose Add to batch or Reject file. No bank rows are written
                before batch confirmation.
              </p>
            </div>
            <label className="banking-file-field">
              CSV files
              <input
                type="file"
                accept="text/csv,.csv"
                multiple
                disabled={checkingFiles || batchConfirming}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void addFiles(files);
                }}
              />
              <span className="banking-field-help">
                Four-column, headerless CommBank transaction history CSVs.
              </span>
            </label>
          </div>
          {queueMessage && (
            <p
              className="workflow-status banking-workflow-status"
              role="status"
            >
              {queueMessage}
            </p>
          )}
          {queue.length ? (
            <ul className="banking-import-queue-list" aria-label="Queued files">
              {queue.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="banking-import-queue-item"
                    aria-pressed={activeId === item.id}
                    onClick={() => {
                      setActiveId(item.id);
                      setView("files");
                    }}
                  >
                    <span className="banking-import-queue-file">
                      <strong>{item.filename}</strong>
                      {item.preview && (
                        <small>
                          {item.preview.rows.length} valid rows ·{" "}
                          {item.preview.errors.length} errors
                        </small>
                      )}
                      {item.errorMessage && (
                        <small className="banking-import-queue-error">
                          {item.errorMessage}
                        </small>
                      )}
                      {item.filenameMatchCount === null &&
                        !item.filenameMatchCheckFailed && (
                          <small
                            className="artifact-filename-match-warning"
                            role="status"
                          >
                            Checking for an existing filename…
                          </small>
                        )}
                      {item.filenameMatchCount !== null &&
                        item.filenameMatchCount > 0 && (
                          <small
                            className="artifact-filename-match-warning"
                            role="status"
                          >
                            {item.filenameMatchCount} existing artifact
                            {item.filenameMatchCount === 1 ? "" : "s"} match
                            this filename.
                          </small>
                        )}
                      {item.filenameMatchCheckFailed && (
                        <small
                          className="artifact-filename-match-warning"
                          role="status"
                        >
                          Could not check this filename; upload remains
                          possible.
                        </small>
                      )}
                    </span>
                    <span
                      className={
                        item.errorMessage
                          ? "banking-import-queue-status is-error"
                          : "banking-import-queue-status"
                      }
                    >
                      {bankImportQueueStatus(item)}
                    </span>
                  </button>
                  <CsvDuplicateWarnings report={item.duplicateWarnings} />
                  {item.duplicateWarningCheckFailed && (
                    <p className="artifact-duplicate-warning" role="status">
                      Could not check duplicate CSV content; review remains
                      possible.
                    </p>
                  )}
                  {item.decision === "rejected" && (
                    <a
                      className="banking-import-rejected-link"
                      href="/imports/library?state=rejected"
                    >
                      View rejected artifact
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="banking-import-queue-empty">
              No files queued. Select one or more CSVs to begin.
            </p>
          )}
          {savedQueueOffset < savedQueueTotal && (
            <button
              type="button"
              className="secondary"
              disabled={loadingSavedQueue || batchConfirming}
              onClick={() => void loadSavedQueue(savedQueueOffset)}
            >
              {loadingSavedQueue
                ? "Loading saved files…"
                : "Load more saved files"}
            </button>
          )}
          {acceptedItems.length > 0 && (
            <div className="actions banking-action-row banking-import-queue-actions">
              <button
                type="button"
                disabled={
                  pendingPreviewCount > 0 ||
                  hasActiveUpload ||
                  checkingFiles ||
                  batchConfirming
                }
                onClick={() => setView("batch")}
              >
                Review batch ({acceptedItems.length}{" "}
                {acceptedItems.length === 1 ? "file" : "files"})
              </button>
              {(pendingPreviewCount > 0 || hasActiveUpload) && (
                <p className="banking-muted" role="status">
                  Decide Add to batch or Reject file for each completed preview
                  before reviewing the batch.
                </p>
              )}
            </div>
          )}
        </section>

        {view === "files" && activeItem ? (
          <section
            className="banking-import-stage"
            aria-labelledby="file-stage-heading"
          >
            {activeItem.message && (
              <p
                className="workflow-status banking-workflow-status"
                role="status"
              >
                {activeItem.message}
              </p>
            )}
            {(activeItem.stage === "choose" ||
              activeItem.stage === "uploading") && (
              <>
                <h3 id="file-stage-heading">Upload selected file</h3>
                <p className="banking-selected-file">
                  Selected: <strong>{activeItem.filename}</strong>
                </p>
                {activeItem.stage === "uploading" && (
                  <p className="banking-import-progress" role="status">
                    Uploading and preparing this file’s row preview…
                  </p>
                )}
                <div className="actions banking-action-row">
                  <button
                    type="button"
                    disabled={
                      activeItem.stage === "uploading" ||
                      Boolean(activeItem.artifactId) ||
                      batchConfirming
                    }
                    onClick={() => void upload(activeItem.id)}
                  >
                    {activeItem.errorMessage
                      ? "Retry upload and preview"
                      : "Upload and preview"}
                  </button>
                  {activeItem.stage === "choose" && activeItem.artifactId && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void cancelPendingUpload(activeItem)}
                    >
                      Cancel pending upload
                    </button>
                  )}
                  {activeItem.stage === "uploading" && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={cancellationRequested.current.has(
                        activeItem.id,
                      )}
                      onClick={() => void cancelPendingUpload(activeItem)}
                    >
                      Cancel upload
                    </button>
                  )}
                </div>
              </>
            )}

            {(activeItem.stage === "confirm_failed" ||
              activeItem.stage === "preview_failed") && (
              <>
                <h3 id="file-stage-heading">Continue file review</h3>
                <p className="banking-selected-file">
                  Saved file: <strong>{activeItem.filename}</strong>
                </p>
                <p className="banking-muted">{activeItem.message}</p>
                <button
                  type="button"
                  disabled={batchConfirming}
                  onClick={() => void resumeReview(activeItem)}
                >
                  {activeItem.stage === "confirm_failed"
                    ? "Retry upload confirmation"
                    : "Load saved preview"}
                </button>
              </>
            )}

            {activeItem.stage === "review" &&
              activeItem.decision === "pending" &&
              activeItem.preview && (
                <>
                  <div className="banking-panel-heading">
                    <div>
                      <h3 id="file-stage-heading">Review source rows</h3>
                      <p className="banking-muted">
                        Source running balance values are preserved as file
                        details and are not Folio-calculated balances.
                      </p>
                    </div>
                    <BankPreviewCounts item={activeItem} />
                  </div>
                  <BankPreviewDetails item={activeItem} />
                  {activeItem.preview.errors.length > 0 && (
                    <p className="banking-import-warning" role="status">
                      This file can be added for review, but preview errors
                      prevent its import. Reject it if it should not be retained
                      in the batch.
                    </p>
                  )}
                  <div className="actions banking-action-row">
                    <button
                      type="button"
                      disabled={batchConfirming || hasActiveUpload}
                      onClick={() => addToBatch(activeItem)}
                    >
                      Add to batch
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={batchConfirming || hasActiveUpload}
                      onClick={() => void reject(activeItem)}
                    >
                      Reject file
                    </button>
                  </div>
                </>
              )}

            {activeItem.stage === "review" &&
              activeItem.decision === "accepted" && (
                <div className="banking-import-result" role="status">
                  <p className="banking-kicker">Added to batch</p>
                  <h3 id="file-stage-heading">Awaiting batch confirmation</h3>
                  <p>
                    This file remains unimported until you confirm the combined
                    batch.
                  </p>
                  <div className="actions banking-action-row">
                    <button type="button" onClick={() => setView("batch")}>
                      Review batch
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        batchConfirming ||
                        activeItem.confirmationStatus === "failed"
                      }
                      onClick={() => removeFromBatch(activeItem)}
                    >
                      Remove from batch
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        batchConfirming ||
                        activeItem.confirmationStatus === "failed"
                      }
                      onClick={() => void reject(activeItem)}
                    >
                      Reject file
                    </button>
                  </div>
                </div>
              )}

            {activeItem.decision === "rejected" && (
              <div className="banking-import-result" role="status">
                <p className="banking-kicker">Rejected</p>
                <h3 id="file-stage-heading">File excluded from import</h3>
              </div>
            )}

            {activeItem.stage === "rejecting" && (
              <p className="banking-import-progress" role="status">
                Rejecting this uploaded CSV…
              </p>
            )}

            {activeItem.stage === "complete" && (
              <section
                className="banking-import-result"
                aria-labelledby="import-result-heading"
              >
                <p className="banking-kicker">Import result</p>
                <h3 id="import-result-heading">{activeItem.filename}</h3>
                <p>{activeItem.message}</p>
                <div className="actions banking-action-row">
                  <a
                    className="banking-button-link"
                    href={
                      activeItem.completedArtifactId
                        ? `/banking/reconcile?artifact=${encodeURIComponent(activeItem.completedArtifactId)}&window=14`
                        : "/banking/reconcile"
                    }
                  >
                    Go to Banking Reconcile
                  </a>
                  <a
                    className="banking-button-link banking-button-secondary"
                    href="/banking/imports"
                  >
                    View import history
                  </a>
                </div>
              </section>
            )}
          </section>
        ) : null}

        {view === "batch" && (
          <section
            className="banking-import-stage banking-import-batch"
            aria-labelledby="batch-review-heading"
          >
            <div className="banking-panel-heading banking-import-batch-heading">
              <div>
                <p className="banking-kicker">Batch review</p>
                <h3 id="batch-review-heading">Review accepted files</h3>
                <p className="banking-muted">
                  Confirming imports each eligible file sequentially. Each
                  file’s rows are committed atomically; a failure does not retry
                  files already reported as imported.
                </p>
              </div>
              <div className="banking-preview-counts" aria-label="Batch counts">
                <p className="banking-row-count">
                  <strong>{acceptedItems.length}</strong>{" "}
                  {acceptedItems.length === 1 ? "file" : "files"}
                </p>
                <p className="banking-row-count">
                  <strong>{acceptedRowCount}</strong> valid{" "}
                  {acceptedRowCount === 1 ? "row" : "rows"}
                </p>
                <p className="banking-row-count banking-error-count">
                  <strong>{acceptedErrorCount}</strong>{" "}
                  {acceptedErrorCount === 1 ? "error" : "errors"}
                </p>
              </div>
            </div>
            {batchMessage && (
              <p
                className="workflow-status banking-workflow-status"
                role="status"
              >
                {batchMessage}
              </p>
            )}
            {pendingPreviewCount > 0 && (
              <p className="banking-import-warning" role="alert">
                {pendingPreviewCount} previewed file
                {pendingPreviewCount === 1 ? " is" : "s are"} awaiting Add to
                batch or Reject file. Return to the file queue before
                confirming.
              </p>
            )}
            {acceptedItems.length ? (
              <div className="banking-import-batch-list">
                {acceptedItems.map((item) => (
                  <article
                    className="banking-import-batch-file"
                    key={item.id}
                    aria-labelledby={`batch-file-${item.id}`}
                  >
                    <div className="banking-import-batch-file-heading">
                      <div>
                        <h4 id={`batch-file-${item.id}`}>{item.filename}</h4>
                        <p
                          className="banking-import-batch-status"
                          role="status"
                        >
                          {item.message || bankImportQueueStatus(item)}
                        </p>
                      </div>
                      <BankPreviewCounts item={item} />
                    </div>
                    {item.overlapWarning &&
                    item.overlapWarning.overlaps.length > 0 ? (
                      <div
                        className="form-error-summary banking-overlap-summary"
                        role="status"
                      >
                        <strong>
                          Date-range overlap requires acknowledgement.
                        </strong>
                        <ul>
                          {item.overlapWarning.overlaps.map((overlap) => (
                            <li key={overlap.artifactId}>
                              {overlap.filename}: {overlap.overlapStart} to{" "}
                              {overlap.overlapEnd}
                            </li>
                          ))}
                        </ul>
                        <label className="acknowledgement">
                          <input
                            type="checkbox"
                            checked={
                              item.acknowledgedOverlapFingerprint ===
                              item.overlapWarning.overlapFingerprint
                            }
                            disabled={
                              batchConfirming ||
                              item.confirmationStatus === "imported" ||
                              item.confirmationStatus === "already_imported"
                            }
                            onChange={(event) =>
                              updateItem(item.id, (current) => ({
                                ...current,
                                acknowledgedOverlapFingerprint: event.target
                                  .checked
                                  ? (current.overlapWarning
                                      ?.overlapFingerprint ?? null)
                                  : null,
                              }))
                            }
                          />
                          I reviewed these overlaps and intend to import every
                          row from this file.
                        </label>
                      </div>
                    ) : (
                      <p className="banking-confirmation-note" role="status">
                        The server checks for date overlaps and revalidates the
                        pinned source when this batch is confirmed.
                      </p>
                    )}
                    {item.confirmationStatus === "failed" && (
                      <p className="banking-import-warning" role="alert">
                        The response was lost or unavailable. Retrying this file
                        checks its idempotent result; already confirmed files
                        are excluded.
                      </p>
                    )}
                    {item.preview && <BankPreviewDetails item={item} />}
                    <div className="actions banking-action-row banking-import-batch-actions">
                      {item.confirmationStatus !== "imported" &&
                        item.confirmationStatus !== "already_imported" && (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              disabled={
                                batchConfirming ||
                                item.confirmationStatus === "failed"
                              }
                              onClick={() => removeFromBatch(item)}
                            >
                              Remove from batch
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              disabled={
                                batchConfirming ||
                                item.confirmationStatus === "failed"
                              }
                              onClick={() => void reject(item)}
                            >
                              Reject file
                            </button>
                          </>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="banking-import-queue-empty">
                No files have been added to this batch.
              </p>
            )}
            {acceptedErrorCount > 0 && (
              <p className="banking-import-warning" role="status">
                Files with preview errors are excluded from confirmation. Remove
                them from the batch or reject them; valid files can still be
                imported independently.
              </p>
            )}
            <div className="actions banking-action-row">
              <button
                type="button"
                className="secondary"
                disabled={batchConfirming}
                onClick={() => setView("files")}
              >
                Back to file queue
              </button>
              <button
                type="button"
                disabled={
                  batchConfirming ||
                  pendingPreviewCount > 0 ||
                  confirmationCandidates.length === 0
                }
                onClick={() => void confirmBatch()}
              >
                Confirm import
              </button>
            </div>
          </section>
        )}
      </section>
    </PageElement>
  );
}
