# AWS-only Keeper transfer

Production data moves inside AWS only. The driver never drops, overwrites, or renames an existing target database, and it never writes the Railway source. Child stdout/stderr and database error details are suppressed; failures report only a fixed phase label. No credentials are passed as process arguments.

## Image

Build the application image first, then the transfer image. Preserve earlier immutable migration tags:

```sh
docker build -f docker/aws/Dockerfile -t boca-keeper:a79f73d-migration6 .
docker build -f docker/aws/Migration.Dockerfile -t boca-keeper-transfer:test .
(cd scripts/aws-transfer && bun test)
```

`Migration.Dockerfile` copies `FROM boca-keeper:a79f73d-migration6`. Pin the final transfer image by its registry digest in the one-off ECS task. PostgreSQL 18.6, Bun 1.3.11 and AWS CLI 2.31.17 use pinned upstream digests. The supplied AWS CLI digest reports 2.31.17, despite initially being identified as 2.31.18; the Dockerfile labels the verified version.

The public Amazon RDS us-east-2 CA bundle is copied to `/app/certs/aws-rds-us-east-2.pem`. See [certs README](../../docker/aws/certs/README.md) for the source URL and SHA256.

## Production contract

Run only as an ECS task in account `491565008757`, region `us-east-2`, cluster `shared-host`. Set UID/GID `65532:65532`, a read-only root filesystem and `/tmp` as a 512 MiB tmpfs with `noexec,nosuid,nodev`. Do not mount persistent storage at `/tmp`. The ECS, mount, account and target guards stay enabled; they are not relaxed for local tests.

Central RDS PostgreSQL 18.6 must not set `db_name=keeper`. The driver connects `bocapro_data_admin` to built-in `/postgres` first with the same managed host and `sslmode=verify-full`, checks NONSUPER + `rds_superuser` membership + `CREATEDB` + `CREATEROLE` + a working `SET LOCAL session_replication_role = replica` (RDS reports `has_parameter_privilege` false for `rds_superuser`, so the driver tries it) + origin, creates `keeper` only if that database is absent, then connects `keeper` and requires no user tables and no `keeper_app` role. An existing empty `keeper` database is allowed. Any user data, `keeper_app`, or other non-fresh state fails closed. Schema migrations run only against `keeper`, never against `postgres`. Other application databases and roles are not dropped, renamed, or modified. Human roles are not created here.

RDS cannot use `pg_restore --disable-triggers`. The restore process is the only connection that sets `PGOPTIONS=-c session_replication_role=replica`. Later sessions must remain `origin`. Validated foreign keys are checked with boolean `EXISTS` probes; row payloads are not printed.

`keeper_app` is created `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` with DML and sequence rights on `keeper` only, no `public` CREATE, no `rds_iam` membership, and no operational receipt access.

ECS task-role credentials plus execution-role injection supply:

- `SOURCE_DATABASE_URL`: exact Railway source `turntable.proxy.rlwy.net:25437`; TLS `require`. Source is never written.
- `TARGET_DB_HOST`: must equal the injected managed endpoint and `/^shared-data-postgres\.[a-z0-9]+\.us-east-2\.rds\.amazonaws\.com$/`.
- `TARGET_DB_PORT`: `5432`.
- `TARGET_DB_NAME`: `keeper`.
- `TARGET_ADMIN_USER`: `bocapro_data_admin`.
- `TARGET_ADMIN_PASSWORD`: ECS-injected from the RDS managed Secrets Manager secret JSON `password` field.
- `TARGET_APP_PASSWORD`, `OLD_ENCRYPTION_KEY`, `NEW_ENCRYPTION_KEY`, and `TARGET_DATABASE_URL`: scoped SSM SecureString injection. `TARGET_DATABASE_URL` is `keeper_app` / `keeper` with the exact injected app password and `sslmode=verify-full&sslrootcert=/app/certs/aws-rds-us-east-2.pem`.
- `MIGRATION_BUCKET`: `bocapro-shared-host-keeper-backup-491565008757`.

The runtime role needs object read/write at `migration/*`, not bucket configuration permissions. Archives and receipts go to that private prefix with AES256 and SHA256 checksums verified by HeadObject before target writes continue past the archive upload.

A failure can leave a fresh schema or restored rows on `keeper`. A rerun then fails closed and needs operator review. This transfer prepares a staging copy. A later final copy cannot overwrite it.

## Local synthetic fixture

Network-none, tmpfs PostgreSQL 18.6, synthetic rows only. No AWS calls. The fixture does not import the production driver. Until parent builds image3, run against the existing transfer image2 with a read-only mount of these scripts.

Startup:

```sh
docker run -d --rm --name keeper-transfer-fixture --network none \
  --tmpfs /var/lib/postgresql:rw,size=256m \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:18.6@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81
```

Readiness:

```sh
until docker exec keeper-transfer-fixture pg_isready -U postgres; do sleep 1; done
```

Guards (Bun 1.3.11 in the transfer image). `--workdir /tmp` avoids the app image `bunfig.toml` test preload:

```sh
docker run --rm --network none --read-only \
  --user 65532:65532 --workdir /tmp \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  -v "$PWD/scripts/aws-transfer:/app/scripts/aws-transfer:ro" \
  --entrypoint bun \
  boca-keeper-transfer:test test /app/scripts/aws-transfer/guards.test.ts
```

Fixture:

```sh
docker run --rm --network container:keeper-transfer-fixture --read-only \
  --user 65532:65532 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  -v "$PWD/scripts/aws-transfer:/app/scripts/aws-transfer:ro" \
  --entrypoint bun \
  boca-keeper-transfer:test /app/scripts/aws-transfer/fixture.ts
```

Cleanup:

```sh
docker stop keeper-transfer-fixture
```

After image3 exists, omit the bind mount and keep the same startup, readiness, run, and cleanup commands. The fixture still uses localhost trust inside the isolated network namespace; production guards stay in `driver.ts`.

Typecheck and lint from this directory on the workspace (no image required; Bun 1.3.11 for tests):

```sh
bunx tsc --noEmit
bunx oxlint .
```

The fixture creates a NONSUPER `bocapro_data_admin` with `CREATEDB`/`CREATEROLE`, membership in fixture `rds_superuser`, and `GRANT SET ON PARAMETER session_replication_role` issued by fixture root. It covers empty-target create-if-absent, existing empty database, rejection of existing user data and `keeper_app`, reviewed migrations against the app database only, snapshot-consistent dump/restore without `--disable-triggers`, count comparison, rotation, `keeper_app` boundaries, negative foreign-key detection, and a restricted public-only backup that excludes the receipt and restores independently.

## Authenticated source TLS

The source PostgreSQL certificate names `postgres.railway.internal`, rather than its public proxy. The transfer image includes its public root CA, retrieved through authenticated Railway SSH; see the [certificate record](../../docker/aws/certs/README.md). Resolve the fixed public proxy to IPv4 once per transfer. Both snapshot and dump connections route to that address and verify the internal certificate name. node-postgres receives explicit CA/servername with rejectUnauthorized=true; libpq receives PGHOSTADDR for routing and PGHOST with verify-full for identity. The operator laptop inspected public certificates only; no production dump or rows were downloaded.

`source-tls-fixture.ts` runs only against synthetic PostgreSQL 18 on port 25437 with database `railway` and a fixture CA mounted at `/fixture/ca.pem`. Both node-postgres and pg_dump must succeed with the trusted name and fail with a wrong CA or name. It does not weaken the production driver's ECS/account/filesystem guards.
