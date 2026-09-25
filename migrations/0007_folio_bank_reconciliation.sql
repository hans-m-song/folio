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
    OR target."kind" NOT IN ('sale', 'supplier_expense', 'processing_fee', 'sale_refund', 'supplier_credit', 'owner_contribution', 'owner_loan') THEN
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

CREATE TRIGGER "bank_transactions_match_eligibility_trigger"
  BEFORE INSERT OR UPDATE OF "matched_transaction_id" ON "__FOLIO_SCHEMA__"."bank_transactions"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."validate_bank_match"();

CREATE OR REPLACE FUNCTION "__FOLIO_SCHEMA__"."protect_matched_transaction_fields"() RETURNS trigger LANGUAGE plpgsql AS $folio$
BEGIN
  IF OLD."source_system" IS NOT DISTINCT FROM NEW."source_system"
    AND OLD."status" IS NOT DISTINCT FROM NEW."status"
    AND OLD."kind" IS NOT DISTINCT FROM NEW."kind"
    AND OLD."settled_at" IS NOT DISTINCT FROM NEW."settled_at"
    AND OLD."settlement_currency" IS NOT DISTINCT FROM NEW."settlement_currency"
    AND OLD."settlement_amount" IS NOT DISTINCT FROM NEW."settlement_amount" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "__FOLIO_SCHEMA__"."bank_transactions"
    WHERE "matched_transaction_id" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'Unmatch the bank transaction before changing financial identity';
  END IF;
  RETURN NEW;
END
$folio$;

CREATE TRIGGER "transactions_matched_fields_immutable_trigger"
  BEFORE UPDATE ON "__FOLIO_SCHEMA__"."transactions"
  FOR EACH ROW EXECUTE FUNCTION "__FOLIO_SCHEMA__"."protect_matched_transaction_fields"();
