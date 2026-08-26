export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly expose = true,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UpstreamError extends AppError {
  constructor(message = "The analysis provider is temporarily unavailable", status = 502) {
    super(status, "UPSTREAM_UNAVAILABLE", message, true);
    this.name = "UpstreamError";
  }
}
