import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { sha256Base64 } from "../browser/crypto";
import { useContextPane, usePaneGuard } from "../components/context-pane";
import {
  applyFileFilenameSuggestions,
  parseCsvFilename,
  parseFileFilename,
  type FileMetadataValues,
} from "../domain/file-filename";
import {
  confirmArtifactUpload,
  startArtifactUpload,
} from "../server/operations";

type UploadSession =
  | {
      readonly authenticated: true;
      readonly user: { readonly id: string };
    }
  | { readonly authenticated: false };

export const fileUploadProfiles = [
  {
    profile: "manual_invoice_pdf_v1",
    label: "Invoice PDF",
    description: "Invoice or evidence PDF",
    extension: "pdf",
    mediaType: "application/pdf",
    accept: ".pdf,application/pdf",
  },
  {
    profile: "stripe_balance_itemised_csv_v1",
    label: "Stripe CSV",
    description: "Stripe balance itemised CSV",
    extension: "csv",
    mediaType: "text/csv",
    accept: ".csv,text/csv",
  },
  {
    profile: "commbank_transaction_history_csv_v1",
    label: "CommBank CSV",
    description: "CommBank transaction history CSV",
    extension: "csv",
    mediaType: "text/csv",
    accept: ".csv,text/csv",
  },
] as const;

export type FileUploadProfile = (typeof fileUploadProfiles)[number]["profile"];

export const defaultFileUploadProfile: FileUploadProfile =
  "manual_invoice_pdf_v1";

export const isFileUploadProfile = (
  value: unknown,
): value is FileUploadProfile =>
  fileUploadProfiles.some((profile) => profile.profile === value);

export const fileUploadFilenameIssue = (
  filename: string,
  extension: string,
): string | null => {
  if (!filename.trim()) return "Enter a file name.";
  if (filename.length > 255)
    return "Use a file name no longer than 255 characters.";
  const hasControlCharacter = Array.from(filename).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
  if (filename.includes("/") || filename.includes("\\") || hasControlCharacter)
    return "File names cannot contain slashes or control characters.";

  const requiredExtension = `.${extension}`;
  if (!filename.toLowerCase().endsWith(requiredExtension))
    return `Keep the ${requiredExtension} extension in the file name.`;
  if (!filename.slice(0, -requiredExtension.length).trim())
    return "Enter a name before the file extension.";
  return null;
};

export const fileUploadPeriodIssue = (
  periodStart: string,
  periodEnd: string,
): string | null =>
  periodStart && periodEnd && periodStart > periodEnd
    ? "Coverage start must be on or before coverage end."
    : null;

export const hasPdfHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

interface UploadAttempt {
  readonly artifactId: string;
  readonly uploadUrl: string;
  readonly uploadHeaders: Readonly<Record<string, string>>;
}

type UploadStatus =
  | "idle"
  | "preparing"
  | "uploading"
  | "confirming"
  | "failed"
  | "complete";

const putFileWithProgress = (
  uploadUrl: string,
  file: File,
  uploadHeaders: Readonly<Record<string, string>>,
  onProgress: (progress: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    for (const [name, value] of Object.entries(uploadHeaders))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (
        (request.status >= 200 && request.status < 300) ||
        request.status === 412
      ) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error("The file upload failed."));
    };
    request.onerror = () =>
      reject(
        new Error("The file upload failed. Check the connection and retry."),
      );
    request.onabort = () =>
      reject(new Error("The file upload was interrupted."));
    request.send(file);
  });

const profileFor = (profile: FileUploadProfile) =>
  fileUploadProfiles.find((candidate) => candidate.profile === profile)!;

export interface FileUploadPageProps {
  readonly session: UploadSession;
  readonly initialProfile?: FileUploadProfile;
  readonly navigateToArtifact?: (artifactId: string) => void;
  readonly embedded?: boolean;
  readonly invoiceOnly?: boolean;
  readonly onFileChange?: (file: File | null) => void;
  readonly onBusyChange?: (busy: boolean) => void;
}

export const FileUploadPage = ({
  session,
  initialProfile = defaultFileUploadProfile,
  navigateToArtifact,
  embedded = false,
  invoiceOnly = false,
  onFileChange,
  onBusyChange,
}: FileUploadPageProps) => {
  const pane = useContextPane();
  const effectiveInitialProfile = invoiceOnly
    ? defaultFileUploadProfile
    : isFileUploadProfile(initialProfile)
      ? initialProfile
      : defaultFileUploadProfile;
  const [profile, setProfile] = useState(effectiveInitialProfile);
  const [file, setFile] = useState<File | null>(null);
  const [selectedFileProfile, setSelectedFileProfile] =
    useState<FileUploadProfile | null>(null);
  const [filename, setFilename] = useState("");
  const [supplier, setSupplier] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [filenameSuggestionMessage, setFilenameSuggestionMessage] =
    useState("");
  const [attempt, setAttempt] = useState<UploadAttempt | null>(null);
  const [previousPendingArtifactIds, setPreviousPendingArtifactIds] = useState<
    string[]
  >([]);
  const [confirmationFailed, setConfirmationFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  const inFlight = useRef(false);
  const lastInitialProfile = useRef(effectiveInitialProfile);
  const effectiveProfile = invoiceOnly ? defaultFileUploadProfile : profile;
  const currentProfile = profileFor(effectiveProfile);
  const isCsvProfile = effectiveProfile !== defaultFileUploadProfile;
  const parsedCsvFilename =
    !invoiceOnly && file ? parseCsvFilename(file.name) : null;
  const csvProfileMismatch =
    parsedCsvFilename && parsedCsvFilename.profile !== effectiveProfile;
  const legacyCsvFilenameSuggestions =
    file &&
    isCsvProfile &&
    selectedFileProfile === effectiveProfile &&
    file.name.toLowerCase().endsWith(".csv") &&
    !parsedCsvFilename
      ? parseFileFilename(file.name)
      : null;
  const fileInputAccept = invoiceOnly
    ? currentProfile.accept
    : [
        ...new Set(
          fileUploadProfiles.flatMap((uploadProfile) =>
            uploadProfile.accept.split(","),
          ),
        ),
      ].join(",");
  const parsedFilenameSuggestions =
    file &&
    selectedFileProfile === effectiveProfile &&
    file.name.toLowerCase().endsWith(`.${currentProfile.extension}`) &&
    !isCsvProfile
      ? parseFileFilename(file.name)
      : null;
  const invoiceFilenameSuggestions = parsedFilenameSuggestions
    ? { ...parsedFilenameSuggestions, periodStart: null, periodEnd: null }
    : null;
  const csvFilenameSuggestions =
    isCsvProfile && selectedFileProfile === effectiveProfile
      ? parsedCsvFilename?.profile === effectiveProfile
        ? {
            supplier: null,
            documentDate: null,
            reference: null,
            periodStart: parsedCsvFilename.periodStart,
            periodEnd: parsedCsvFilename.periodEnd,
          }
        : !parsedCsvFilename &&
            legacyCsvFilenameSuggestions?.periodStart &&
            legacyCsvFilenameSuggestions.periodEnd
          ? {
              supplier: null,
              documentDate: null,
              reference: null,
              periodStart: legacyCsvFilenameSuggestions.periodStart,
              periodEnd: legacyCsvFilenameSuggestions.periodEnd,
            }
          : null
      : null;
  const filenameSuggestions =
    invoiceFilenameSuggestions &&
    (invoiceFilenameSuggestions.supplier ||
      invoiceFilenameSuggestions.documentDate ||
      invoiceFilenameSuggestions.reference)
      ? invoiceFilenameSuggestions
      : csvFilenameSuggestions;
  const locked = attempt !== null;
  const busy =
    status === "preparing" || status === "uploading" || status === "confirming";
  usePaneGuard({
    dirty:
      status !== "complete" &&
      Boolean(
        file ||
        attempt ||
        filename ||
        supplier ||
        periodStart ||
        periodEnd ||
        documentDate ||
        reference ||
        notes,
      ),
    pending: busy,
  });

  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => {
      if (busy) onBusyChangeRef.current?.(false);
    };
  }, [busy]);

  useEffect(() => {
    if (lastInitialProfile.current === effectiveInitialProfile) return;
    lastInitialProfile.current = effectiveInitialProfile;
    if (file || attempt || busy) return;
    setProfile(effectiveInitialProfile);
  }, [attempt, busy, effectiveInitialProfile, file]);

  const clearValidationMessage = () => {
    setMessage("");
    if (status === "failed" && !attempt) setStatus("idle");
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length > 1) {
      setFile(null);
      onFileChange?.(null);
      setSelectedFileProfile(null);
      setFilename("");
      setFilenameSuggestionMessage("");
      setStatus("failed");
      setMessage("Choose one file at a time.");
      event.currentTarget.value = "";
      return;
    }
    const selectedFile = files[0] ?? null;
    setFile(selectedFile);
    onFileChange?.(selectedFile);
    setSelectedFileProfile(selectedFile ? effectiveProfile : null);
    setFilename(selectedFile?.name ?? "");
    setFilenameSuggestionMessage("");
    setMessage("");
    setProgress(0);
    setStatus("idle");
  };

  const chooseCsvProfileFromFilename = () => {
    if (!parsedCsvFilename || invoiceOnly || busy || locked) return;
    setProfile(parsedCsvFilename.profile);
    setSelectedFileProfile(parsedCsvFilename.profile);
    setFilenameSuggestionMessage("");
    clearValidationMessage();
  };

  const navigateToFile = (artifactId: string) => {
    pane?.clearGuard();
    if (navigateToArtifact) {
      navigateToArtifact(artifactId);
      return;
    }
    if (embedded) return;
    window.location.assign(`/imports/files/${encodeURIComponent(artifactId)}`);
  };

  const startSeparateUpload = () => {
    if (!attempt || confirmationFailed || inFlight.current) return;
    setPreviousPendingArtifactIds((current) => [
      ...current,
      attempt.artifactId,
    ]);
    setAttempt(null);
    setFile(null);
    onFileChange?.(null);
    setSelectedFileProfile(null);
    setFilename("");
    setFilenameSuggestionMessage("");
    if (fileInput.current) fileInput.current.value = "";
    setProgress(0);
    setStatus("idle");
    setMessage(
      "The earlier file remains in the library. Choose a file again to start a new upload.",
    );
  };

  const retryConfirmation = async () => {
    if (!attempt || !confirmationFailed || inFlight.current) return;
    inFlight.current = true;
    setStatus("confirming");
    setMessage("Retrying confirmation for the same uploaded file…");
    try {
      await confirmArtifactUpload({ data: { id: attempt.artifactId } });
      setConfirmationFailed(false);
      setStatus("complete");
      setMessage("Upload confirmed. Opening file details…");
      navigateToFile(attempt.artifactId);
    } catch {
      setStatus("failed");
      setMessage(
        "Confirmation is still uncertain. Retry confirmation for this same file; it will not be uploaded again.",
      );
    } finally {
      inFlight.current = false;
    }
  };

  const applyFilenameSuggestions = () => {
    if (!filenameSuggestions) return;

    const application = applyFileFilenameSuggestions(
      {
        supplier,
        documentDate,
        reference,
        periodStart,
        periodEnd,
      },
      filenameSuggestions,
    );
    setSupplier(application.values.supplier);
    setDocumentDate(application.values.documentDate);
    setReference(application.values.reference);
    setPeriodStart(application.values.periodStart);
    setPeriodEnd(application.values.periodEnd);
    setFilenameSuggestionMessage(
      application.conflicts.includes("periodStart")
        ? "The suggested coverage start was left blank because it falls after the existing end date."
        : application.conflicts.includes("periodEnd")
          ? "The suggested coverage end was left blank because it falls before the existing start date."
          : "Filename suggestions were applied to empty metadata fields.",
    );
    clearValidationMessage();
  };

  const applyPdfFilenameSuggestion = (
    targetField: Extract<
      keyof FileMetadataValues,
      "supplier" | "documentDate" | "reference"
    >,
  ) => {
    if (!filenameSuggestions) return;
    if (
      targetField === "supplier" &&
      !supplier.trim() &&
      filenameSuggestions.supplier &&
      filenameSuggestions.supplier.length > 200
    ) {
      setFilenameSuggestionMessage(
        "The suggested supplier exceeds the 200 character limit; enter a shorter supplier name.",
      );
      return;
    }

    const application = applyFileFilenameSuggestions(
      { supplier, documentDate, reference, periodStart, periodEnd },
      filenameSuggestions,
      targetField,
    );
    setSupplier(application.values.supplier);
    setDocumentDate(application.values.documentDate);
    setReference(application.values.reference);
    setPeriodStart(application.values.periodStart);
    setPeriodEnd(application.values.periodEnd);
    const fieldLabel =
      targetField === "supplier"
        ? "Supplier"
        : targetField === "documentDate"
          ? "Document date"
          : "Reference";
    setFilenameSuggestionMessage(
      application.filled.includes(targetField)
        ? `${fieldLabel} suggestion was applied to file metadata.`
        : `${fieldLabel} already has a value; no changes were made.`,
    );
    clearValidationMessage();
  };

  const uploadFile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || !session.authenticated || confirmationFailed)
      return;

    if (!file) {
      setStatus("failed");
      setMessage("Choose one file to upload.");
      return;
    }
    if (file.size <= 0) {
      setStatus("failed");
      setMessage("The selected file is empty.");
      return;
    }
    const originalNameIssue = fileUploadFilenameIssue(
      file.name,
      currentProfile.extension,
    );
    if (originalNameIssue) {
      setStatus("failed");
      setMessage(`The selected file name is invalid. ${originalNameIssue}`);
      return;
    }
    const chosenNameIssue = fileUploadFilenameIssue(
      filename,
      currentProfile.extension,
    );
    if (chosenNameIssue) {
      setStatus("failed");
      setMessage(chosenNameIssue);
      return;
    }
    const periodIssue = isCsvProfile
      ? fileUploadPeriodIssue(periodStart, periodEnd)
      : null;
    if (periodIssue) {
      setStatus("failed");
      setMessage(periodIssue);
      return;
    }

    inFlight.current = true;
    setStatus(attempt ? "uploading" : "preparing");
    setProgress(attempt ? progress : 0);
    setMessage(
      attempt
        ? "Retrying the upload for the same file…"
        : "Checking the file and preparing the upload…",
    );
    let stage: "prepare" | "start" | "upload" | "confirm" = "prepare";

    try {
      let activeAttempt = attempt;
      if (!activeAttempt) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (
          effectiveProfile === "manual_invoice_pdf_v1" &&
          !hasPdfHeader(bytes)
        )
          throw new Error("The selected file does not have a PDF header.");
        const checksumSha256 = await sha256Base64(bytes);
        stage = "start";
        const started = await startArtifactUpload({
          data: {
            ownerId: null,
            artifactProfile: effectiveProfile,
            filename: filename.trim(),
            originalFilename: file.name,
            mediaType: currentProfile.mediaType,
            byteSize: file.size,
            checksumSha256,
            ...(isCsvProfile && periodStart ? { periodStart } : {}),
            ...(isCsvProfile && periodEnd ? { periodEnd } : {}),
            ...(effectiveProfile === "manual_invoice_pdf_v1" && supplier.trim()
              ? { supplier: supplier.trim() }
              : {}),
            ...(effectiveProfile === "manual_invoice_pdf_v1" && documentDate
              ? { documentDate }
              : {}),
            ...(effectiveProfile === "manual_invoice_pdf_v1" && reference.trim()
              ? { reference: reference.trim() }
              : {}),
            ...(notes.trim() ? { notes: notes.trim() } : {}),
          },
        });
        activeAttempt = {
          artifactId: started.artifact.id,
          uploadUrl: started.uploadUrl,
          uploadHeaders: started.uploadHeaders,
        };
        setAttempt(activeAttempt);
      }

      stage = "upload";
      setStatus("uploading");
      setMessage("Uploading the file…");
      await putFileWithProgress(
        activeAttempt.uploadUrl,
        file,
        activeAttempt.uploadHeaders,
        setProgress,
      );
      stage = "confirm";
      setStatus("confirming");
      setMessage("Confirming the uploaded file…");
      await confirmArtifactUpload({ data: { id: activeAttempt.artifactId } });
      setConfirmationFailed(false);
      setStatus("complete");
      setMessage("Upload confirmed. Opening file details…");
      navigateToFile(activeAttempt.artifactId);
    } catch {
      if (stage === "confirm") {
        setConfirmationFailed(true);
        setMessage(
          "Confirmation is uncertain. Retry confirmation for the same file; it will not be uploaded again.",
        );
      } else if (stage === "upload") {
        setMessage(
          "The upload did not finish. Retry to continue this same file upload.",
        );
      } else {
        setMessage(
          "The file could not be prepared for upload. Check the file and retry.",
        );
      }
      setStatus("failed");
    } finally {
      inFlight.current = false;
    }
  };

  const PageContainer = embedded ? "div" : "main";

  if (!session.authenticated)
    return (
      <PageContainer className="file-upload-page">
        <h2>Sign in required</h2>
        <p>Sign in to upload a file.</p>
        <a href="/auth/login?return_to=%2Fimports%2Fupload">Sign in</a>
      </PageContainer>
    );

  return (
    <PageContainer className="file-upload-page">
      <section
        className="file-upload-panel"
        aria-labelledby="file-upload-heading"
      >
        <div className="file-upload-panel__heading">
          <p className="file-upload-kicker">Source files</p>
          <h2 id="file-upload-heading">Upload one file</h2>
          <p>
            {invoiceOnly
              ? "Choose an invoice PDF."
              : "Choose an invoice PDF, Stripe balance CSV, or CommBank transaction history CSV."}
          </p>
        </div>

        <form className="file-upload-form" onSubmit={uploadFile}>
          {!invoiceOnly && (
            <>
              <label htmlFor="file-upload-profile">File profile</label>
              <select
                id="file-upload-profile"
                value={effectiveProfile}
                disabled={busy || locked}
                onChange={(event) => {
                  const nextProfile = event.currentTarget
                    .value as FileUploadProfile;
                  setProfile(nextProfile);
                  setSelectedFileProfile(file ? nextProfile : null);
                  setFilenameSuggestionMessage("");
                  clearValidationMessage();
                }}
              >
                {fileUploadProfiles.map((option) => (
                  <option key={option.profile} value={option.profile}>
                    {option.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <p className="file-upload-help">
            {csvProfileMismatch
              ? `The original filename suggests a ${parsedCsvFilename.provider} CSV export.`
              : `${currentProfile.description}.`}
          </p>

          <label htmlFor="file-upload-input">File</label>
          <input
            id="file-upload-input"
            ref={fileInput}
            type="file"
            accept={fileInputAccept}
            disabled={busy || locked}
            onChange={chooseFile}
          />

          {parsedCsvFilename && !invoiceOnly && (
            <div className="file-upload-filename-suggestions">
              <p className="file-upload-help">
                Original filename suggests a {parsedCsvFilename.provider} CSV
                export covering {parsedCsvFilename.periodStart} to{" "}
                {parsedCsvFilename.periodEnd}.
              </p>
              {parsedCsvFilename.profile !== effectiveProfile && (
                <button
                  type="button"
                  disabled={busy || locked}
                  onClick={chooseCsvProfileFromFilename}
                >
                  Use {parsedCsvFilename.provider} CSV profile
                </button>
              )}
            </div>
          )}

          <label htmlFor="file-upload-filename">Filename</label>
          <input
            id="file-upload-filename"
            type="text"
            autoComplete="off"
            maxLength={255}
            value={filename}
            disabled={busy || locked}
            onChange={(event) => {
              setFilename(event.currentTarget.value);
              clearValidationMessage();
            }}
          />
          <p className="file-upload-help">
            Used when viewing or downloading this file. The original upload name
            is kept separately.{" "}
            {csvProfileMismatch
              ? `Use the suggested ${parsedCsvFilename.provider} CSV profile to match the original file.`
              : `Keep the .${currentProfile.extension} extension.`}
          </p>

          <fieldset disabled={busy || locked}>
            <legend>File metadata</legend>
            <p className="file-upload-help">
              {isCsvProfile
                ? "Coverage dates describe the CSV export range. They do not change transaction dates."
                : "Supplier, document date, reference and notes describe this invoice PDF. They do not change transaction fields."}
            </p>
            {filenameSuggestions && (
              <div className="file-upload-filename-suggestions">
                <p className="file-upload-help">
                  Filename suggestions from the original upload name:
                </p>
                <ul>
                  {effectiveProfile === "manual_invoice_pdf_v1" &&
                    filenameSuggestions.supplier && (
                      <li>Supplier: {filenameSuggestions.supplier}</li>
                    )}
                  {isCsvProfile && parsedCsvFilename && (
                    <li>Provider: {parsedCsvFilename.provider}</li>
                  )}
                  {filenameSuggestions.documentDate && (
                    <li>Document date: {filenameSuggestions.documentDate}</li>
                  )}
                  {filenameSuggestions.reference && (
                    <li>Reference: {filenameSuggestions.reference}</li>
                  )}
                  {isCsvProfile &&
                    filenameSuggestions.periodStart &&
                    filenameSuggestions.periodEnd && (
                      <li>
                        Coverage: {filenameSuggestions.periodStart} to{" "}
                        {filenameSuggestions.periodEnd}
                      </li>
                    )}
                </ul>
                <div
                  className="file-upload-filename-suggestion-actions"
                  role="group"
                  aria-label="Filename suggestion actions"
                >
                  {isCsvProfile ? (
                    <button type="button" onClick={applyFilenameSuggestions}>
                      Apply to file metadata
                    </button>
                  ) : (
                    <>
                      {filenameSuggestions.supplier && (
                        <button
                          type="button"
                          onClick={() => applyPdfFilenameSuggestion("supplier")}
                        >
                          Apply supplier to file metadata
                        </button>
                      )}
                      {filenameSuggestions.documentDate && (
                        <button
                          type="button"
                          onClick={() =>
                            applyPdfFilenameSuggestion("documentDate")
                          }
                        >
                          Apply document date to file metadata
                        </button>
                      )}
                      {filenameSuggestions.reference && (
                        <button
                          type="button"
                          onClick={() =>
                            applyPdfFilenameSuggestion("reference")
                          }
                        >
                          Apply reference to file metadata
                        </button>
                      )}
                    </>
                  )}
                </div>
                <p className="file-upload-help">
                  Each action fills only its blank file metadata field. Filename
                  hints never change transaction fields.
                </p>
              </div>
            )}
            {filenameSuggestionMessage && (
              <p className="file-upload-help" role="status" aria-live="polite">
                {filenameSuggestionMessage}
              </p>
            )}
            {isCsvProfile && (
              <div className="file-upload-date-grid">
                <label htmlFor="file-upload-period-start">Coverage start</label>
                <input
                  id="file-upload-period-start"
                  type="date"
                  value={periodStart}
                  onChange={(event) => {
                    setPeriodStart(event.currentTarget.value);
                    setFilenameSuggestionMessage("");
                    clearValidationMessage();
                  }}
                />
                <label htmlFor="file-upload-period-end">Coverage end</label>
                <input
                  id="file-upload-period-end"
                  type="date"
                  value={periodEnd}
                  onChange={(event) => {
                    setPeriodEnd(event.currentTarget.value);
                    setFilenameSuggestionMessage("");
                    clearValidationMessage();
                  }}
                />
              </div>
            )}

            {effectiveProfile === "manual_invoice_pdf_v1" && (
              <div className="file-upload-invoice-metadata">
                <label htmlFor="file-upload-supplier">Supplier</label>
                <input
                  id="file-upload-supplier"
                  type="text"
                  maxLength={200}
                  value={supplier}
                  onChange={(event) => {
                    setSupplier(event.currentTarget.value);
                    setFilenameSuggestionMessage("");
                    clearValidationMessage();
                  }}
                />
                <label htmlFor="file-upload-document-date">Document date</label>
                <input
                  id="file-upload-document-date"
                  type="date"
                  value={documentDate}
                  onChange={(event) => {
                    setDocumentDate(event.currentTarget.value);
                    setFilenameSuggestionMessage("");
                    clearValidationMessage();
                  }}
                />
                <label htmlFor="file-upload-reference">Reference</label>
                <input
                  id="file-upload-reference"
                  type="text"
                  maxLength={200}
                  value={reference}
                  onChange={(event) => {
                    setReference(event.currentTarget.value);
                    setFilenameSuggestionMessage("");
                    clearValidationMessage();
                  }}
                />
              </div>
            )}

            <label htmlFor="file-upload-notes">Notes</label>
            <textarea
              id="file-upload-notes"
              maxLength={2000}
              rows={3}
              value={notes}
              onChange={(event) => {
                setNotes(event.currentTarget.value);
                clearValidationMessage();
              }}
            />
          </fieldset>

          {message && (
            <p
              className="file-upload-message"
              role={status === "failed" ? "alert" : "status"}
              aria-live="polite"
            >
              {message}
            </p>
          )}

          {(busy || attempt) && (
            <div className="file-upload-progress">
              <progress
                aria-label="Upload progress"
                max={100}
                value={progress}
              />
              <span>{progress}%</span>
            </div>
          )}

          {attempt && status === "failed" && !confirmationFailed && (
            <section
              className="file-upload-recovery"
              aria-labelledby="file-upload-recovery-heading"
            >
              <h3 id="file-upload-recovery-heading">Upload recovery</h3>
              <p>
                Retry continues this upload. The earlier file may already be in
                the library, so review it before starting a separate upload.
              </p>
              <a
                href={`/imports/files/${encodeURIComponent(attempt.artifactId)}`}
              >
                Review this earlier file
              </a>
              <button type="button" onClick={startSeparateUpload}>
                Start a separate upload
              </button>
            </section>
          )}

          {previousPendingArtifactIds.length > 0 && (
            <section
              className="file-upload-previous"
              aria-labelledby="file-upload-previous-heading"
            >
              <h3 id="file-upload-previous-heading">Earlier files</h3>
              <p>These files remain in the library for review.</p>
              <ul>
                {previousPendingArtifactIds.map((artifactId, index) => (
                  <li key={artifactId}>
                    <a
                      href={`/imports/files/${encodeURIComponent(artifactId)}`}
                    >
                      Review earlier file {index + 1}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="file-upload-actions">
            <button
              type="submit"
              disabled={busy || confirmationFailed || status === "complete"}
            >
              {busy ? "Uploading…" : attempt ? "Retry upload" : "Upload file"}
            </button>
            {confirmationFailed && (
              <button type="button" disabled={busy} onClick={retryConfirmation}>
                Retry confirmation
              </button>
            )}
          </div>
        </form>
      </section>
    </PageContainer>
  );
};
