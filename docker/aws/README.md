# Keeper on AWS

This runtime keeps the deployed Keeper application's web/API/cron/worker contract and makes database migration an explicit operation. `start.sh` always starts web and API, starts cron/worker only with `KEEPER_SYNC_ENABLED=true`, and stops the container if any required child exits. It runs as UID 65532 on a read-only root with capabilities dropped. Use a writable 128 MiB `/tmp`,1536 MiB memory and 256 CPU units for the initial deployment.

Build the app, then the one-off transfer tools:

```sh
docker build --platform linux/arm64 -f docker/aws/Dockerfile -t boca-keeper:a79f73d-migration2 .
docker build --platform linux/arm64 -f docker/aws/Migration.Dockerfile -t boca-keeper-transfer:test .
```

The tools image copies this exact local app tag and includes PostgreSQL 18.6, Bun 1.3.11 and AWS CLI 2.31.17 from pinned upstream images. Publish reviewed immutable tags and record registry digests before launching tasks. The local Docker image ID is not a registry manifest digest.

Provide database, Redis, auth and encryption secrets through scoped ECS execution-role injection from SSM SecureString parameters. Never store values in Terraform, images, command arguments or Git. Runtime app roles do not need SSM access. Preserve the existing domain restriction, provider IDs, legal operator and public URLs.

Password login remains disabled. Keeper intentionally refuses to boot without a configured social provider in that mode. Rotate external Google/Microsoft secrets before starting the AWS app; do not enable password login to bypass this check. Keep sync disabled until final source quiescence, data checks and provider reconnection are complete.

## Migration tools

Read [transfer contract](../../scripts/aws-transfer/README.md) and [credential rotation](../../scripts/aws-migration/README.md). Production data moves inside AWS only; never download its dump onto the operator laptop. Temporary files use the task's 512 MiB tmpfs, and archives/receipts go to its private encrypted S3 prefix. The driver refuses an existing target, verifies counts from a consistent source snapshot, rotates copied credentials and creates a restricted runtime role.

Source tokens are sensitive even after client-secret rotation. Revoke old provider grants, reconnect calendar accounts and resubscribe private feeds during the controlled cutover. The initial staging copy cannot replace the final copy after source writers stop.

## Security update and verification

The migration image updates Better Auth and matching plugins to 1.7.15, patches compatible dependency lines, updates Debian packages and excludes unused native build tools from runtime. The auth compatibility change preserves bearer JWT issuer/audience/signature checks and explicit signup-domain rejection. MCP remains outside this deployed image; enable its separate OAuth-provider features only after their schema/configuration review.

The November 2, 2026 Trivy comparison reported 10 critical/174 high occurrences in the original image and 0 critical/48 high in the patched image. The remaining 48 were OS findings with no Debian fixed version; none were high JavaScript findings. These are package/advisory occurrences. Continue scanning and rebuild when fixes become available; a scan does not prove absence of vulnerabilities.

Verified with synthetic data only:

- Full suite: 4398 passed, 62 skipped across 11 workspaces, using Bun 1.3.11 and real Node 22.20.0. MCP's Vitest script requires Node; a Bun-only image gives misleading import failures.
- Typecheck: 17 workspaces. Lint: 17 workspaces. Unused-code check passes.
- Credential rotation: 40 tests including PostgreSQL integration. Transfer boundary tests: 4. An isolated fixture verifies concurrent snapshot consistency, schema/data restore, rotation, restricted-role backup and independent backup restore.
- Patched runtime login and API health return 200 under the stated non-root/read-only/CPU/memory restrictions. SQL migrations work under the same filesystem restrictions. Dummy provider credentials in these tests do not validate real OAuth.

Primary references:

- https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm
- https://better-auth.com/docs/guides/1-7-upgrade-guide
- https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-3pfx-gxff-vg76
- https://github.com/protobufjs/protobuf.js/security/advisories/GHSA-j3f2-48v5-ccww
