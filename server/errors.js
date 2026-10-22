export class HttpError extends Error {
  // code is an optional machine-readable reason the client can branch on (e.g. 'MERGE_AVAILABLE').
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}
