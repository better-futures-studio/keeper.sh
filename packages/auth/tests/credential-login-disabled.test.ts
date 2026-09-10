import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-credential-login-disabled";

const createSocialOnlyAuth = () =>
  createAuth({
    baseUrl: BASE_URL,
    credentialLoginEnabled: false,
    database: {} as BunSQLDatabase,
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret",
    secret: SECRET,
  });

const postCredentialPath = (
  auth: ReturnType<typeof createSocialOnlyAuth>["auth"],
  path: string,
  body: Record<string, string>,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

describe("credential login disabled", () => {
  it("rejects username-only sign-up with FORBIDDEN", async () => {
    const { auth } = createSocialOnlyAuth();

    const response = await postCredentialPath(auth, "/username-only/sign-up", {
      password: "password123",
      username: "ada",
    });

    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      message: "Credential login is disabled",
    });
  });

  it("rejects username sign-in with FORBIDDEN", async () => {
    const { auth } = createSocialOnlyAuth();

    const response = await postCredentialPath(auth, "/sign-in/username", {
      password: "password123",
      username: "ada",
    });

    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      message: "Credential login is disabled",
    });
  });
});
