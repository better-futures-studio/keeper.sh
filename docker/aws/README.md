# Keeper on AWS

This runtime keeps the deployed Keeper application's web/API/cron/worker contract and makes database migration an explicit operation. `start.sh` always starts web and API, starts cron/worker only with `KEEPER_SYNC_ENABLED=true`, and stops the container if any required child exits. It runs as UID 65532 on a read-only root with capabilities dropped. Use a writable 128 MiB `/tmp`,1536 MiB memory and 256 CPU units for the initial deployment.

Build the ARM64 application image, then the transfer image. Preserve earlier immutable migration tags.

```sh
docker build --platform linux/arm64 -f docker/aws/Dockerfile -t boca-keeper:a79f73d-migration6 .
docker build --platform linux/arm64 -f docker/aws/Migration.Dockerfile -t boca-keeper-transfer:test .
```

The tools image copies this exact local app tag and includes PostgreSQL 18.6, Bun 1.3.11 and AWS CLI 2.31.17 from pinned upstream images. Publish reviewed immutable tags and record registry digests before launching tasks. The local Docker image ID is not a registry manifest digest.

Provide app database URL/password, Redis, auth and encryption secrets through scoped ECS execution-role injection from SSM SecureString parameters. Inject `TARGET_ADMIN_PASSWORD` from the RDS managed Secrets Manager secret JSON `password` field. Never store values in Terraform, images, command arguments or Git. Runtime app roles do not need SSM access. Preserve the existing domain restriction, provider IDs, legal operator and public URLs.

Password login remains disabled. Keeper intentionally refuses to boot without a configured social provider in that mode. Rotate external Google/Microsoft secrets before starting the AWS app; do not enable password login to bypass this check. Keep sync disabled until final source quiescence, data checks and provider reconnection are complete.

## Migration tools

Read [transfer contract](../../scripts/aws-transfer/README.md) and [credential rotation](../../scripts/aws-migration/README.md). Production data moves inside AWS only; never download its dump onto the operator laptop. Temporary files use the task's 512 MiB tmpfs, and archives/receipts go to its private encrypted S3 prefix. The driver connects the RDS admin to `/postgres` first, creates `keeper` only if absent, refuses a non-empty target or existing `keeper_app`, restores with `session_replication_role=replica` instead of `--disable-triggers`, verifies counts from a consistent source snapshot, rotates copied credentials and creates a restricted runtime role. Application and transfer images install the public Amazon RDS us-east-2 CA at `/app/certs/aws-rds-us-east-2.pem`.

Source tokens are sensitive even after client-secret rotation. Revoke old provider grants, reconnect calendar accounts and resubscribe private feeds during the controlled cutover. The initial staging copy cannot replace the final copy after source writers stop.

## Security update and verification

The migration image updates Better Auth and matching plugins to 1.7.15, patches compatible dependency lines, updates Debian packages and excludes unused native build tools from runtime. The auth compatibility change preserves bearer JWT issuer/audience/signature checks and explicit signup-domain rejection. MCP remains outside this deployed image; enable its separate OAuth-provider features only after their schema/configuration review.

The November 2, 2026 Trivy comparison reported 10 critical/174 high occurrences in the original image and 0 critical/48 high in the patched image. The remaining 48 were OS findings with no Debian fixed version; none were high JavaScript findings. These are package/advisory occurrences. Continue scanning and rebuild when fixes become available; a scan does not prove absence of vulnerabilities.

Verified with synthetic data only:

- Full suite: 4398 passed, 62 skipped across 11 workspaces, using Bun 1.3.11 and real Node 22.20.0. MCP's Vitest script requires Node; a Bun-only image gives misleading import failures.
- Typecheck: 17 workspaces. Lint: 17 workspaces. Unused-code check passes.
- Credential rotation: 40 tests including PostgreSQL integration. Transfer boundary tests live in `scripts/aws-transfer`. An isolated fixture verifies empty-target bootstrap, rejection of existing data/role, concurrent snapshot consistency, data-only restore without disable-triggers, rotation, runtime role boundaries, restricted-role backup and independent backup restore.
- Patched runtime login and API health return 200 under the stated non-root/read-only/CPU/memory restrictions. SQL migrations work under the same filesystem restrictions. Dummy provider credentials in these tests do not validate real OAuth.

Primary references:

- https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm
- https://better-auth.com/docs/guides/1-7-upgrade-guide
- https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-3pfx-gxff-vg76
- https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-j3f2-48v5-ccww

## TLS and image checks

The application stays on Bun 1.3.11. Its SQL client does not support libpq's `sslrootcert` URL key, so the database connection helper reads the public CA, removes that key before opening Bun SQL, and supplies explicit TLS options with certificate and hostname verification. Connections without a root-certificate URL key retain their existing behavior. A local PostgreSQL 18 TLS fixture verified success with its trusted CA and rejection of a wrong CA and wrong hostname on this exact Bun version. Missing or unreadable CA files fail before connecting.

The one-off transfer image retains PostgreSQL 18.6 client tools and excludes the database server, unused gosu binary and Python wheel packaging files. November 2 image scans found no critical vulnerabilities and no high-severity language-package vulnerabilities in either image. Debian packages still have high-severity advisories without published fixes (48 in the application image,55 in the transfer image); rescan and rebuild when fixes become available. Preserve the images' read-only, non-root execution and restricted network/IAM settings.

Sync also requires `WORKER_JOB_QUEUE_ENABLED=true`. The image supplies that default; startup fills it when unset and refuses an explicit false or invalid value before starting any child when sync is enabled. Unauthenticated ICS subscriptions keep their reauthentication state during credential rotation; credential-backed accounts are marked for reconnection.
