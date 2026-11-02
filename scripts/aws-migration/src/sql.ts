import { MigrationError } from "./errors";

const quoteIdent = (identifier: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new MigrationError(
      "SCHEMA_LAYOUT",
      "Refusing to quote an unexpected identifier",
    );
  }
  return `"${identifier}"`;
};

const toSnakeCase = (value: string): string =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

export { quoteIdent, toSnakeCase };
