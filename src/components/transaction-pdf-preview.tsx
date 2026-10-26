import { useEffect, useRef, useState } from "react";

import { previewArtifactForReview } from "../server/operations";
import "../styles/transaction-pdf-preview.css";

type PreviewState =
  | { artifactId: string; status: "loading" }
  | { artifactId: string; status: "error" }
  | { artifactId: string; status: "ready"; url: string };

export const TransactionPdfPreview = ({
  artifactId,
  filename,
  variant = "side",
}: {
  artifactId: string;
  filename: string;
  variant?: "side" | "peek";
}) => {
  const requestSequence = useRef(0);
  const currentArtifactId = useRef(artifactId);
  currentArtifactId.current = artifactId;
  const [refreshKey, setRefreshKey] = useState(0);
  const [preview, setPreview] = useState<PreviewState>(() => ({
    artifactId,
    status: "loading",
  }));
  const currentPreview: PreviewState =
    preview.artifactId === artifactId
      ? preview
      : { artifactId, status: "loading" };

  useEffect(() => {
    const requestId = ++requestSequence.current;
    let current = true;
    setPreview({ artifactId, status: "loading" });

    void previewArtifactForReview({ data: { id: artifactId } }).then(
      (url) => {
        if (
          current &&
          requestSequence.current === requestId &&
          currentArtifactId.current === artifactId
        )
          setPreview({ artifactId, status: "ready", url });
      },
      () => {
        if (
          current &&
          requestSequence.current === requestId &&
          currentArtifactId.current === artifactId
        )
          setPreview({ artifactId, status: "error" });
      },
    );

    return () => {
      current = false;
    };
  }, [artifactId, refreshKey]);

  const refresh = () => {
    requestSequence.current += 1;
    setPreview({ artifactId, status: "loading" });
    setRefreshKey((current) => current + 1);
  };
  const viewerOptions =
    variant === "peek" ? "view=FitH&toolbar=0" : "view=FitH";

  return (
    <section
      className={
        variant === "peek"
          ? "transaction-pdf-preview transaction-pdf-preview--peek"
          : "transaction-pdf-preview"
      }
      aria-label="Invoice PDF preview"
    >
      <header className="transaction-pdf-preview__header">
        <div>
          <h2>Invoice PDF</h2>
          <p>{filename}</p>
        </div>
        <div className="actions">
          {currentPreview.status === "ready" && (
            <a
              href={currentPreview.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open PDF in a new tab
            </a>
          )}
          <button
            className="secondary"
            type="button"
            disabled={currentPreview.status === "loading"}
            onClick={refresh}
          >
            Refresh preview
          </button>
        </div>
      </header>
      {currentPreview.status === "loading" && (
        <p role="status">Preparing PDF preview…</p>
      )}
      {currentPreview.status === "error" && (
        <p role="alert">
          PDF preview could not be prepared. Refresh to try again.
        </p>
      )}
      {currentPreview.status === "ready" && (
        <iframe
          className="transaction-pdf-preview__frame"
          title={`PDF preview: ${filename}`}
          src={`${currentPreview.url}${currentPreview.url.includes("#") ? "&" : "#"}${viewerOptions}`}
          referrerPolicy="no-referrer"
        />
      )}
    </section>
  );
};
