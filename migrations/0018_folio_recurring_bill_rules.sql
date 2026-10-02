ALTER TABLE "__FOLIO_SCHEMA__"."recurring_bill_schedules"
  ADD COLUMN "description_match_mode" text NOT NULL DEFAULT 'contains',
  ADD COLUMN "days_early" integer NOT NULL DEFAULT 3,
  ADD COLUMN "days_late" integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT "recurring_bill_schedules_description_match_mode_check"
    CHECK ("description_match_mode" IN ('contains', 'regex')),
  ADD CONSTRAINT "recurring_bill_schedules_days_early_check"
    CHECK ("days_early" BETWEEN 0 AND 365),
  ADD CONSTRAINT "recurring_bill_schedules_days_late_check"
    CHECK ("days_late" BETWEEN 0 AND 365);
