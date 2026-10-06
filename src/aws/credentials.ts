import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

export const createS3CredentialsProvider = (
  roleArn: string | null,
  region: string,
) => {
  const normalizedRoleArn = roleArn?.trim();
  if (!normalizedRoleArn) return undefined;

  return fromTemporaryCredentials({
    params: {
      RoleArn: normalizedRoleArn,
      RoleSessionName: "folio",
    },
    clientConfig: { region },
  });
};
