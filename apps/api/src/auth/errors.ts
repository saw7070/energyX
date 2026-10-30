/** A sign-in or account failure with the HTTP status to answer with and a sentence the person can read. */
export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}
