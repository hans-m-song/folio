import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";

import {
  recurringBillScheduleInputSchema,
  recurringBillTransactionDate,
  reportingDateForInstant,
  type RecurringBillScheduleInput,
  type RecurringBillView,
} from "../domain/recurring-bills";
import {
  operationPermissions,
  requirePermission,
  resolveAuthorizedActor,
} from "./authorization";
import { runOperation } from "./diagnostics";
import { runtime } from "./runtime";

const revisionSchema = z.string().datetime({ offset: true });

const saveRecurringBillSchema = z
  .object({
    id: z.string().uuid().optional(),
    expectedUpdatedAt: revisionSchema.optional(),
    schedule: recurringBillScheduleInputSchema,
  })
  .strict()
  .refine(
    (input) => Boolean(input.id) === Boolean(input.expectedUpdatedAt),
    "Existing schedules require an exact revision token",
  );

const recurringBillActiveSchema = z
  .object({
    id: z.string().uuid(),
    active: z.boolean(),
    expectedUpdatedAt: revisionSchema,
  })
  .strict();

const recurringBillAssociationSchema = z
  .object({
    scheduleId: z.string().uuid(),
    expectedDate: z.string().date(),
    expectedUpdatedAt: revisionSchema,
  })
  .strict();

const authorize = async (
  operation:
    | "getRecurringBillsWorkspace"
    | "getRecurringBillAttention"
    | "previewRecurringBill"
    | "saveRecurringBill"
    | "setRecurringBillActive"
    | "linkRecurringBillTransaction"
    | "unlinkRecurringBillTransaction",
) => {
  const current = runtime();
  const required = operationPermissions[operation];
  const actor = await resolveAuthorizedActor({
    token: getCookie(current.authConfig.sessionCookieName) ?? null,
    permission: required[0],
    session: (token) => current.auth.session(token),
  });
  for (const permission of required.slice(1))
    requirePermission(actor, permission);
  return { actor, current };
};

const readContext = (current: ReturnType<typeof runtime>) => {
  const asOfDate = reportingDateForInstant(
    new Date().toISOString(),
    current.config.reportingTimezone,
  );
  if (!asOfDate) throw new Error("Current recurring bill date is unavailable");
  return { timeZone: current.config.reportingTimezone, asOfDate };
};

const attention = (schedules: readonly RecurringBillView[]) => {
  const active = schedules.filter((view) => view.schedule.active);
  const pendingCount = active.reduce((sum, view) => sum + view.pendingCount, 0);
  const dueCount = active.reduce((sum, view) => sum + view.dueCount, 0);
  return { count: pendingCount + dueCount, pendingCount, dueCount };
};

export const getRecurringBillsWorkspace = createServerFn({
  method: "GET",
})
  .validator(
    z
      .object({
        sourceTransactionId: z.string().uuid().optional(),
        unresolvedOffset: z.number().int().min(0).max(120_000).optional(),
      })
      .strict()
      .optional()
      .default({}),
  )
  .handler(async ({ data }) =>
    runOperation("Load recurring bills", async () => {
      const { actor, current } = await authorize("getRecurringBillsWorkspace");
      const context = readContext(current);
      const source = data.sourceTransactionId
        ? await current.repository.getTransaction(
            actor.id,
            data.sourceTransactionId,
          )
        : null;
      const initialSchedule: RecurringBillScheduleInput | null =
        source?.kind === "supplier_expense" && source.status === "recorded"
          ? {
              label: source.counterparty?.slice(0, 200) || "Recurring bill",
              counterparty: source.counterparty ?? "",
              descriptionMatchText: source.description,
              descriptionMatchMode: "contains",
              daysEarly: 3,
              daysLate: 3,
              documentCurrency: source.documentCurrency ?? "AUD",
              expectedAmount: source.documentAmount,
              frequency: "monthly",
              anchorDate:
                recurringBillTransactionDate(source, context.timeZone) ??
                context.asOfDate,
              responsibleUserId: actor.id,
            }
          : null;
      const [schedules, suggestions, responsibleUserOptions, entrySuggestions] =
        await Promise.all([
          current.recurringBillRepository.list(actor.id, {
            ...context,
            ...(data.unresolvedOffset === undefined
              ? {}
              : { unresolvedOffset: data.unresolvedOffset }),
          }),
          current.recurringBillRepository.suggest(actor.id, {
            timeZone: context.timeZone,
          }),
          current.recurringBillRepository.listResponsibleUserOptions(actor.id),
          current.repository.listEntrySuggestions(actor.id),
        ]);
      return {
        schedules,
        suggestions,
        responsibleUserOptions,
        counterparties: entrySuggestions.counterparties,
        attention: attention(schedules),
        currentActorId: actor.id,
        reportingTimezone: context.timeZone,
        initialSchedule,
      };
    }),
  );

export const getRecurringBillAttention = createServerFn({
  method: "GET",
}).handler(async () =>
  runOperation("Load recurring bill attention", async () => {
    const { actor, current } = await authorize("getRecurringBillAttention");
    const schedules = await current.recurringBillRepository.list(
      actor.id,
      readContext(current),
    );
    return attention(schedules);
  }),
);

export const previewRecurringBill = createServerFn({ method: "POST" })
  .validator(z.object({ schedule: recurringBillScheduleInputSchema }).strict())
  .handler(async ({ data }) =>
    runOperation("Preview recurring bill", async () => {
      const { actor, current } = await authorize("previewRecurringBill");
      return current.recurringBillRepository.preview(actor.id, {
        schedule: data.schedule,
        ...readContext(current),
      });
    }),
  );

export const saveRecurringBill = createServerFn({ method: "POST" })
  .validator(saveRecurringBillSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Save recurring bill",
      async () => {
        const { actor, current } = await authorize("saveRecurringBill");
        return current.recurringBillRepository.save(actor.id, data);
      },
      {},
      { mutation: true },
    ),
  );

export const setRecurringBillActive = createServerFn({ method: "POST" })
  .validator(recurringBillActiveSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Change recurring bill activity",
      async () => {
        const { actor, current } = await authorize("setRecurringBillActive");
        return current.recurringBillRepository.setActive(actor.id, data);
      },
      {},
      { mutation: true },
    ),
  );

export const linkRecurringBillTransaction = createServerFn({ method: "POST" })
  .validator(
    recurringBillAssociationSchema.extend({ transactionId: z.string().uuid() }),
  )
  .handler(async ({ data }) =>
    runOperation(
      "Link recurring bill transaction",
      async () => {
        const { actor, current } = await authorize(
          "linkRecurringBillTransaction",
        );
        return current.recurringBillRepository.linkOccurrence(actor.id, {
          ...data,
          timeZone: current.config.reportingTimezone,
        });
      },
      {},
      { mutation: true },
    ),
  );

export const unlinkRecurringBillTransaction = createServerFn({ method: "POST" })
  .validator(recurringBillAssociationSchema)
  .handler(async ({ data }) =>
    runOperation(
      "Unlink recurring bill transaction",
      async () => {
        const { actor, current } = await authorize(
          "unlinkRecurringBillTransaction",
        );
        await current.recurringBillRepository.unlinkOccurrence(actor.id, data);
        return { unlinked: true as const };
      },
      {},
      { mutation: true },
    ),
  );
