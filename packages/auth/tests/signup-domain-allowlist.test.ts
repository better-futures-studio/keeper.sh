import { PGlite } from "@electric-sql/pglite";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/index";

const BASE_URL = "http://localhost:3000";
const SECRET = "test-secret-for-signup-domain-allowlist";

const AUTH_DDL = `
create table "user" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "name" text not null,
  "updatedAt" timestamptz not null default now(),
  "username" text unique
);
create table "session" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "ipAddress" text,
  "token" text not null unique,
  "updatedAt" timestamptz not null default now(),
  "userAgent" text,
  "userId" text not null references "user"("id") on delete cascade
);
create table "account" (
  "id" text primary key,
  "accessToken" text,
  "accessTokenExpiresAt" timestamptz,
  "accountId" text not null,
  "createdAt" timestamptz not null default now(),
  "idToken" text,
  "password" text,
  "providerId" text not null,
  "refreshToken" text,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "updatedAt" timestamptz not null default now(),
  "userId" text not null references "user"("id") on delete cascade
);
create table "verification" (
  "id" text primary key,
  "createdAt" timestamptz not null default now(),
  "expiresAt" timestamptz not null,
  "identifier" text not null,
  "updatedAt" timestamptz not null default now(),
  "value" text not null
);
`;

const createHostedAuth = async (allowedSignupDomains?: string[]) => {
  const client = new PGlite();
  await client.exec(AUTH_DDL);

  const database = drizzle(client);
  const { auth } = createAuth({
    allowedSignupDomains,
    baseUrl: BASE_URL,
    commercialMode: true,
    database: database as unknown as BunSQLDatabase,
    secret: SECRET,
  });

  return { auth, database };
};

const signUp = (
  auth: Awaited<ReturnType<typeof createHostedAuth>>["auth"],
  email: string,
) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      body: JSON.stringify({
        email,
        name: "Test User",
        password: "password123",
      }),
      headers: { "content-type": "application/json", origin: BASE_URL },
      method: "POST",
    }),
  );

describe("signup domain allowlist", () => {
  it("creates a user whose email is on the list", async () => {
    const { auth, database } = await createHostedAuth(["heyjet.ai"]);

    const response = await signUp(auth, "ada@heyjet.ai");
    expect(response.status).toBe(200);

    const rows = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, "ada@heyjet.ai"));
    expect(rows).toHaveLength(1);
  });

  it("rejects an email off the list with FORBIDDEN", async () => {
    const { auth, database } = await createHostedAuth(["heyjet.ai"]);

    const response = await signUp(auth, "ada@example.com");
    expect(response.status).toBe(403);

    const body: unknown = await response.json();
    expect(body).toMatchObject({
      message: "Sign-ups are limited to heyjet.ai",
    });

    const rows = await database.select().from(userTable);
    expect(rows).toHaveLength(0);
  });

  it("allows any email when no list is set", async () => {
    const { auth, database } = await createHostedAuth();

    const response = await signUp(auth, "anyone@example.com");
    expect(response.status).toBe(200);

    const rows = await database
      .select()
      .from(userTable)
      .where(eq(userTable.email, "anyone@example.com"));
    expect(rows).toHaveLength(1);
  });
});
