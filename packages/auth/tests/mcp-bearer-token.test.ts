import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { afterAll, describe, expect, it } from "vitest";
import { createAuth, isKeeperMcpEnabledAuth } from "../src/index";

const BASE_URL = "https://keeper.example";
const RESOURCE_URL = "https://mcp.keeper.example";
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

const createFixture = async () => {
  const keys = await crypto.subtle.generateKey({
    name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256",
  }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ keys: [{ ...publicKey, kid: "test", alg: "RS256", use: "sig" }] }),
  });
  const { auth } = createAuth({
    database: {} as BunSQLDatabase,
    baseUrl: BASE_URL,
    mcpResourceUrl: RESOURCE_URL,
    mcpApiBaseUrl: `http://127.0.0.1:${server.port}`,
    secret: "test-only-mcp-bearer-verification-secret",
  });
  if (!isKeeperMcpEnabledAuth(auth)) {
    throw new Error("MCP methods were not registered");
  }
  const { api } = auth;
  return { keys, server, api };
};
const fixture = createFixture();
const getSession = async (requestHeaders: Headers) => {
  const { api } = await fixture;
  return api.getMcpSession({ headers: requestHeaders });
};

const token = async (overrides: Record<string, unknown> = {}) => {
  const { keys } = await fixture;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `${BASE_URL}/api/auth`, aud: RESOURCE_URL, sub: "test-user",
    scope: "keeper:read", iat: now, exp: now + 60, ...overrides,
  };
  const unsigned = `${encode({ alg: "RS256", typ: "at+jwt", kid: "test" })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
};
const headers = (value: string) => new Headers({ authorization: `Bearer ${value}` });

describe("MCP bearer verification after the Better Auth upgrade", () => {
  afterAll(async () => {
    const { server } = await fixture;
    server.stop(true);
  });

  it("returns the verified subject and scopes", async () => {
    expect(await getSession(headers(await token()))).toEqual({
      userId: "test-user", scopes: "keeper:read",
    });
  });

  it.each([
    { iss: "https://untrusted.example/api/auth" },
    { aud: "https://another-resource.example" },
    { exp: 1 },
  ])("rejects invalid issuer, audience or expiry: %j", async (claims) => {
    await expect(getSession(headers(await token(claims)))).rejects.toBeDefined();
  });

  it("rejects a modified signature", async () => {
    const valid = await token();
    const [header, payload, signature] = valid.split(".");
    let replacement = "A";
    if (signature?.startsWith("A")) {
      replacement = "B";
    }
    const modified = `${header}.${payload}.${replacement}${signature?.slice(1)}`;
    await expect(getSession(headers(modified))).rejects.toBeDefined();
  });

  it("returns no session when no bearer token is supplied", async () => {
    expect(await getSession(new Headers())).toBeNull();
  });
});
