/**
 * Custom error types for the Task Management Server.
 * These can be caught in the service layer and mapped to specific
 * McpError codes in the tool layer.
 */

// Example: Base service error
export class ServiceError extends Error {
  constructor(
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

// Example: Validation specific error
export class ValidationError extends ServiceError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = "ValidationError";
  }
}

// Example: Not found specific error
export class NotFoundError extends ServiceError {
  constructor(message: string = "Resource not found", details?: any) {
    super(message, details);
    this.name = "NotFoundError";
  }
}

// Example: Conflict specific error (e.g., trying to create something that exists)
export class ConflictError extends ServiceError {
  constructor(message: string = "Resource conflict", details?: any) {
    super(message, details);
    this.name = "ConflictError";
  }
}

// Add other custom error types as needed

// --- Repository Specific Errors ---

/**
 * Error indicating a resource was not found in the repository.
 */
export class RepositoryNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryNotFoundError";
  }
}

/**
 * Error indicating a conflict in the repository (e.g., unique constraint violation).
 */
export class RepositoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryConflictError";
  }
}

/**
 * Error indicating a foreign key constraint violation in the repository.
 */
export class RepositoryForeignKeyConstraintError extends Error {
  public originalError?: any; // Store the original SQLite error if needed

  constructor(message: string, originalError?: any) {
    super(message);
    this.name = "RepositoryForeignKeyConstraintError";
    this.originalError = originalError;
  }
}
