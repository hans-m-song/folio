export const safeReturnPath = (
  value: string | null,
  origin: string,
): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const target = new URL(value, origin);
    return target.origin === origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/";
  } catch {
    return "/";
  }
};

export const cookieValue = (request: Request, name: string): string | null => {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) return rest.join("=") || null;
  }
  return null;
};

export const sessionCookie = (input: {
  name: string;
  value: string;
  secure: boolean;
  maxAgeSeconds: number;
}): string =>
  `${input.name}=${input.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${input.maxAgeSeconds}${input.secure ? "; Secure" : ""}`;

export const clearedSessionCookie = (name: string, secure: boolean): string =>
  `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
