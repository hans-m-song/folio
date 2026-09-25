import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { SourceTabs } from "../components/import-profile-tabs";
import type { loadTransactionWorkflowSession } from "./-transaction-workflow";
import {
  confirmArtifactUpload,
  findArtifactFilenameMatches,
  startArtifactUpload,
} from "../server/operations";

type UploadSession = Awaited<ReturnType<typeof loadTransactionWorkflowSession>>;
type UploadStatus =
  | "queued"
  | "validating"
  | "uploading"
  | "confirming"
  | "confirmed"
  | "failed";

interface PdfUploadEntry {
  readonly id: number;
  readonly file: File;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly artifactId: string | null;
  readonly confirmationUnknown: boolean;
  readonly confirmationRetryable: boolean;
  readonly message: string;
  readonly filenameMatchCount: number | null;
  readonly filenameMatchCheckFailed: boolean;
}

export const invoicePdfFileIssue = (
  file: Pick<File, "name" | "size">,
): string | null => {
  if (file.size <= 0) return "The selected file is empty.";
  if (!file.name.toLowerCase().endsWith(".pdf"))
    return "Choose a file with a .pdf extension.";
  return null;
};

export const hasPdfHeader = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d;

export const uploadStatusLabel = (status: UploadStatus): string => {
  switch (status) {
    case "queued":
      return "Queued";
    case "validating":
      return "Checking PDF";
    case "uploading":
      return "Uploading";
    case "confirming":
      return "Confirming";
    case "confirmed":
      return "Available in file library";
    case "failed":
      return "Needs attention";
  }
};

const checksumSha256 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasPdfHeader(bytes))
    throw new Error("The selected file does not have a PDF header.");

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
};

const putPdfWithProgress = (
  uploadUrl: string,
  file: File,
  checksum: string,
  artifactId: string,
  onProgress: (progress: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("content-type", "application/pdf");
    request.setRequestHeader("x-amz-checksum-sha256", checksum);
    request.setRequestHeader("x-amz-meta-folio-artifact-id", artifactId);
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.floor((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(`PDF upload failed (${request.status}).`));
    };
    request.onerror = () =>
      reject(new Error("PDF upload failed. Check the connection and retry."));
    request.onabort = () => reject(new Error("PDF upload was interrupted."));
    request.send(file);
  });

const safeUploadError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message.trim() : "";
  if (
    !message ||
    message.length > 180 ||
    /https?:\/\/|@|secret|password|credential|stack/i.test(message)
  )
    return fallback;
  return message;
};

export const ArtifactPdfUploadPage = ({
  session,
  embedded = false,
}: {
  session: UploadSession;
  embedded?: boolean;
}) => {
  const [uploads, setUploads] = useState<PdfUploadEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const inFlight = useRef(false);

  const updateUpload = (
    id: number,
    update: (upload: PdfUploadEntry) => PdfUploadEntry,
  ) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? update(upload) : upload)),
    );
  };

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    if (files.length) {
      const additions = files.map(
        (file): PdfUploadEntry => ({
          id: ++nextId.current,
          file,
          status: "queued",
          progress: 0,
          artifactId: null,
          confirmationUnknown: false,
          confirmationRetryable: false,
          message: "",
          filenameMatchCount: null,
          filenameMatchCheckFailed: false,
        }),
      );
      setUploads((current) => [...current, ...additions]);
      const addedIndices = new Map(
        additions.map((upload, index) => [upload.id, index]),
      );
      void findArtifactFilenameMatches({
        data: {
          profile: "manual_invoice_pdf_v1",
          filenames: additions.map((upload) => upload.file.name),
        },
      })
        .then((matchCounts) =>
          setUploads((current) =>
            current.map((upload) => {
              const matchIndex = addedIndices.get(upload.id);
              if (matchIndex === undefined) return upload;
              return {
                ...upload,
                filenameMatchCount: matchCounts[matchIndex] ?? 0,
              };
            }),
          ),
        )
        .catch(() =>
          setUploads((current) =>
            current.map((upload) =>
              addedIndices.has(upload.id)
                ? { ...upload, filenameMatchCheckFailed: true }
                : upload,
            ),
          ),
        );
    }
    event.currentTarget.value = "";
  };

  const uploadOne = async (id: number) => {
    const upload = uploads.find((candidate) => candidate.id === id);
    if (!upload) return;

    updateUpload(id, (current) => ({
      ...current,
      status: "validating",
      progress: 0,
      artifactId: null,
      confirmationUnknown: false,
      confirmationRetryable: false,
      message: "Checking filename, size, and PDF content…",
    }));

    const issue = invoicePdfFileIssue(upload.file);
    if (issue) {
      updateUpload(id, (current) => ({
        ...current,
        status: "failed",
        message: issue,
      }));
      return;
    }

    let stage: "checksum" | "start" | "upload" | "confirm" = "checksum";
    let artifactId: string | null = null;
    try {
      const checksum = await checksumSha256(upload.file);
      stage = "start";
      const started = await startArtifactUpload({
        data: {
          ownerId: session.authenticated ? session.user.id : null,
          artifactProfile: "manual_invoice_pdf_v1",
          filename: upload.file.name,
          mediaType: "application/pdf",
          byteSize: upload.file.size,
          checksumSha256: checksum,
        },
      });
      artifactId = started.artifact.id;
      updateUpload(id, (current) => ({
        ...current,
        status: "uploading",
        artifactId,
        message: "Uploading PDF to the file library…",
      }));

      stage = "upload";
      await putPdfWithProgress(
        started.uploadUrl,
        upload.file,
        checksum,
        artifactId,
        (progress) => updateUpload(id, (current) => ({ ...current, progress })),
      );
      updateUpload(id, (current) => ({
        ...current,
        status: "confirming",
        message: "Confirming the uploaded PDF…",
      }));

      stage = "confirm";
      await confirmArtifactUpload({ data: { id: artifactId } });
      updateUpload(id, (current) => ({
        ...current,
        status: "confirmed",
        progress: 100,
        message:
          "Confirmed and available as reusable evidence in the file library.",
      }));
    } catch (error) {
      const knownPrecommitFailure =
        stage === "confirm" &&
        error instanceof Error &&
        /\bS3_UNAVAILABLE\b/.test(error.message);
      const fallback =
        stage === "confirm"
          ? knownPrecommitFailure
            ? "Storage was unavailable before confirmation. Retry confirmation for this PDF."
            : "Confirmation could not be verified. Check the file library before retrying this PDF."
          : stage === "upload"
            ? "The browser upload failed. Check the connection and retry this PDF."
            : "The PDF could not be prepared for upload. Check the file and retry.";
      updateUpload(id, (current) => ({
        ...current,
        status: "failed",
        artifactId,
        confirmationUnknown: stage === "confirm" && !knownPrecommitFailure,
        confirmationRetryable: knownPrecommitFailure,
        message:
          stage === "confirm" ? fallback : safeUploadError(error, fallback),
      }));
    }
  };

  const processUploads = async (ids: number[]) => {
    if (inFlight.current || !session.authenticated) return;
    inFlight.current = true;
    setBusy(true);
    try {
      for (const id of ids) await uploadOne(id);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const uploadQueued = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void processUploads(
      uploads
        .filter((upload) => upload.status === "queued")
        .map((upload) => upload.id),
    );
  };

  const retryUpload = (id: number) => {
    const upload = uploads.find((candidate) => candidate.id === id);
    if (!upload || upload.confirmationUnknown || upload.confirmationRetryable)
      return;
    void processUploads([id]);
  };

  const retryConfirmation = async (id: number) => {
    const upload = uploads.find((candidate) => candidate.id === id);
    if (
      !upload?.artifactId ||
      !upload.confirmationRetryable ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setBusy(true);
    updateUpload(id, (current) => ({
      ...current,
      status: "confirming",
      message: "Retrying confirmation of the existing uploaded PDF…",
    }));
    try {
      await confirmArtifactUpload({ data: { id: upload.artifactId } });
      updateUpload(id, (current) => ({
        ...current,
        status: "confirmed",
        confirmationRetryable: false,
        progress: 100,
        message:
          "Confirmed and available as reusable evidence in the file library.",
      }));
    } catch (error) {
      const knownPrecommitFailure =
        error instanceof Error && /\bS3_UNAVAILABLE\b/.test(error.message);
      updateUpload(id, (current) => ({
        ...current,
        status: "failed",
        confirmationUnknown: !knownPrecommitFailure,
        confirmationRetryable: knownPrecommitFailure,
        message: knownPrecommitFailure
          ? "Storage is still unavailable. Retry confirmation when it recovers."
          : "Confirmation could not be verified. Check the file library before retrying this PDF.",
      }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const queuedCount = uploads.filter(
    (upload) => upload.status === "queued",
  ).length;
  const RootElement = embedded ? "div" : "main";

  if (!session.authenticated)
    return (
      <RootElement className="artifact-upload-page">
        <header>
          <p className="eyebrow">Private preparation workspace</p>
          <h1>Sign in required</h1>
          <p>Sign in to upload invoice evidence.</p>
          <a href="/auth/login?return_to=%2Fimports%2Fpdf">Sign in</a>
        </header>
      </RootElement>
    );

  return (
    <RootElement className="artifact-upload-page">
      {!embedded && (
        <>
          <header className="artifact-upload-header">
            <p className="eyebrow">Source files</p>
            <h1>Upload invoice PDFs</h1>
            <p>
              Add invoice and evidence PDFs to the file library. Uploading files
              here does not create transactions or link evidence automatically.
            </p>
          </header>
          <SourceTabs active="pdf" />
        </>
      )}

      <section
        className="artifact-upload-panel"
        aria-labelledby="artifact-upload-heading"
      >
        <div className="artifact-upload-panel-heading">
          <div>
            <p className="artifact-library-kicker">Reusable evidence</p>
            <h2 id="artifact-upload-heading">Choose PDF files</h2>
            <p>
              Each file is checked, uploaded, and confirmed independently.
              Failed files stay in the list so you can retry them individually.
            </p>
          </div>
          <a href="/imports/library">View file library</a>
        </div>

        <form className="artifact-upload-form" onSubmit={uploadQueued}>
          <label htmlFor="artifact-pdf-files">Invoice or evidence PDFs</label>
          <input
            id="artifact-pdf-files"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy}
            onChange={addFiles}
          />
          <p className="artifact-upload-help">
            Select one or more PDFs. Empty files and files without a PDF header
            are rejected before upload.
          </p>
          <button type="submit" disabled={busy || queuedCount === 0}>
            {busy
              ? "Uploading PDFs…"
              : `Upload ${queuedCount} queued PDF${queuedCount === 1 ? "" : "s"}`}
          </button>
        </form>

        {uploads.length > 0 && (
          <section
            className="artifact-upload-queue"
            aria-labelledby="artifact-upload-queue-heading"
          >
            <div className="artifact-upload-queue-heading">
              <h3 id="artifact-upload-queue-heading">Upload queue</h3>
              <p aria-live="polite">
                {
                  uploads.filter((upload) => upload.status === "confirmed")
                    .length
                }{" "}
                confirmed ·{" "}
                {uploads.filter((upload) => upload.status === "failed").length}{" "}
                need attention
              </p>
            </div>
            <ol className="artifact-upload-list">
              {uploads.map((upload) => (
                <li key={upload.id} className="artifact-upload-item">
                  <div className="artifact-upload-item-heading">
                    <span className="artifact-library-filename">
                      {upload.file.name}
                    </span>
                    <span
                      className={`artifact-upload-status artifact-upload-status--${upload.status}`}
                    >
                      {uploadStatusLabel(upload.status)}
                    </span>
                  </div>
                  {upload.filenameMatchCount === null &&
                    !upload.filenameMatchCheckFailed && (
                      <p
                        className="artifact-filename-match-warning"
                        role="status"
                      >
                        Checking for an existing filename…
                      </p>
                    )}
                  {upload.filenameMatchCount !== null &&
                    upload.filenameMatchCount > 0 && (
                      <p
                        className="artifact-filename-match-warning"
                        role="status"
                      >
                        {upload.filenameMatchCount} existing artifact
                        {upload.filenameMatchCount === 1 ? "" : "s"} match this
                        filename.
                      </p>
                    )}
                  {upload.filenameMatchCheckFailed && (
                    <p
                      className="artifact-filename-match-warning"
                      role="status"
                    >
                      Could not check this filename; upload remains available.
                    </p>
                  )}
                  {upload.status === "uploading" && (
                    <div className="artifact-upload-progress">
                      <progress
                        aria-label={`Upload progress for ${upload.file.name}`}
                        max={100}
                        value={upload.progress}
                      />
                      <span>{upload.progress}%</span>
                    </div>
                  )}
                  <p
                    role={upload.status === "failed" ? "alert" : "status"}
                    aria-live="polite"
                  >
                    {upload.message || uploadStatusLabel(upload.status)}
                  </p>
                  {upload.status === "confirmed" && (
                    <a href="/imports/library?profile=manual_invoice_pdf_v1&state=available&linkage=unlinked">
                      View available evidence
                    </a>
                  )}
                  {upload.status === "failed" &&
                    !upload.confirmationUnknown &&
                    !upload.confirmationRetryable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => retryUpload(upload.id)}
                      >
                        Retry upload for {upload.file.name}
                      </button>
                    )}
                  {upload.status === "failed" && upload.confirmationUnknown && (
                    <a href="/imports/library">
                      Check the file library before adding this file again
                    </a>
                  )}
                  {upload.status === "failed" &&
                    upload.confirmationRetryable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void retryConfirmation(upload.id)}
                      >
                        Retry confirmation for {upload.file.name}
                      </button>
                    )}
                </li>
              ))}
            </ol>
          </section>
        )}
      </section>
    </RootElement>
  );
};
