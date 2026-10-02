ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  DROP CONSTRAINT "transactions_kind_check";

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_kind_check"
  CHECK ("kind" IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'dispute', 'transfer', 'owner_contribution', 'owner_loan', 'owner_loan_repayment', 'adjustment'));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_loan_repayment_owner_check"
  CHECK ("kind" <> 'owner_loan_repayment' OR "owner_id" IS NOT NULL);

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_loan_repayment_amount_check"
  CHECK ("kind" <> 'owner_loan_repayment' OR ("document_amount" IS NOT NULL AND "document_amount" > 0));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_loan_repayment_settlement_check"
  CHECK ("kind" <> 'owner_loan_repayment' OR "settlement_amount" IS NULL OR "settlement_amount" > 0);

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  DROP CONSTRAINT "transactions_owner_gst_check";

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_gst_check"
  CHECK ("kind" NOT IN ('owner_contribution', 'owner_loan', 'owner_loan_repayment') OR ("gst_credit_status" IN ('not_claimable', 'not_registered') AND coalesce("claimable_gst_aud", 0) = 0));

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  DROP CONSTRAINT "transactions_owner_tax_check";

ALTER TABLE "__FOLIO_SCHEMA__"."transactions"
  ADD CONSTRAINT "transactions_owner_tax_check"
  CHECK ("kind" NOT IN ('owner_contribution', 'owner_loan', 'owner_loan_repayment') OR ("tax_treatment" = 'no_tax' AND coalesce("document_tax_amount", 0) = 0));

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."validate_bank_match"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE target record;
DECLARE expected_amount numeric(19,4);
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."matched_transaction_id" IS NOT NULL
    AND NEW."matched_transaction_id" IS NOT NULL
    AND OLD."matched_transaction_id" IS DISTINCT FROM NEW."matched_transaction_id" THEN
    RAISE EXCEPTION 'Reset the bank transaction before assigning a different match';
  END IF;

  IF NEW."matched_transaction_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO target
  FROM "__FOLIO_SCHEMA__"."transactions"
  WHERE "id" = NEW."matched_transaction_id"
  FOR UPDATE;

  IF NOT FOUND
    OR target."source_system" <> 'manual'
    OR target."status" <> 'recorded'
    OR target."settled_at" IS NULL
    OR target."settlement_currency" <> 'AUD'
    OR target."settlement_amount" IS NULL
    OR target."kind" NOT IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'owner_contribution', 'owner_loan', 'owner_loan_repayment') THEN
    RAISE EXCEPTION 'Transaction is not eligible for bank matching';
  END IF;

  expected_amount := CASE
    WHEN target."kind" IN ('sale', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN target."settlement_amount"
    ELSE -target."settlement_amount"
  END;
  IF expected_amount <> NEW."amount_aud" THEN
    RAISE EXCEPTION 'Transaction cash effect does not equal bank movement';
  END IF;
  RETURN NEW;
END
$folio$;

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."protect_matched_transaction_fields"() RETURNS trigger LANGUAGE plpgsql AS $folio$
DECLARE matched_amount numeric(19,4);
DECLARE expected_amount numeric(19,4);
BEGIN
  IF OLD."source_system" IS NOT DISTINCT FROM NEW."source_system"
    AND OLD."status" IS NOT DISTINCT FROM NEW."status"
    AND OLD."kind" IS NOT DISTINCT FROM NEW."kind"
    AND OLD."settled_at" IS NOT DISTINCT FROM NEW."settled_at"
    AND OLD."settlement_currency" IS NOT DISTINCT FROM NEW."settlement_currency"
    AND OLD."settlement_amount" IS NOT DISTINCT FROM NEW."settlement_amount" THEN
    RETURN NEW;
  END IF;

  SELECT "amount_aud" INTO matched_amount
  FROM "__FOLIO_SCHEMA__"."bank_transactions"
  WHERE "matched_transaction_id" = OLD."id";

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW."source_system" IS DISTINCT FROM 'manual'
    OR NEW."status" IS DISTINCT FROM 'recorded'
    OR NEW."settled_at" IS NULL
    OR NEW."settlement_currency" IS DISTINCT FROM 'AUD'
    OR NEW."settlement_amount" IS NULL
    OR NEW."kind" IS NULL
    OR NEW."kind" NOT IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'owner_contribution', 'owner_loan', 'owner_loan_repayment') THEN
    RAISE EXCEPTION 'Keep the recorded AUD amount and direction, or unmatch the bank transaction before this edit';
  END IF;

  expected_amount := CASE
    WHEN NEW."kind" IN ('sale', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN NEW."settlement_amount"
    ELSE -NEW."settlement_amount"
  END;
  IF expected_amount IS DISTINCT FROM matched_amount THEN
    RAISE EXCEPTION 'Keep the recorded AUD amount and direction, or unmatch the bank transaction before this edit';
  END IF;

  RETURN NEW;
END
$folio$;
