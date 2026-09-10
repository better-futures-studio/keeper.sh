import arkenv from "arkenv";

const schema = {
  ALLOWED_SIGNUP_DOMAINS: "string?",
  API_PORT: "number",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  CREDENTIAL_LOGIN_ENABLED: "boolean?",
  DATABASE_POOL_MAX: "number?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  MCP_API_URL: "string.url?",
  MCP_PUBLIC_URL: "string.url?",
  PASSKEY_ORIGIN: "string?",
  PASSKEY_RP_ID: "string?",
  PASSKEY_RP_NAME: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  POLAR_WEBHOOK_SECRET: "string?",
  REDIS_URL: "string.url",
  RESEND_API_KEY: "string?",
  SOCIAL_LOGIN_PROVIDERS: "string?",
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  TRUSTED_ORIGINS: "string?",
  WEBHOOK_PUBLIC_URL: "string.url?",
  WEBSOCKET_URL: "string.url?",
} as const;

export { schema };
export default arkenv(schema);
