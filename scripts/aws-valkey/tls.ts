import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TLS_HOST = "localhost";
const OPENSSL_SUCCESS = 0;

interface FixtureCertificates {
  authorityPem: string;
  directory: string;
  host: string;
}

const command = async (args: string[]): Promise<void> => {
  const processResult = Bun.spawn(args, { stderr: "pipe", stdout: "pipe" });
  const [output, errorOutput, exitCode] = await Promise.all([
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text(),
    processResult.exited,
  ]);
  if (exitCode !== OPENSSL_SUCCESS) {
    throw new Error(`openssl failed (${args[1] ?? "unknown"}): ${errorOutput || output}`);
  }
};

const writeCertificateAuthority = async (directory: string): Promise<string> => {
  const authorityKey = join(directory, "ca.key");
  const authorityCert = join(directory, "ca.crt");
  await command([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-days",
    "1",
    "-nodes",
    "-keyout",
    authorityKey,
    "-out",
    authorityCert,
    "-subj",
    "/CN=Keeper Valkey Fixture CA",
  ]);
  return Bun.file(authorityCert).text();
};

const writeServerCertificate = async (directory: string): Promise<void> => {
  const configPath = join(directory, "server.cnf");
  await writeFile(
    configPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "req_extensions = v3_req",
      "prompt = no",
      "[req_distinguished_name]",
      `CN = ${TLS_HOST}`,
      "[v3_req]",
      "subjectAltName = @alt_names",
      "keyUsage = digitalSignature, keyEncipherment",
      "extendedKeyUsage = serverAuth",
      "[alt_names]",
      `DNS.1 = ${TLS_HOST}`,
      "IP.1 = 127.0.0.1",
    ].join("\n"),
  );
  const serverKey = join(directory, "server.key");
  const serverRequest = join(directory, "server.csr");
  const serverCert = join(directory, "server.crt");
  await command([
    "openssl",
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    serverKey,
    "-out",
    serverRequest,
    "-config",
    configPath,
  ]);
  await command([
    "openssl",
    "x509",
    "-req",
    "-in",
    serverRequest,
    "-CA",
    join(directory, "ca.crt"),
    "-CAkey",
    join(directory, "ca.key"),
    "-CAcreateserial",
    "-out",
    serverCert,
    "-days",
    "1",
    "-sha256",
    "-extfile",
    configPath,
    "-extensions",
    "v3_req",
  ]);
};

const createFixtureCertificates = async (directory: string): Promise<FixtureCertificates> => {
  await mkdir(directory, { recursive: true });
  const authorityPem = await writeCertificateAuthority(directory);
  await writeServerCertificate(directory);
  return { authorityPem, directory, host: TLS_HOST };
};

export { createFixtureCertificates, TLS_HOST };
export type { FixtureCertificates };
