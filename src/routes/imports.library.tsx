import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { artifactProfiles, artifactProfileSchema } from "../artifacts/profiles";
import { ConfirmationDialog } from "../components/confirmation-dialog";
import {
  deleteArtifact,
  downloadArtifact,
  listArtifacts,
} from "../server/operations";
import artifactsCss from "../styles/artifacts.css?url";

export const artifactPageSize = 25;

const artifactStateSchema = z.enum([
  "pending",
  "available",
  "superseded",
  "abandoned",
  "rejected",
  "deleting",
]);

const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
};

const artifactDateSearchSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value))
  .catch("");

const artifactSearchSchema = z.object({
  filename: z.string().trim().max(200).catch(""),
  profile: z.union([z.literal("all"), artifactProfileSchema]).catch("all"),
  from: artifactDateSearchSchema,
  to: artifactDateSearchSchema,
  state: z.union([z.literal("all"), artifactStateSchema]).catch("all"),
  linkage: z.enum(["all", "linked", "unlinked"]).catch("all"),
  page: z.coerce.number().int().min(1).max(4_001).catch(1),
});

export type ArtifactSearch = z.infer<typeof artifactSearchSchema>;

export const validateArtifactSearch = (
  search: Record<string, unknown>,
): ArtifactSearch => artifactSearchSchema.parse(search);

export const artifactListInput = (search: ArtifactSearch) => ({
  search: search.filename,
  profile: search.profile === "all" ? null : search.profile,
  from: search.from || null,
  to: search.to || null,
  state: search.state === "all" ? null : search.state,
  linkage: search.linkage,
  limit: artifactPageSize,
  offset: (search.page - 1) * artifactPageSize,
});

export const artifactPagination = (total: number, requestedPage: number) => {
  const pageCount = Math.max(
    1,
    Math.ceil(Math.max(0, total) / artifactPageSize),
  );
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return {
    page,
    pageCount,
    start: total === 0 ? 0 : (page - 1) * artifactPageSize + 1,
    end: Math.min(page * artifactPageSize, total),
  };
};

export const isArtifactDownloadable = (state: string): boolean =>
  state === "available";

export const isArtifactDeletable = (artifact: {
  transactionCount: number;
  bankRowCount: number;
}): boolean => artifact.transactionCount === 0 && artifact.bankRowCount === 0;

export const copyArtifactId = async (
  id: string,
  writeText: ((value: string) => Promise<void>) | undefined,
): Promise<"copied" | "failed"> => {
  if (!writeText) return "failed";
  try {
    await writeText(id);
    return "copied";
  } catch {
    return "failed";
  }
};

const loadArtifactPage = async (search: ArtifactSearch) => {
  if (search.from && search.to && search.from > search.to)
    return { status: "invalid-range" as const };

  try {
    const input = artifactListInput(search);
    let result = await listArtifacts({ data: input });
    let pagination = artifactPagination(result.total, search.page);

    if (pagination.page !== search.page) {
      result = await listArtifacts({
        data: {
          ...input,
          offset: (pagination.page - 1) * artifactPageSize,
        },
      });
      pagination = artifactPagination(result.total, pagination.page);
    }

    return { status: "loaded" as const, result, pagination };
  } catch {
    return { status: "error" as const };
  }
};

export const Route = createFileRoute("/imports/library")({
  validateSearch: validateArtifactSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadArtifactPage(deps),
  head: () => ({ links: [{ rel: "stylesheet", href: artifactsCss }] }),
  pendingComponent: ArtifactsPending,
  component: ArtifactLibraryPage,
});

function ArtifactLibraryPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const navigate = useNavigate({ from: "/imports/library" });
  const router = useRouter();
  const [actionMessage, setActionMessage] = useState<{
    text: string;
    tone: "status" | "error";
  } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingArtifact, setDeletingArtifact] =
    useState<ArtifactListRow | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  useEffect(() => {
    if (data.status !== "loaded" || data.pagination.page === search.page)
      return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, page: data.pagination.page }),
    });
  }, [data, navigate, search.page]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = validateArtifactSearch(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    void navigate({
      search: (previous) => ({
        ...previous,
        filename: next.filename,
        profile: next.profile,
        from: next.from,
        to: next.to,
        state: next.state,
        linkage: next.linkage,
        page: 1,
      }),
    });
  };

  const goToPage = (page: number) => {
    void navigate({ search: (previous) => ({ ...previous, page }) });
  };

  const handleDownload = async (artifact: ArtifactListRow) => {
    if (!isArtifactDownloadable(artifact.state)) return;
    setActionMessage(null);
    setDownloadingId(artifact.id);
    try {
      const url = await downloadArtifact({ data: { id: artifact.id } });
      window.location.assign(url);
    } catch {
      setActionMessage({
        text: `Download could not be prepared for ${artifact.filename}. Try again.`,
        tone: "error",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopy = async (artifact: ArtifactListRow) => {
    const result = await copyArtifactId(
      artifact.id,
      navigator.clipboard?.writeText.bind(navigator.clipboard),
    );
    setActionMessage(
      result === "copied"
        ? {
            text: `Artifact ID copied for ${artifact.filename}.`,
            tone: "status",
          }
        : {
            text: `Could not copy ${artifact.id}. Select and copy it manually.`,
            tone: "error",
          },
    );
  };

  const handleDelete = async () => {
    if (!deletingArtifact || !isArtifactDeletable(deletingArtifact)) return;
    const target = deletingArtifact;
    setDeletePending(true);
    setActionMessage({
      text: `Deleting ${target.filename}…`,
      tone: "status",
    });
    try {
      await deleteArtifact({ data: { id: target.id } });
    } catch {
      setActionMessage({
        text: `Deletion failed for ${target.filename}. It remains listed so you can retry when storage is available.`,
        tone: "error",
      });
      setDeletingArtifact(null);
      await router.invalidate().catch(() => undefined);
      return;
    } finally {
      setDeletePending(false);
    }

    setActionMessage({
      text: `Artifact ${target.filename} deleted.`,
      tone: "status",
    });
    setDeletingArtifact(null);
    await router.invalidate().catch(() => {
      setActionMessage({
        text: `Artifact ${target.filename} was deleted, but the list could not be refreshed. Reload the page to see its current state.`,
        tone: "error",
      });
    });
  };

  const searchKey = [
    search.filename,
    search.profile,
    search.from,
    search.to,
    search.state,
    search.linkage,
  ].join("\u001f");
  const hasFilters = Boolean(
    search.filename ||
    search.profile !== "all" ||
    search.from ||
    search.to ||
    search.state !== "all" ||
    search.linkage !== "all",
  );

  return (
    <main className="artifact-library-page">
      <header className="artifact-library-header">
        <p className="eyebrow">Source files</p>
        <h1>File library</h1>
        <p className="artifact-library-lead">
          Browse uploaded files and their links to transactions or bank
          activity.
        </p>
      </header>

      <section
        className="artifact-library-panel"
        aria-labelledby="artifact-library-heading"
      >
        <div className="artifact-library-panel-heading">
          <div>
            <p className="artifact-library-kicker">Library</p>
            <h2 id="artifact-library-heading">Uploaded artifacts</h2>
            {data.status === "loaded" && (
              <p className="artifact-library-total" aria-live="polite">
                {data.result.total.toLocaleString("en-AU")} artifact
                {data.result.total === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>

        <form
          key={searchKey}
          className="artifact-library-filters"
          onSubmit={applyFilters}
        >
          <label>
            Filename
            <input
              type="search"
              name="filename"
              maxLength={200}
              defaultValue={search.filename}
              autoComplete="off"
            />
          </label>
          <label>
            Profile
            <select name="profile" defaultValue={search.profile}>
              <option value="all">All profiles</option>
              {artifactProfiles.map(({ profile, label }) => (
                <option key={profile} value={profile}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Uploaded from (UTC)
            <input type="date" name="from" defaultValue={search.from} />
          </label>
          <label>
            Uploaded to (UTC)
            <input type="date" name="to" defaultValue={search.to} />
          </label>
          <label>
            State
            <select name="state" defaultValue={search.state}>
              <option value="all">All states</option>
              <option value="pending">Pending</option>
              <option value="available">Available</option>
              <option value="superseded">Superseded</option>
              <option value="abandoned">Abandoned</option>
              <option value="rejected">Rejected</option>
              <option value="deleting">Deleting</option>
            </select>
          </label>
          <label>
            Linkage
            <select name="linkage" defaultValue={search.linkage}>
              <option value="all">All artifacts</option>
              <option value="linked">Linked</option>
              <option value="unlinked">Unlinked</option>
            </select>
          </label>
          <div className="artifact-library-filter-actions">
            <button type="submit">Apply filters</button>
            <a href="/imports/library">Clear filters</a>
          </div>
        </form>

        {actionMessage && (
          <p
            className={`artifact-library-action-message${actionMessage.tone === "error" ? "artifact-library-action-message--error" : ""}`}
            role={actionMessage.tone === "error" ? "alert" : "status"}
          >
            {actionMessage.text}
          </p>
        )}

        {data.status === "error" ? (
          <div className="artifact-library-error" role="alert">
            <h3>Artifacts could not be loaded</h3>
            <p>Retry the request. Your filters remain in the address bar.</p>
            <button type="button" onClick={() => void router.invalidate()}>
              Retry
            </button>
          </div>
        ) : data.status === "invalid-range" ? (
          <div className="artifact-library-error" role="alert">
            <h3>Check the upload date range</h3>
            <p>The “Uploaded from” date must be on or before “Uploaded to”.</p>
          </div>
        ) : (
          <>
            {data.result.rows.length === 0 ? (
              <div className="artifact-library-empty" role="status">
                <h3>
                  {hasFilters ? "No matching artifacts" : "No artifacts yet"}
                </h3>
                <p>
                  {hasFilters
                    ? "Change or clear the filters to see other source files."
                    : "Uploaded invoice evidence, imports, and statements will appear here."}
                </p>
                {hasFilters && <a href="/imports/library">Clear filters</a>}
              </div>
            ) : (
              <div className="artifact-library-scroll">
                <table className="artifact-library-table">
                  <caption className="artifact-library-sr-only">
                    Uploaded artifacts and their relationships
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Filename</th>
                      <th scope="col">Profile</th>
                      <th scope="col">Type</th>
                      <th scope="col">Uploaded (UTC)</th>
                      <th scope="col">State</th>
                      <th scope="col">Linked records</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.result.rows.map((artifact) => (
                      <tr key={artifact.id}>
                        <td data-label="Filename">
                          <span className="artifact-library-filename">
                            {artifact.filename}
                          </span>
                        </td>
                        <td data-label="Profile">
                          {artifactProfileLabel(artifact.artifactProfile)}
                        </td>
                        <td data-label="Type">
                          {artifactTypeLabel(artifact.mediaType)}
                        </td>
                        <td data-label="Uploaded (UTC)">
                          <time dateTime={artifact.createdAt}>
                            {formatArtifactDate(artifact.createdAt)}
                          </time>
                        </td>
                        <td data-label="State">
                          <span
                            className={`artifact-library-state artifact-library-state--${artifactStateClass(artifact.state)}`}
                          >
                            {artifactStateLabel(artifact.state)}
                          </span>
                        </td>
                        <td data-label="Linked records">
                          <dl className="artifact-library-links">
                            <div>
                              <dt>Transactions</dt>
                              <dd>{artifact.transactionCount}</dd>
                            </div>
                            <div>
                              <dt>Bank activity rows</dt>
                              <dd>{artifact.bankRowCount}</dd>
                            </div>
                          </dl>
                        </td>
                        <td data-label="Actions">
                          <div className="artifact-library-actions">
                            {isArtifactDownloadable(artifact.state) ? (
                              <button
                                type="button"
                                className="artifact-library-action"
                                aria-label={`Download ${artifact.filename}`}
                                disabled={downloadingId === artifact.id}
                                onClick={() => void handleDownload(artifact)}
                              >
                                {downloadingId === artifact.id
                                  ? "Preparing…"
                                  : "Download"}
                              </button>
                            ) : (
                              <span className="artifact-library-unavailable">
                                Download unavailable
                              </span>
                            )}
                            <button
                              type="button"
                              className="artifact-library-action"
                              aria-label={`Copy artifact ID for ${artifact.filename}`}
                              onClick={() => void handleCopy(artifact)}
                            >
                              Copy ID
                            </button>
                            {isArtifactDeletable(artifact) && (
                              <button
                                type="button"
                                className="artifact-library-action artifact-library-action--danger"
                                aria-label={`${artifact.state === "deleting" ? "Retry deletion of" : "Delete artifact"} ${artifact.filename}`}
                                disabled={
                                  deletePending &&
                                  deletingArtifact?.id === artifact.id
                                }
                                onClick={() => {
                                  setDeletingArtifact(artifact);
                                }}
                              >
                                {deletePending &&
                                deletingArtifact?.id === artifact.id
                                  ? "Deleting…"
                                  : artifact.state === "deleting"
                                    ? "Retry deletion"
                                    : "Delete"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <nav
              className="artifact-library-pagination"
              aria-label="Artifact pagination"
            >
              <p aria-live="polite">
                Showing {data.pagination.start}–{data.pagination.end} of{" "}
                {data.result.total.toLocaleString("en-AU")} artifacts · Page{" "}
                {data.pagination.page} of {data.pagination.pageCount}
              </p>
              <div>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Previous artifacts page"
                  disabled={data.pagination.page <= 1}
                  onClick={() => goToPage(data.pagination.page - 1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="secondary"
                  aria-label="Next artifacts page"
                  disabled={data.pagination.page >= data.pagination.pageCount}
                  onClick={() => goToPage(data.pagination.page + 1)}
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>
      {deletingArtifact && (
        <ConfirmationDialog
          title="Permanently delete artifact?"
          description={`Delete ${deletingArtifact.filename} and its stored file versions? This cannot be undone. No linked records will be removed. If an upload is still in progress, it may finish after deletion and leave an untracked file.`}
          confirmLabel="Delete permanently"
          pending={deletePending}
          onCancel={() => setDeletingArtifact(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </main>
  );
}

type ArtifactListRow = Awaited<
  ReturnType<typeof listArtifacts>
>["rows"][number];

const artifactProfileLabel = (profile: string): string =>
  artifactProfiles.find((definition) => definition.profile === profile)
    ?.label ?? "Unknown profile";

const artifactTypeLabel = (mediaType: string): string => {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "text/csv") return "CSV";
  return mediaType || "Unknown";
};

const artifactStateLabel = (state: string): string => {
  if (state === "pending") return "Pending";
  if (state === "available") return "Available";
  if (state === "superseded") return "Superseded";
  if (state === "abandoned") return "Abandoned";
  if (state === "rejected") return "Rejected CSV";
  if (state === "deleting") return "Deleting";
  return "Unknown";
};

const artifactStateClass = (state: string): string =>
  artifactStateSchema.safeParse(state).success ? state : "unknown";

const formatArtifactDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
};

function ArtifactsPending() {
  return (
    <main className="artifact-library-page">
      <p className="artifact-library-pending" role="status">
        Loading artifacts…
      </p>
    </main>
  );
}
