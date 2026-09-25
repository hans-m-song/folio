import { randomUUID } from "node:crypto";

import {
  artifactProfileSchema,
  getArtifactProfile,
  legacyArtifactProfile,
  type ArtifactProfile,
} from "../artifacts/profiles";

export type ArtifactKind = "pdf" | "stripe_csv";
export type ArtifactKeyProfile = ArtifactProfile;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const legacyKindPattern = /^(pdf|stripe_csv)$/;

export function createObjectKey(
  prefix: string,
  profile: ArtifactProfile | ArtifactKind,
  id = randomUUID(),
): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\/$/.test(prefix) || prefix.includes("..")) {
    throw new Error("Invalid object prefix");
  }
  if (!uuidPattern.test(id)) throw new Error("Invalid opaque identifier");
  if (legacyKindPattern.test(profile)) return `${prefix}${profile}/${id}`;
  const parsedProfile = artifactProfileSchema.safeParse(profile);
  if (!parsedProfile.success) throw new Error("Invalid artifact profile");
  const extension = getArtifactProfile(parsedProfile.data).extension;
  return `${prefix}artifacts/${parsedProfile.data}/${id}.${extension}`;
}

export const createLegacyCompatibleObjectKey = (
  prefix: string,
  kind: ArtifactKind,
  id = randomUUID(),
): string => createObjectKey(prefix, legacyArtifactProfile(kind), id);
