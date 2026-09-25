import { FolioDiagnosticError } from "./diagnostics";

export const revisionConflictError = (): FolioDiagnosticError =>
  new FolioDiagnosticError({
    category: "database",
    code: "REVISION_CONFLICT",
    retryable: false,
  });

const revisionPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

const daysFromCivil = (year: bigint, month: bigint, day: bigint): bigint => {
  let adjustedYear = year;
  if (month <= 2n) adjustedYear -= 1n;
  const era = (adjustedYear >= 0n ? adjustedYear : adjustedYear - 399n) / 400n;
  const yearOfEra = adjustedYear - era * 400n;
  const monthPrime = month + (month > 2n ? -3n : 9n);
  const dayOfYear = (153n * monthPrime + 2n) / 5n + day - 1n;
  const dayOfEra =
    yearOfEra * 365n + yearOfEra / 4n - yearOfEra / 100n + dayOfYear;
  return era * 146097n + dayOfEra - 719468n;
};

const normaliseRevision = (value: string): bigint | undefined => {
  const match = revisionPattern.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return undefined;

  const zone = match[8]!;
  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (
    offsetMatch &&
    (Number(offsetMatch[2]) > 23 || Number(offsetMatch[3]) > 59)
  )
    return undefined;
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1] === "-" ? -1 : 1) *
      (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]))
    : 0;
  const microseconds = BigInt((match[7] ?? "").padEnd(6, "0"));
  const wholeSeconds =
    daysFromCivil(BigInt(year), BigInt(month), BigInt(day)) * 86_400n +
    BigInt(hour * 3_600 + minute * 60 + second) -
    BigInt(offsetMinutes * 60);
  return wholeSeconds * 1_000_000n + microseconds;
};

export function assertExpectedRevision(
  current: string,
  expectedUpdatedAt: string,
): void {
  const currentToken = normaliseRevision(current);
  const expectedToken = normaliseRevision(expectedUpdatedAt);
  if (
    currentToken === undefined ||
    expectedToken === undefined ||
    currentToken !== expectedToken
  )
    throw revisionConflictError();
}
