/** Single error type for the Central client. `code` is a stable, non-secret reason string. */
export class CentralClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string = code) {
    super(message);
    this.name = "CentralClientError";
    this.code = code;
  }
}
