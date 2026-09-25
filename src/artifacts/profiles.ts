import { z } from "zod";

export const artifactProfileSchema = z.enum([
  "manual_invoice_pdf_v1",
  "stripe_balance_itemised_csv_v1",
  "commbank_transaction_history_csv_v1",
  "commbank_statement_pdf_v1",
  "nab_transaction_history_csv_v1",
]);

export type ArtifactProfile = z.infer<typeof artifactProfileSchema>;

export type ArtifactPurpose = "invoice_evidence" | "bank_activity";

export interface ArtifactProfileDefinition {
  readonly profile: ArtifactProfile;
  readonly source: "manual" | "stripe" | "commbank" | "nab";
  readonly purpose: ArtifactPurpose;
  readonly mediaType: "application/pdf" | "text/csv";
  readonly extension: "pdf" | "csv";
  readonly evidenceEligible: boolean;
  readonly label: string;
}

const definitions = [
  {
    profile: "manual_invoice_pdf_v1",
    source: "manual",
    purpose: "invoice_evidence",
    mediaType: "application/pdf",
    extension: "pdf",
    evidenceEligible: true,
    label: "Invoice evidence PDF",
  },
  {
    profile: "stripe_balance_itemised_csv_v1",
    source: "stripe",
    purpose: "bank_activity",
    mediaType: "text/csv",
    extension: "csv",
    evidenceEligible: false,
    label: "Stripe balance CSV",
  },
  {
    profile: "commbank_transaction_history_csv_v1",
    source: "commbank",
    purpose: "bank_activity",
    mediaType: "text/csv",
    extension: "csv",
    evidenceEligible: false,
    label: "CommBank transaction history CSV",
  },
  {
    profile: "commbank_statement_pdf_v1",
    source: "commbank",
    purpose: "bank_activity",
    mediaType: "application/pdf",
    extension: "pdf",
    evidenceEligible: false,
    label: "CommBank statement PDF",
  },
  {
    profile: "nab_transaction_history_csv_v1",
    source: "nab",
    purpose: "bank_activity",
    mediaType: "text/csv",
    extension: "csv",
    evidenceEligible: false,
    label: "NAB transaction history CSV",
  },
] as const satisfies readonly ArtifactProfileDefinition[];

export const artifactProfiles: readonly ArtifactProfileDefinition[] =
  Object.freeze(definitions);

export const artifactProfileRegistry: Readonly<
  Record<ArtifactProfile, ArtifactProfileDefinition>
> = Object.freeze(
  Object.fromEntries(
    definitions.map((definition) => [definition.profile, definition]),
  ) as Record<ArtifactProfile, ArtifactProfileDefinition>,
);

export const getArtifactProfile = (
  profile: ArtifactProfile,
): ArtifactProfileDefinition => artifactProfileRegistry[profile];

export const isArtifactProfile = (value: unknown): value is ArtifactProfile =>
  artifactProfileSchema.safeParse(value).success;

export const isInvoiceEvidenceProfile = (
  profile: unknown,
): profile is "manual_invoice_pdf_v1" => profile === "manual_invoice_pdf_v1";

export const isArtifactEvidenceEligible = (
  profile: unknown,
): profile is "manual_invoice_pdf_v1" => isInvoiceEvidenceProfile(profile);

export const isBankArtifactProfile = (
  profile: unknown,
): profile is
  | "commbank_transaction_history_csv_v1"
  | "commbank_statement_pdf_v1"
  | "nab_transaction_history_csv_v1" =>
  isArtifactProfile(profile) &&
  ["commbank", "nab"].includes(getArtifactProfile(profile).source);

export const assertArtifactProfileMediaType = (
  profile: ArtifactProfile,
  mediaType: string,
): ArtifactProfileDefinition => {
  const definition = getArtifactProfile(profile);
  if (definition.mediaType !== mediaType)
    throw new Error("Media type does not match artifact profile");
  return definition;
};

export const legacyArtifactProfile = (
  kind: "pdf" | "stripe_csv",
): ArtifactProfile =>
  kind === "pdf" ? "manual_invoice_pdf_v1" : "stripe_balance_itemised_csv_v1";

export const legacyArtifactKind = (
  profile: ArtifactProfile,
): "pdf" | "stripe_csv" | undefined => {
  if (profile === "manual_invoice_pdf_v1") return "pdf";
  if (profile === "stripe_balance_itemised_csv_v1") return "stripe_csv";
  return undefined;
};
