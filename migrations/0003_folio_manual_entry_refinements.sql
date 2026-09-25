ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD COLUMN "tax_treatment" text NOT NULL DEFAULT 'unknown_mixed';

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  DROP CONSTRAINT "transactions_kind_check";

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_kind_check"
  CHECK ("kind" IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'dispute', 'transfer', 'owner_contribution', 'owner_loan', 'adjustment'));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_tax_treatment_check"
  CHECK ("tax_treatment" IN ('gst_included', 'gst_separately_shown', 'foreign_tax_included', 'no_tax', 'unknown_mixed'));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_amount_check"
  CHECK ("kind" NOT IN ('owner_contribution', 'owner_loan') OR "document_amount" > 0);

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_gst_check"
  CHECK ("kind" NOT IN ('owner_contribution', 'owner_loan') OR ("gst_credit_status" IN ('not_claimable', 'not_registered') AND coalesce("claimable_gst_aud", 0) = 0));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_tax_check"
  CHECK ("kind" NOT IN ('owner_contribution', 'owner_loan') OR ("tax_treatment" = 'no_tax' AND coalesce("document_tax_amount", 0) = 0));
