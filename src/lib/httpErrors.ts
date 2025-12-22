export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "HttpError";
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Resource not found") {
    super(404, message, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, message, "BAD_REQUEST");
    this.name = "BadRequestError";
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class InternalServerError extends HttpError {
  constructor(message = "Internal server error") {
    super(500, message, "INTERNAL_SERVER_ERROR");
    this.name = "InternalServerError";
  }
}

export class NotImplementedError extends HttpError {
  constructor(message = "Not implemented") {
    super(501, message, "NOT_IMPLEMENTED");
    this.name = "NotImplementedError";
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class ValidationError extends HttpError {
  constructor(message = "Validation error") {
    super(400, message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class PaymentRequiredError extends HttpError {
  constructor(message = "Payment required", code = "PAYMENT_REQUIRED") {
    super(402, message, code);
    this.name = "PaymentRequiredError";
  }
}

export class TooManyRequestsError extends HttpError {
  constructor(message = "Too many requests", code = "TOO_MANY_REQUESTS") {
    super(429, message, code);
    this.name = "TooManyRequestsError";
  }
}

