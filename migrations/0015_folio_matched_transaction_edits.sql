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
    OR NEW."kind" NOT IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN
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
