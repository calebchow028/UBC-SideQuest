declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Verified user id (Auth0 `sub`), set by the auth middleware. */
      userId?: string;
    }
  }
}

export {};
