import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import {
  AutocompleteSelect,
  CreatableAutocomplete,
} from "../components/autocomplete";
import { MoneyText } from "../components/money-text";
import type {
  RecurringBillAmountEstimate,
  RecurringBillCandidate,
  RecurringBillOccurrence,
  RecurringBillScheduleInput,
  RecurringBillView,
} from "../domain/recurring-bills";
import { recurringBillScheduleInputSchema } from "../domain/recurring-bills";
import {
  formatDecimal,
  formatMoneyAmount,
  parseDecimal,
} from "../domain/money";
import {
  getRecurringBillsWorkspace,
  linkRecurringBillTransaction,
  previewRecurringBill,
  saveRecurringBill,
  setRecurringBillActive,
  unlinkRecurringBillTransaction,
} from "../server/recurring-bill-operations";
import "../styles/recurring-bills.css";

type Workspace = Awaited<ReturnType<typeof getRecurringBillsWorkspace>> & {
  initialSchedule: RecurringBillScheduleInput | null;
  sourceTransactionId: string | null;
  currentActorId: string;
  reportingTimezone: string;
};
type OccurrencePageState = {
  version: string;
  baseView: RecurringBillView;
  extraOccurrences: RecurringBillOccurrence[];
  nextUnresolvedOffset: number | null;
  status: "loading" | "ready" | "error" | "stale";
};
type ScheduleEditor = {
  mode: "create" | "edit" | "suggestion" | "source";
  id?: string;
  expectedUpdatedAt?: string;
  schedule: RecurringBillScheduleInput;
  sourceTransactionIds: string[];
  occurrenceDates: string[];
};
type RecurringBillPreviewResult = Awaited<
  ReturnType<typeof previewRecurringBill>
>;
type RecurringBillPreviewState = {
  key: string;
  status: "invalid" | "loading" | "error" | "success";
  result?: RecurringBillPreviewResult;
};

const blankSchedule = (): RecurringBillScheduleInput => ({
  label: "",
  counterparty: "",
  descriptionMatchText: null,
  descriptionMatchMode: "contains",
  daysEarly: 3,
  daysLate: 3,
  documentCurrency: "AUD",
  expectedAmount: null,
  frequency: "monthly",
  anchorDate: "",
  responsibleUserId: null,
});

const scheduleInputFrom = (
  schedule: RecurringBillView["schedule"],
): RecurringBillScheduleInput => ({
  label: schedule.label,
  counterparty: schedule.counterparty,
  descriptionMatchText: schedule.descriptionMatchText,
  descriptionMatchMode: schedule.descriptionMatchMode,
  daysEarly: schedule.daysEarly,
  daysLate: schedule.daysLate,
  documentCurrency: schedule.documentCurrency,
  expectedAmount: schedule.expectedAmount,
  frequency: schedule.frequency,
  anchorDate: schedule.anchorDate,
  responsibleUserId: schedule.responsibleUserId,
});

const previewScheduleFrom = (
  schedule: RecurringBillScheduleInput,
): RecurringBillScheduleInput => ({
  label: "Preview",
  counterparty: schedule.counterparty,
  descriptionMatchText: schedule.descriptionMatchText,
  descriptionMatchMode: schedule.descriptionMatchMode,
  documentCurrency: schedule.documentCurrency,
  expectedAmount: null,
  frequency: schedule.frequency,
  anchorDate: schedule.anchorDate,
  responsibleUserId: null,
  daysEarly: schedule.daysEarly,
  daysLate: schedule.daysLate,
});

const conflictMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  return /\bREVISION_CONFLICT\b/.test(message)
    ? "This schedule changed after it was loaded. Refresh the page before trying again."
    : fallback;
};

const recurringCalendarDateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const formatRecurringCalendarDate = (calendarDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate)) return calendarDate;
  const parsed = new Date(`${calendarDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== calendarDate
  )
    return calendarDate;
  const dateParts = Object.fromEntries(
    recurringCalendarDateFormatter
      .formatToParts(parsed)
      .map(({ type, value }) => [type, value]),
  );
  return `${dateParts.day} ${dateParts.month?.slice(0, 3)} ${dateParts.year}`;
};

const formatEstimateMoney = (value: string) => {
  const tenThousandths = parseDecimal(value);
  const cents =
    tenThousandths >= 0n
      ? (tenThousandths + 50n) / 100n
      : (tenThousandths - 50n) / 100n;
  return formatMoneyAmount(formatDecimal(cents * 100n));
};

const AmountEstimateDisplay = ({
  estimate,
  currency,
}: {
  estimate: RecurringBillAmountEstimate | null;
  currency: string;
}) => {
  if (!estimate || estimate.count < 1) return <>No estimate</>;

  const money = (value: string) => `${currency} ${formatEstimateMoney(value)}`;
  if (estimate.count === 1)
    return (
      <MoneyText as="span" className="recurring-bill-amount-estimate__value">
        {money(estimate.average)}
      </MoneyText>
    );

  return (
    <span className="recurring-bill-amount-estimate__values">
      <MoneyText as="span" className="recurring-bill-amount-estimate__value">
        {money(estimate.minimum)}
      </MoneyText>
      <span aria-label="to"> – </span>
      <MoneyText as="span" className="recurring-bill-amount-estimate__value">
        {money(estimate.maximum)}
      </MoneyText>
      <span> · avg </span>
      <MoneyText as="span" className="recurring-bill-amount-estimate__value">
        {money(estimate.average)}
      </MoneyText>
    </span>
  );
};

const candidateDate = (
  candidate: RecurringBillCandidate,
  reportingTimezone: string,
) => {
  if (candidate.invoiceDate) return candidate.invoiceDate;
  const timestamp = candidate.occurredAt ?? candidate.settledAt;
  if (!timestamp) return "Date unavailable";

  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: reportingTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const dateParts = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const candidateLabel = (
  candidate: RecurringBillCandidate,
  reportingTimezone: string,
) => {
  const counterparty =
    candidate.counterparty?.trim() ||
    candidate.description?.trim() ||
    "Unnamed transaction";
  const amount =
    candidate.documentCurrency && candidate.documentAmount
      ? `${candidate.documentCurrency} ${formatMoneyAmount(candidate.documentAmount)}`
      : "Amount unavailable";
  return `${formatRecurringCalendarDate(candidateDate(candidate, reportingTimezone))} · ${counterparty} · ${amount} · ID ${candidate.id}`;
};

const occurrenceKey = (scheduleId: string, expectedDate: string) =>
  `${scheduleId}:${expectedDate}`;

const isUnresolvedOccurrence = (occurrence: RecurringBillOccurrence) =>
  occurrence.isScheduled &&
  !occurrence.isComplete &&
  (occurrence.status === "Pending" || occurrence.status === "Due");

const visibleOccurrences = (
  view: RecurringBillView,
  extraOccurrences: readonly RecurringBillOccurrence[] = [],
) => {
  const uniqueUnresolved = new Map<string, RecurringBillOccurrence>();
  let upcoming: RecurringBillOccurrence | undefined;
  for (const occurrence of [...extraOccurrences, ...view.occurrences]) {
    if (isUnresolvedOccurrence(occurrence)) {
      uniqueUnresolved.set(occurrence.expectedDate, occurrence);
      continue;
    }
    if (
      !upcoming &&
      occurrence.isScheduled &&
      !occurrence.isComplete &&
      occurrence.status === "Upcoming"
    )
      upcoming = occurrence;
  }

  return [...uniqueUnresolved.values(), ...(upcoming ? [upcoming] : [])].sort(
    (left, right) => left.expectedDate.localeCompare(right.expectedDate),
  );
};

const transactionHref = (transactionId: string) =>
  `/transactions/${encodeURIComponent(transactionId)}`;

const errorText = (error: unknown, fallback: string) =>
  conflictMessage(error, fallback);

const RecurringBillsError = () => {
  const router = useRouter();

  return (
    <main className="recurring-bills-page recurring-bills-state">
      <h1>Recurring bills unavailable</h1>
      <p role="alert">Check your connection and retry this page.</p>
      <button type="button" onClick={() => void router.invalidate()}>
        Retry recurring bills
      </button>
    </main>
  );
};

const RecurringBillsPage = () => {
  const workspace = Route.useLoaderData() as Workspace;
  const router = useRouter();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<ScheduleEditor | null>(() =>
    workspace.initialSchedule
      ? {
          mode: "source",
          schedule: {
            ...workspace.initialSchedule,
            responsibleUserId:
              workspace.initialSchedule.responsibleUserId ??
              workspace.currentActorId ??
              null,
          },
          sourceTransactionIds: workspace.sourceTransactionId
            ? [workspace.sourceTransactionId]
            : [],
          occurrenceDates: [workspace.initialSchedule.anchorDate],
        }
      : null,
  );
  const [candidateSelections, setCandidateSelections] = useState<
    Record<string, string>
  >({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "status" | "error";
    text: string;
  } | null>(null);
  const [preview, setPreview] = useState<RecurringBillPreviewState | null>(
    null,
  );
  const [previewRetry, setPreviewRetry] = useState(0);
  const [occurrencePages, setOccurrencePages] = useState<
    Record<string, OccurrencePageState>
  >({});
  const previewRequestId = useRef(0);
  const occurrencePageRequestIds = useRef(new Map<string, number>());
  const baseSchedulesRef = useRef(workspace.schedules);
  const scheduleViewsRef = useRef(
    new Map(workspace.schedules.map((view) => [view.schedule.id, view])),
  );
  scheduleViewsRef.current = new Map(
    workspace.schedules.map((view) => [view.schedule.id, view]),
  );
  const disabled = pendingAction !== null;
  const previewSchedule = editor ? previewScheduleFrom(editor.schedule) : null;
  const previewInputJson = previewSchedule
    ? JSON.stringify(previewSchedule)
    : null;
  const previewValidation = previewSchedule
    ? recurringBillScheduleInputSchema.safeParse(previewSchedule)
    : null;
  const descriptionPatternError =
    editor?.schedule.descriptionMatchMode === "regex" &&
    editor.schedule.descriptionMatchText &&
    previewValidation &&
    !previewValidation.success
      ? (previewValidation.error.issues.find(
          (issue) => issue.path[0] === "descriptionMatchText",
        )?.message ?? null)
      : null;
  const currentPreview = preview?.key === previewInputJson ? preview : null;

  useEffect(() => () => occurrencePageRequestIds.current.clear(), []);

  useEffect(() => {
    if (baseSchedulesRef.current === workspace.schedules) return;
    baseSchedulesRef.current = workspace.schedules;
    for (const [scheduleId, requestId] of occurrencePageRequestIds.current)
      occurrencePageRequestIds.current.set(scheduleId, requestId + 1);
    setOccurrencePages({});
  }, [workspace.schedules]);

  useEffect(() => {
    if (previewInputJson === null) return;

    const requestId = ++previewRequestId.current;
    const parsed = recurringBillScheduleInputSchema.safeParse(
      JSON.parse(previewInputJson),
    );
    if (!parsed.success) {
      setPreview({ key: previewInputJson, status: "invalid" });
      return;
    }

    let active = true;
    setPreview({ key: previewInputJson, status: "loading" });
    const timeout = window.setTimeout(() => {
      void previewRecurringBill({ data: { schedule: parsed.data } })
        .then((result) => {
          if (!active || requestId !== previewRequestId.current) return;
          setPreview({ key: previewInputJson, status: "success", result });
        })
        .catch(() => {
          if (!active || requestId !== previewRequestId.current) return;
          setPreview({ key: previewInputJson, status: "error" });
        });
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (requestId === previewRequestId.current) previewRequestId.current += 1;
    };
  }, [previewInputJson, previewRetry]);

  const runAction = async (
    actionKey: string,
    action: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
    onSuccess?: () => void,
  ) => {
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      await action();
    } catch (error) {
      setFeedback({
        tone: "error",
        text: errorText(error, failureMessage),
      });
      setPendingAction(null);
      return;
    }

    onSuccess?.();
    setFeedback({ tone: "status", text: successMessage });
    try {
      await router.invalidate();
    } catch {
      setFeedback({
        tone: "error",
        text: `${successMessage} The page could not refresh; reload it to confirm the current state.`,
      });
    } finally {
      setPendingAction(null);
    }
  };

  const openCreate = () => {
    setFeedback(null);
    setPreview(null);
    const schedule = blankSchedule();
    schedule.responsibleUserId = workspace.currentActorId ?? null;
    setEditor({
      mode: "create",
      schedule,
      sourceTransactionIds: [],
      occurrenceDates: [],
    });
  };

  const openEdit = (view: RecurringBillView) => {
    setFeedback(null);
    setPreview(null);
    setEditor({
      mode: "edit",
      id: view.schedule.id,
      expectedUpdatedAt: view.schedule.updatedAt,
      schedule: scheduleInputFrom(view.schedule),
      sourceTransactionIds: [],
      occurrenceDates: [],
    });
  };

  const openSuggestion = (suggestion: Workspace["suggestions"][number]) => {
    setFeedback(null);
    setPreview(null);
    setEditor({
      mode: "suggestion",
      schedule: {
        ...suggestion.schedule,
        responsibleUserId:
          suggestion.schedule.responsibleUserId ??
          workspace.currentActorId ??
          null,
      },
      sourceTransactionIds: [...suggestion.sourceTransactionIds],
      occurrenceDates: [...suggestion.occurrenceDates],
    });
  };

  const updateScheduleField = (
    field: keyof RecurringBillScheduleInput,
    value: string | number | null,
  ) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            schedule: {
              ...current.schedule,
              [field]: value,
            } as RecurringBillScheduleInput,
          }
        : current,
    );
  };

  const submitEditor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;

    const parsedSchedule = recurringBillScheduleInputSchema.safeParse(
      editor.schedule,
    );
    if (!parsedSchedule.success) {
      setFeedback({
        tone: "error",
        text: "Correct the highlighted schedule fields before saving.",
      });
      return;
    }

    const data = editor.id
      ? {
          id: editor.id,
          expectedUpdatedAt: editor.expectedUpdatedAt!,
          schedule: parsedSchedule.data,
        }
      : { schedule: parsedSchedule.data };
    const successMessage =
      editor.mode === "edit"
        ? "Recurring bill schedule saved."
        : "Recurring bill schedule created.";

    void runAction(
      "save-schedule",
      () => saveRecurringBill({ data }),
      successMessage,
      "The recurring bill schedule could not be saved. Check the fields and retry.",
      () => {
        setEditor(null);
        setPreview(null);
        if (editor.mode === "source")
          void navigate({ to: "/transactions/recurring", replace: true });
      },
    );
  };

  const toggleSchedule = (view: RecurringBillView) => {
    const active = !view.schedule.active;
    void runAction(
      `active:${view.schedule.id}`,
      () =>
        setRecurringBillActive({
          data: {
            id: view.schedule.id,
            active,
            expectedUpdatedAt: view.schedule.updatedAt,
          },
        }),
      active
        ? "Recurring bill schedule resumed."
        : "Recurring bill schedule paused.",
      "The recurring bill schedule could not be updated. Refresh and retry.",
    );
  };

  const linkCandidate = (
    view: RecurringBillView,
    occurrence: RecurringBillOccurrence,
  ) => {
    const key = occurrenceKey(view.schedule.id, occurrence.expectedDate);
    const transactionId = candidateSelections[key];
    if (!transactionId) {
      setFeedback({
        tone: "error",
        text: "Choose a candidate transaction first.",
      });
      return;
    }

    void runAction(
      `link:${key}`,
      () =>
        linkRecurringBillTransaction({
          data: {
            scheduleId: view.schedule.id,
            expectedDate: occurrence.expectedDate,
            transactionId,
            expectedUpdatedAt: view.schedule.updatedAt,
          },
        }),
      `Transaction linked to the ${formatRecurringCalendarDate(occurrence.expectedDate)} occurrence.`,
      "The transaction could not be linked. Refresh the schedule and check that the candidate is still eligible.",
      () =>
        setCandidateSelections((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        }),
    );
  };

  const unlinkCandidate = (
    view: RecurringBillView,
    occurrence: RecurringBillOccurrence,
  ) => {
    void runAction(
      `unlink:${view.schedule.id}:${occurrence.expectedDate}`,
      () =>
        unlinkRecurringBillTransaction({
          data: {
            scheduleId: view.schedule.id,
            expectedDate: occurrence.expectedDate,
            expectedUpdatedAt: view.schedule.updatedAt,
          },
        }),
      `Transaction unlinked from the ${formatRecurringCalendarDate(occurrence.expectedDate)} occurrence.`,
      "The transaction could not be unlinked. Refresh the schedule and retry.",
    );
  };

  const loadMoreOccurrences = async (view: RecurringBillView) => {
    const scheduleId = view.schedule.id;
    const scheduleVersion = view.schedule.updatedAt;
    const existingPage = occurrencePages[scheduleId];
    const currentPage =
      existingPage?.version === scheduleVersion &&
      existingPage.baseView === view
        ? existingPage
        : null;
    const offset = currentPage
      ? currentPage.nextUnresolvedOffset
      : view.nextUnresolvedOffset;
    if (
      typeof offset !== "number" ||
      currentPage?.status === "loading" ||
      currentPage?.status === "stale"
    )
      return;

    const requestId =
      (occurrencePageRequestIds.current.get(scheduleId) ?? 0) + 1;
    occurrencePageRequestIds.current.set(scheduleId, requestId);
    setOccurrencePages((current) => ({
      ...current,
      [scheduleId]: {
        version: scheduleVersion,
        baseView: view,
        extraOccurrences: currentPage?.extraOccurrences ?? [],
        nextUnresolvedOffset: offset,
        status: "loading",
      },
    }));

    try {
      const pageWorkspace = await getRecurringBillsWorkspace({
        data: { unresolvedOffset: offset },
      });
      if (occurrencePageRequestIds.current.get(scheduleId) !== requestId)
        return;

      const pageView = pageWorkspace.schedules.find(
        (scheduleView) => scheduleView.schedule.id === scheduleId,
      );
      const currentView = scheduleViewsRef.current.get(scheduleId);
      if (
        !pageView ||
        currentView !== view ||
        currentView.schedule.updatedAt !== scheduleVersion ||
        pageView.schedule.updatedAt !== scheduleVersion
      ) {
        setOccurrencePages((current) => ({
          ...current,
          [scheduleId]: {
            version: scheduleVersion,
            baseView: view,
            extraOccurrences: currentPage?.extraOccurrences ?? [],
            nextUnresolvedOffset: offset,
            status: "stale",
          },
        }));
        return;
      }

      const extraByDate = new Map(
        (currentPage?.extraOccurrences ?? [])
          .filter(
            (occurrence) =>
              isUnresolvedOccurrence(occurrence) ||
              occurrence.association !== null,
          )
          .map((occurrence) => [occurrence.expectedDate, occurrence]),
      );
      for (const occurrence of pageView.occurrences) {
        if (
          isUnresolvedOccurrence(occurrence) ||
          occurrence.association !== null
        )
          extraByDate.set(occurrence.expectedDate, occurrence);
      }

      setOccurrencePages((current) => ({
        ...current,
        [scheduleId]: {
          version: scheduleVersion,
          baseView: view,
          extraOccurrences: [...extraByDate.values()],
          nextUnresolvedOffset: pageView.nextUnresolvedOffset,
          status: "ready",
        },
      }));
    } catch {
      if (occurrencePageRequestIds.current.get(scheduleId) !== requestId)
        return;
      if (
        scheduleViewsRef.current.get(scheduleId)?.schedule.updatedAt !==
        scheduleVersion
      ) {
        setOccurrencePages((current) => ({
          ...current,
          [scheduleId]: {
            version: scheduleVersion,
            baseView: view,
            extraOccurrences: currentPage?.extraOccurrences ?? [],
            nextUnresolvedOffset: offset,
            status: "stale",
          },
        }));
        return;
      }

      setOccurrencePages((current) => ({
        ...current,
        [scheduleId]: {
          version: scheduleVersion,
          baseView: view,
          extraOccurrences: currentPage?.extraOccurrences ?? [],
          nextUnresolvedOffset: offset,
          status: "error",
        },
      }));
    }
  };

  return (
    <main className="recurring-bills-page">
      <header className="recurring-bills-header">
        <div>
          <h1>Recurring bills</h1>
          <p>
            Review expected supplier expenses and resolve them with recorded
            transactions. Forecasts never enter financial reports.
          </p>
        </div>
        <button type="button" onClick={openCreate} disabled={disabled}>
          Add schedule
        </button>
      </header>

      {feedback ? (
        <p
          className={`recurring-bills-feedback recurring-bills-feedback--${feedback.tone}`}
          role={feedback.tone === "error" ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}

      {workspace.sourceTransactionId && !workspace.initialSchedule ? (
        <p
          className="recurring-bills-feedback recurring-bills-feedback--error"
          role="alert"
        >
          This transaction cannot prefill a recurring bill schedule. Check that
          it is a recorded supplier expense with a date and document currency.
        </p>
      ) : null}

      {editor ? (
        <ScheduleEditorForm
          editor={editor}
          responsibleUserOptions={workspace.responsibleUserOptions}
          counterparties={workspace.counterparties}
          disabled={disabled}
          descriptionPatternError={descriptionPatternError}
          preview={currentPreview}
          previewValid={previewValidation?.success ?? false}
          onRetryPreview={() => setPreviewRetry((current) => current + 1)}
          onChange={updateScheduleField}
          onCancel={() => {
            setEditor(null);
            setPreview(null);
          }}
          onSubmit={submitEditor}
        />
      ) : null}

      <section aria-labelledby="recurring-bills-schedules-heading">
        <div className="recurring-bills-section-heading">
          <div>
            <h2 id="recurring-bills-schedules-heading">Schedules</h2>
            <p>
              Upcoming is before the expected date. Pending covers the expected
              date through the late window; Due starts after that window.
            </p>
          </div>
          <strong>
            {workspace.attention.pendingCount} Pending ·{" "}
            {workspace.attention.dueCount} Due
          </strong>
        </div>

        {workspace.schedules.length === 0 ? (
          <p className="recurring-bills-empty">
            No recurring bill schedules yet. Add one or review a suggestion
            below.
          </p>
        ) : (
          <div className="recurring-bills-list">
            {workspace.schedules.map((view) => {
              const storedPage = occurrencePages[view.schedule.id];
              const page =
                storedPage?.version === view.schedule.updatedAt &&
                storedPage.baseView === view
                  ? storedPage
                  : null;
              const extraOccurrences = page?.extraOccurrences ?? [];
              const cardOccurrences = visibleOccurrences(
                view,
                extraOccurrences,
              );
              const visibleDates = new Set(
                cardOccurrences.map((occurrence) => occurrence.expectedDate),
              );
              const reviewAssociationsByDate = new Map(
                [...extraOccurrences, ...view.occurrences]
                  .filter(
                    (occurrence) =>
                      occurrence.association !== null &&
                      !visibleDates.has(occurrence.expectedDate),
                  )
                  .map((occurrence) => [occurrence.expectedDate, occurrence]),
              );
              const displayView: RecurringBillView = {
                ...view,
                occurrences: cardOccurrences,
                nextUnresolvedOffset: page
                  ? page.nextUnresolvedOffset
                  : view.nextUnresolvedOffset,
              };

              return (
                <RecurringBillCard
                  key={view.schedule.id}
                  view={displayView}
                  reviewAssociations={[...reviewAssociationsByDate.values()]}
                  pageStatus={page?.status ?? null}
                  disabled={disabled}
                  candidateSelections={candidateSelections}
                  reportingTimezone={workspace.reportingTimezone}
                  onCandidateChange={(expectedDate, transactionId) =>
                    setCandidateSelections((current) => ({
                      ...current,
                      [occurrenceKey(view.schedule.id, expectedDate)]:
                        transactionId,
                    }))
                  }
                  onEdit={() => openEdit(view)}
                  onToggle={() => toggleSchedule(view)}
                  onLink={(occurrence) => linkCandidate(view, occurrence)}
                  onUnlink={(occurrence) => unlinkCandidate(view, occurrence)}
                  onLoadMore={() => void loadMoreOccurrences(view)}
                  onRefresh={() => void router.invalidate()}
                />
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="recurring-bills-suggestions-heading">
        <div className="recurring-bills-section-heading">
          <div>
            <h2 id="recurring-bills-suggestions-heading">
              Suggested schedules
            </h2>
            <p>
              Suggestions are based on repeated recorded supplier expenses and
              require review before they become active.
            </p>
          </div>
        </div>
        {workspace.suggestions.length === 0 ? (
          <p className="recurring-bills-empty">
            No recurring bill patterns are ready for review.
          </p>
        ) : (
          <ul className="recurring-bills-suggestions">
            {workspace.suggestions.map((suggestion, index) => (
              <li
                className="recurring-bills-suggestion"
                key={`${suggestion.schedule.counterparty}:${suggestion.schedule.frequency}:${suggestion.schedule.anchorDate}:${index}`}
              >
                <div>
                  <h3>{suggestion.schedule.label}</h3>
                  <p>
                    {suggestion.schedule.counterparty} ·{" "}
                    {suggestion.schedule.frequency}
                    {" · "}
                    {suggestion.supportCount} supporting recorded expenses
                  </p>
                  <p>
                    Supporting dates:{" "}
                    {suggestion.occurrenceDates.map((date, dateIndex) => (
                      <span key={date}>
                        {dateIndex > 0 ? ", " : null}
                        <time dateTime={date}>
                          {formatRecurringCalendarDate(date)}
                        </time>
                      </span>
                    ))}
                  </p>
                  <ul className="recurring-bills-source-list">
                    {suggestion.sourceTransactionIds.map((id) => (
                      <li key={id}>
                        <a href={transactionHref(id)}>
                          Source transaction {id}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => openSuggestion(suggestion)}
                  disabled={disabled}
                >
                  Review suggestion
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

const RecurringBillCard = ({
  view,
  reviewAssociations,
  pageStatus,
  disabled,
  candidateSelections,
  onCandidateChange,
  onEdit,
  onToggle,
  onLink,
  onUnlink,
  onLoadMore,
  onRefresh,
  reportingTimezone,
}: {
  view: RecurringBillView;
  reviewAssociations: RecurringBillOccurrence[];
  pageStatus: OccurrencePageState["status"] | null;
  disabled: boolean;
  candidateSelections: Record<string, string>;
  reportingTimezone: string;
  onCandidateChange: (expectedDate: string, transactionId: string) => void;
  onEdit: () => void;
  onToggle: () => void;
  onLink: (occurrence: RecurringBillOccurrence) => void;
  onUnlink: (occurrence: RecurringBillOccurrence) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
}) => {
  const { schedule } = view;

  return (
    <article
      className={`recurring-bill-card ${view.dueCount > 0 ? "recurring-bill-card--due" : ""}`}
    >
      <header className="recurring-bill-card__header">
        <div>
          <h3>{schedule.label}</h3>
          <p>
            {schedule.counterparty} · {schedule.frequency}
          </p>
          <p>
            Schedule {schedule.active ? "active" : "paused"} · Occurrence:{" "}
            {view.status}
          </p>
        </div>
        <div className="recurring-bill-card__actions">
          <button type="button" onClick={onEdit} disabled={disabled}>
            Edit schedule
          </button>
          <button type="button" onClick={onToggle} disabled={disabled}>
            {schedule.active ? "Pause schedule" : "Resume schedule"}
          </button>
        </div>
      </header>

      <dl className="recurring-bill-summary">
        <div>
          <dt>Next expected date</dt>
          <dd>
            {view.nextExpectedDate ? (
              <time dateTime={view.nextExpectedDate}>
                {formatRecurringCalendarDate(view.nextExpectedDate)}
              </time>
            ) : (
              "No future occurrence"
            )}
          </dd>
        </div>
        {view.pendingCount + view.dueCount > 0 ? (
          <div>
            <dt>Oldest unresolved date</dt>
            <dd>
              <time dateTime={view.oldestPendingDate ?? undefined}>
                {view.oldestPendingDate
                  ? formatRecurringCalendarDate(view.oldestPendingDate)
                  : "Date unavailable"}
              </time>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Pending occurrences</dt>
          <dd>{view.pendingCount}</dd>
        </div>
        <div>
          <dt>Due occurrences</dt>
          <dd>{view.dueCount}</dd>
        </div>
        <div>
          <dt>Amount estimate</dt>
          <dd className="money-column recurring-bill-amount-estimate">
            <AmountEstimateDisplay
              estimate={view.amountEstimate}
              currency={schedule.documentCurrency}
            />
          </dd>
        </div>
        <div>
          <dt>Calendar anchor</dt>
          <dd>
            <time dateTime={schedule.anchorDate}>
              {formatRecurringCalendarDate(schedule.anchorDate)}
            </time>
          </dd>
        </div>
      </dl>

      {schedule.descriptionMatchText ? (
        <p className="recurring-bill-description-match">
          Description {schedule.descriptionMatchMode} match:{" "}
          {schedule.descriptionMatchText}
        </p>
      ) : null}
      <p className="recurring-bill-description-match">
        Match window: {schedule.daysEarly} days early · {schedule.daysLate} days
        late
      </p>

      <ol className="recurring-bill-occurrences">
        {view.occurrences.map((occurrence) => (
          <OccurrenceRow
            key={occurrence.expectedDate}
            scheduleId={schedule.id}
            occurrence={occurrence}
            disabled={disabled}
            selectedCandidate={
              candidateSelections[
                occurrenceKey(schedule.id, occurrence.expectedDate)
              ] ?? ""
            }
            onCandidateChange={(transactionId) =>
              onCandidateChange(occurrence.expectedDate, transactionId)
            }
            onLink={() => onLink(occurrence)}
            onUnlink={() => onUnlink(occurrence)}
            reportingTimezone={reportingTimezone}
          />
        ))}
      </ol>
      {reviewAssociations.length > 0 ? (
        <details className="recurring-bill-association-details">
          <summary>
            Linked occurrence details ({reviewAssociations.length})
          </summary>
          <ol className="recurring-bill-occurrences">
            {reviewAssociations.map((occurrence) => (
              <OccurrenceRow
                key={occurrence.expectedDate}
                scheduleId={schedule.id}
                occurrence={occurrence}
                disabled={disabled}
                selectedCandidate={
                  candidateSelections[
                    occurrenceKey(schedule.id, occurrence.expectedDate)
                  ] ?? ""
                }
                onCandidateChange={(transactionId) =>
                  onCandidateChange(occurrence.expectedDate, transactionId)
                }
                onLink={() => onLink(occurrence)}
                onUnlink={() => onUnlink(occurrence)}
                reportingTimezone={reportingTimezone}
              />
            ))}
          </ol>
        </details>
      ) : null}
      {pageStatus === "error" ? (
        <p className="recurring-bill-page-error" role="alert">
          More unresolved occurrences could not be loaded. Retry to continue.
        </p>
      ) : null}
      {pageStatus === "stale" ? (
        <p className="recurring-bill-page-error" role="alert">
          The schedule changed while more occurrences were loading. Refresh the
          schedule before continuing.
        </p>
      ) : null}
      {pageStatus === "stale" ? (
        <button type="button" onClick={onRefresh} disabled={disabled}>
          Refresh schedule
        </button>
      ) : typeof view.nextUnresolvedOffset === "number" ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={disabled || pageStatus === "loading"}
          aria-label={
            pageStatus === "error"
              ? undefined
              : `Show more missing occurrences for ${schedule.label}`
          }
        >
          {pageStatus === "loading"
            ? "Loading more occurrences…"
            : pageStatus === "error"
              ? "Retry loading missing occurrences"
              : "Show more missing occurrences"}
        </button>
      ) : null}
    </article>
  );
};

const OccurrenceRow = ({
  scheduleId,
  occurrence,
  disabled,
  selectedCandidate,
  onCandidateChange,
  onLink,
  onUnlink,
  reportingTimezone,
}: {
  scheduleId: string;
  occurrence: RecurringBillOccurrence;
  disabled: boolean;
  selectedCandidate: string;
  onCandidateChange: (transactionId: string) => void;
  onLink: () => void;
  onUnlink: () => void;
  reportingTimezone: string;
}) => {
  const linkedTransactionId = occurrence.association?.transactionId;
  const effectiveTransactionId = occurrence.transactionId;

  return (
    <li className="recurring-bill-occurrence">
      <div className="recurring-bill-occurrence__date">
        <time dateTime={occurrence.expectedDate}>
          {formatRecurringCalendarDate(occurrence.expectedDate)}
        </time>
        {occurrence.status ? (
          <span
            className={`recurring-bill-status recurring-bill-status--${occurrence.status.toLocaleLowerCase()}`}
          >
            {occurrence.status}
          </span>
        ) : occurrence.isComplete ? (
          <span className="recurring-bill-recorded-state">Recorded</span>
        ) : null}
      </div>

      <div className="recurring-bill-occurrence__details">
        {linkedTransactionId ? (
          <>
            <p>
              {occurrence.association?.eligible
                ? "Explicitly linked transaction:"
                : "Linked transaction is no longer eligible:"}{" "}
              <a href={transactionHref(linkedTransactionId)}>
                {occurrence.association?.transaction
                  ? candidateLabel(
                      occurrence.association.transaction,
                      reportingTimezone,
                    )
                  : `Transaction ${linkedTransactionId}`}
              </a>
            </p>
            {!occurrence.association?.eligible ? (
              <p className="recurring-bill-occurrence__warning">
                Remove this link or update the transaction before this
                occurrence can be completed.
              </p>
            ) : null}
            <button type="button" onClick={onUnlink} disabled={disabled}>
              Unlink transaction
            </button>
          </>
        ) : effectiveTransactionId ? (
          <p>
            Matched recorded transaction:{" "}
            <a href={transactionHref(effectiveTransactionId)}>
              View transaction
            </a>
          </p>
        ) : (occurrence.status === "Pending" || occurrence.status === "Due") &&
          occurrence.candidates.length ? (
          <div className="recurring-bill-candidate-control">
            <label>
              Candidate transaction for{" "}
              {formatRecurringCalendarDate(occurrence.expectedDate)}
              <span className="recurring-bill-candidate-help">
                Choose one matching recorded transaction. The schedule changes
                only after you select and link it.
              </span>
              <AutocompleteSelect
                aria-label={`Candidate transaction for ${scheduleId} ${formatRecurringCalendarDate(occurrence.expectedDate)}`}
                value={selectedCandidate}
                onValueChange={onCandidateChange}
                disabled={disabled}
                placeholder="Choose a matching transaction"
              >
                <option value="">Choose a matching transaction</option>
                {occurrence.candidates.map((candidate) => (
                  <option value={candidate.id} key={candidate.id}>
                    {candidateLabel(candidate, reportingTimezone)}
                  </option>
                ))}
              </AutocompleteSelect>
            </label>
            <button
              type="button"
              onClick={onLink}
              disabled={disabled || !selectedCandidate}
            >
              Link selected transaction
            </button>
          </div>
        ) : occurrence.status === "Pending" || occurrence.status === "Due" ? (
          <p>
            No eligible recorded transaction matches this occurrence. Record the
            supplier expense, then refresh this page.
          </p>
        ) : occurrence.status === "Upcoming" ? (
          <p>No transaction is currently linked to this occurrence.</p>
        ) : (
          <p>Recorded transaction details are unavailable.</p>
        )}
      </div>
    </li>
  );
};

const previewResultLabel = (
  result: RecurringBillPreviewResult["rows"][number]["result"],
) => {
  if (result === "aligned") return "On cadence";
  if (result === "misaligned") return "Outside cadence window";
  if (result === "description_mismatch") return "Description mismatch";
  if (result === "missing_date") return "Date unavailable";
  return "Ambiguous";
};

const RecurringBillPreviewPanel = ({
  preview,
  valid,
  currency,
  disabled,
  onRetry,
}: {
  preview: RecurringBillPreviewState | null;
  valid: boolean;
  currency: string;
  disabled: boolean;
  onRetry: () => void;
}) => {
  const result = preview?.status === "success" ? preview.result : null;

  return (
    <section
      className="recurring-bill-preview"
      aria-labelledby="recurring-bill-preview-heading"
    >
      <div className="recurring-bill-preview__header">
        <div>
          <h3 id="recurring-bill-preview-heading">Matching preview</h3>
          <p>
            Read-only check of recorded transactions against this rule. Existing
            links or overlapping schedules may prevent automatic matching.
            On-cadence counts include ambiguous candidates.
          </p>
        </div>
        <button type="button" onClick={onRetry} disabled={!valid || disabled}>
          Check matches
        </button>
      </div>
      {!valid ? (
        <p role="status">
          Enter valid matching fields to preview recorded transactions.
        </p>
      ) : preview?.status === "error" ? (
        <p className="recurring-bill-preview__error" role="alert">
          The preview could not be loaded. Check your connection and retry.
        </p>
      ) : !result ? (
        <p role="status" aria-live="polite">
          Checking recorded transactions…
        </p>
      ) : (
        <>
          <dl className="recurring-bill-preview-counts">
            <div>
              <dt>Description matches</dt>
              <dd>{result.descriptionMatchCount}</dd>
            </div>
            <div>
              <dt>On cadence</dt>
              <dd>{result.onCadenceCount}</dd>
            </div>
            <div>
              <dt>Misaligned</dt>
              <dd>{result.misalignedCount}</dd>
            </div>
            <div>
              <dt>Ambiguous</dt>
              <dd>{result.ambiguousCount}</dd>
            </div>
            <div className="recurring-bill-preview__estimate">
              <dt>Amount estimate</dt>
              <dd>
                <AmountEstimateDisplay
                  estimate={result.amountEstimate}
                  currency={currency}
                />
              </dd>
            </div>
          </dl>
          {result.rows.length === 0 ? (
            <p className="recurring-bill-preview__empty">
              No recorded transaction candidates were found.
            </p>
          ) : (
            <div className="recurring-bill-preview__table-scroll">
              <table>
                <caption>Recorded transaction candidates</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col">Expected date</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr
                      key={`${row.transactionId}:${row.date ?? "no-date"}:${index}`}
                    >
                      <td>
                        {row.date ? (
                          <time dateTime={row.date}>
                            {formatRecurringCalendarDate(row.date)}
                          </time>
                        ) : (
                          "Date unavailable"
                        )}
                      </td>
                      <td>
                        <span>{row.description ?? "No description"}</span>
                        <span
                          className={
                            row.descriptionMatches
                              ? "recurring-bill-preview__match"
                              : "recurring-bill-preview__mismatch"
                          }
                        >
                          {row.descriptionMatches
                            ? "Description matches"
                            : "Description does not match"}
                        </span>
                      </td>
                      <td>
                        {row.expectedDate ? (
                          <time dateTime={row.expectedDate}>
                            {formatRecurringCalendarDate(row.expectedDate)}
                          </time>
                        ) : (
                          "No expected date"
                        )}
                        {row.dayOffset !== null ? (
                          <span className="recurring-bill-preview__offset">
                            {row.dayOffset > 0 ? "+" : ""}
                            {row.dayOffset} days
                          </span>
                        ) : null}
                      </td>
                      <td>{previewResultLabel(row.result)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
};

const ScheduleEditorForm = ({
  editor,
  responsibleUserOptions,
  counterparties,
  disabled,
  descriptionPatternError,
  preview,
  previewValid,
  onRetryPreview,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: ScheduleEditor;
  responsibleUserOptions: Workspace["responsibleUserOptions"];
  counterparties: Workspace["counterparties"];
  disabled: boolean;
  descriptionPatternError: string | null | undefined;
  preview: RecurringBillPreviewState | null;
  previewValid: boolean;
  onRetryPreview: () => void;
  onChange: (
    field: keyof RecurringBillScheduleInput,
    value: string | number | null,
  ) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) => {
  const { schedule } = editor;
  const suggestion = editor.mode === "suggestion";
  const sourcePrefill = editor.mode === "source";
  const hasSupportingRecords = suggestion || sourcePrefill;

  return (
    <section
      className="recurring-bill-editor"
      aria-labelledby="recurring-bill-editor-heading"
    >
      <h2 id="recurring-bill-editor-heading">
        {editor.mode === "edit"
          ? "Edit recurring bill schedule"
          : suggestion
            ? "Review suggested schedule"
            : sourcePrefill
              ? "Review schedule from transaction"
              : "Add recurring bill schedule"}
      </h2>
      {hasSupportingRecords ? (
        <div className="recurring-bill-suggestion-review">
          <p>
            {suggestion
              ? "This suggestion is only a draft. Review and edit the fields, then confirm to create an active schedule."
              : "This schedule is prefilled from the selected recorded expense. Review and edit the fields, then confirm to create an active schedule."}
          </p>
          <p>
            Supporting dates:{" "}
            {editor.occurrenceDates.map((date, dateIndex) => (
              <span key={date}>
                {dateIndex > 0 ? ", " : null}
                <time dateTime={date}>{formatRecurringCalendarDate(date)}</time>
              </span>
            ))}
          </p>
          <ul className="recurring-bills-source-list">
            {editor.sourceTransactionIds.map((id) => (
              <li key={id}>
                <a href={transactionHref(id)}>Source transaction {id}</a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form className="recurring-bill-form" onSubmit={onSubmit}>
        <div className="recurring-bill-fields">
          <label>
            Schedule name
            <input
              autoComplete="off"
              maxLength={200}
              required
              value={schedule.label}
              onChange={(event) => onChange("label", event.currentTarget.value)}
            />
          </label>
          <label>
            Supplier or counterparty
            <CreatableAutocomplete
              aria-label="Supplier or counterparty"
              id="recurring-bill-counterparty"
              value={schedule.counterparty}
              options={counterparties}
              onValueChange={(value) => onChange("counterparty", value)}
              disabled={disabled}
              required
              maxLength={300}
              placeholder="Enter or choose a counterparty"
            />
          </label>
          <label>
            Frequency
            <AutocompleteSelect
              aria-label="Frequency"
              value={schedule.frequency}
              onValueChange={(value) => onChange("frequency", value)}
              disabled={disabled}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </AutocompleteSelect>
          </label>
          <label>
            First expected bill date (calendar anchor)
            <input
              type="date"
              required
              value={schedule.anchorDate}
              onChange={(event) =>
                onChange("anchorDate", event.currentTarget.value)
              }
            />
          </label>
          <label>
            Document currency
            <input
              autoComplete="off"
              maxLength={3}
              pattern="[A-Za-z]{3}"
              required
              value={schedule.documentCurrency}
              onChange={(event) =>
                onChange(
                  "documentCurrency",
                  event.currentTarget.value.toUpperCase(),
                )
              }
            />
          </label>
          <label className="recurring-bill-fields__wide">
            Description match mode
            <AutocompleteSelect
              aria-label="Description match mode"
              value={schedule.descriptionMatchMode}
              onValueChange={(value) => onChange("descriptionMatchMode", value)}
              disabled={disabled}
            >
              <option value="contains">Contains</option>
              <option value="regex">Regex</option>
            </AutocompleteSelect>
          </label>
          <label className="recurring-bill-fields__wide">
            Description{" "}
            {schedule.descriptionMatchMode === "regex"
              ? "pattern"
              : "match text"}{" "}
            (optional)
            <input
              autoComplete="off"
              maxLength={2_000}
              aria-label={
                schedule.descriptionMatchMode === "regex"
                  ? "Description pattern"
                  : "Description match text"
              }
              aria-invalid={descriptionPatternError ? "true" : undefined}
              aria-describedby={
                descriptionPatternError
                  ? "recurring-bill-description-pattern-error"
                  : "recurring-bill-description-match-help"
              }
              value={schedule.descriptionMatchText ?? ""}
              onChange={(event) =>
                onChange("descriptionMatchText", event.currentTarget.value)
              }
            />
            <span
              id="recurring-bill-description-match-help"
              className="recurring-bill-field-help"
            >
              Contains checks a case-insensitive substring. Regex checks a raw,
              case-insensitive pattern. Leave blank to match any description.
            </span>
            {descriptionPatternError ? (
              <span
                id="recurring-bill-description-pattern-error"
                className="recurring-bill-field-error"
                role="alert"
              >
                {descriptionPatternError}
              </span>
            ) : null}
          </label>
          <label>
            Match window before expected date (days)
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              required
              value={
                Number.isFinite(schedule.daysEarly) ? schedule.daysEarly : ""
              }
              onChange={(event) =>
                onChange(
                  "daysEarly",
                  event.currentTarget.value === ""
                    ? Number.NaN
                    : event.currentTarget.valueAsNumber,
                )
              }
            />
          </label>
          <label>
            Grace period after expected date (days)
            <input
              type="number"
              min={0}
              max={365}
              step={1}
              required
              value={
                Number.isFinite(schedule.daysLate) ? schedule.daysLate : ""
              }
              onChange={(event) =>
                onChange(
                  "daysLate",
                  event.currentTarget.value === ""
                    ? Number.NaN
                    : event.currentTarget.valueAsNumber,
                )
              }
            />
          </label>
          <label className="recurring-bill-fields__wide">
            Responsible user (optional)
            <AutocompleteSelect
              aria-label="Responsible user"
              value={schedule.responsibleUserId ?? ""}
              onValueChange={(value) =>
                onChange("responsibleUserId", value || null)
              }
              disabled={disabled}
              placeholder="No responsible user"
            >
              <option value="">No responsible user</option>
              {responsibleUserOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </AutocompleteSelect>
          </label>
        </div>
        <RecurringBillPreviewPanel
          preview={preview}
          valid={previewValid}
          currency={schedule.documentCurrency}
          disabled={disabled}
          onRetry={onRetryPreview}
        />
        <div className="recurring-bill-form__actions">
          <button type="submit" disabled={disabled}>
            {editor.mode === "edit"
              ? "Save changes"
              : hasSupportingRecords
                ? "Confirm and save schedule"
                : "Save schedule"}
          </button>
          <button type="button" onClick={onCancel} disabled={disabled}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
};

export const Route = createFileRoute("/transactions_/recurring")({
  validateSearch: z.object({
    sourceTransactionId: z.string().uuid().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    sourceTransactionId: search.sourceTransactionId,
  }),
  loader: async ({ deps }) => {
    const workspace = deps.sourceTransactionId
      ? await getRecurringBillsWorkspace({
          data: { sourceTransactionId: deps.sourceTransactionId },
        })
      : await getRecurringBillsWorkspace();
    return {
      ...workspace,
      sourceTransactionId: deps.sourceTransactionId ?? null,
    };
  },
  pendingComponent: () => (
    <main className="recurring-bills-page recurring-bills-state">
      <p role="status" aria-live="polite">
        Loading recurring bills…
      </p>
    </main>
  ),
  errorComponent: RecurringBillsError,
  component: RecurringBillsPage,
});
