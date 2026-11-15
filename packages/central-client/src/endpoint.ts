import { CentralClientError } from "./errors";

/** Transport policy: https always; http://localhost only when the explicit dev flag is on. */
export function isAllowedEndpoint(value: string, allowInsecureLocalhost: boolean): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return allowInsecureLocalhost && url.protocol === "http:" && url.hostname === "localhost";
}

/** Parses an absolute URL with no credentials, query or fragment, and an allowed transport. */
export function parseStrictUrl(value: unknown, allowInsecureLocalhost: boolean, field: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048 || /[\r\n]/.test(value)) {
    throw new CentralClientError("config_invalid", `${field} must be an absolute URL`);
  }
  if (!isAllowedEndpoint(value, allowInsecureLocalhost)) {
    throw new CentralClientError("config_invalid", `${field} must use https`);
  }
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new CentralClientError("config_invalid", `${field} must not carry credentials, query or fragment`);
  }
  return url;
}
