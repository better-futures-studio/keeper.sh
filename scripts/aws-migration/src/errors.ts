class MigrationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
  }
}

const isMigrationError = (error: unknown): error is MigrationError =>
  error instanceof MigrationError;

const publicErrorMessage = (error: unknown): string => {
  if (isMigrationError(error)) {
    return error.message;
  }
  return "Migration failed";
};

export { MigrationError, isMigrationError, publicErrorMessage };
