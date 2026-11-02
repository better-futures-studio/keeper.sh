# AWS-only Keeper transfer

Build from the repository root after building the reviewed application image:

```sh
docker build -f docker/aws/Migration.Dockerfile -t boca-keeper-transfer:test .
(cd scripts/aws-transfer && bun run test)
```

The app stage uses the local `boca-keeper:a79f73d-migration2` image. Pin the final transfer image by its registry digest in the one-off ECS task. PostgreSQL 18.6, Bun 1.3.11 and AWS CLI 2.31.17 use pinned upstream digests. The supplied AWS CLI digest reports 2.31.17, despite initially being identified as 2.31.18; the Dockerfile labels the verified version.

Run only as an ECS task in account `491565008757`, region `us-east-2`, cluster `shared-host`. Set UID/GID `65532:65532`, a read-only root filesystem and `/tmp` as a 512 MiB tmpfs with `noexec,nosuid,nodev`. Do not mount persistent storage at `/tmp`. Use the task role for private S3 access and SSM SecureString injection for these environment variables:

- `SOURCE_DATABASE_URL`: Railway source at `turntable.proxy.rlwy.net:25437`; TLS is required.
- `OLD_ENCRYPTION_KEY`, `NEW_ENCRYPTION_KEY`: different base64 secretbox keys.
- `TARGET_ADMIN_PASSWORD`: existing `keeper_admin` superuser password, needed to disable triggers during data restore.
- `TARGET_APP_PASSWORD`: fresh runtime password; the role must not exist yet.
- `TARGET_DATABASE_URL`: `keeper_app` URL with the exact injected app password, host `172.31.15.170`, port `15432`, database `keeper`.
- `MIGRATION_BUCKET`: `bocapro-shared-host-keeper-backup-491565008757`.
- Optional `TARGET_DB_HOST`, `TARGET_DB_PORT`, `TARGET_DB_NAME` must match the fixed values above.

ECS supplies its metadata endpoint and task credentials. The bucket's private-access controls are managed by the reviewed infrastructure; the runtime role needs object read/write at `migration/*`, not bucket configuration permissions. Each upload explicitly requests AES256 server-side encryption and SHA256 checksums. The archive upload is checked using HeadObject before target writes.

The driver refuses any existing user table or runtime role. It opens one read-only repeatable-read source transaction, exports its snapshot to pg_dump, and counts all public tables in that same snapshot. It creates a custom public-schema archive in tmpfs, uploads it, then runs the reviewed app migrations on the empty target. It restores only public data in one transaction, compares every source table count, rotates imported credentials using the reviewed helper, checks preserved/deleted counts, and creates the runtime role with DML and sequence rights. The runtime receives no schema CREATE privilege or access to newly created operational receipt tables.

The receipt at `migration/<UTC>/receipt.json` contains only counts, key fingerprints, rotation effects and the archive checksum/version. The archive itself contains sensitive application data and stays in private encrypted S3. Child stdout/stderr and database error details are suppressed; failures report only a fixed phase label. No credentials are passed as process arguments.

A failure can leave a fresh schema or restored rows on the target. The driver never drops objects or overwrites an existing target, so a rerun fails closed and requires operator review. The source is never written. The full production driver cannot run locally because the ECS, mount and identity guards remain enabled; unit tests exercise guard rejection without production data.

The image copies the pinned PostgreSQL root filesystem into a fresh final stage so it inherits no server `VOLUME` declaration. Its runtime UID also has a passwd entry for PostgreSQL client tools. Source libpq fields are supplied individually through environment variables; a URI in `PGDATABASE` alone does not set its connection host.

Local integration verification uses a separate, synthetic PostgreSQL container with `--network none`, tmpfs database storage, and the transfer container sharing only that container's network namespace. `fixture.ts` uses fixed localhost fixture database names. It runs the real reviewed migrations, inserts a synthetic user, exports a snapshot, inserts another user concurrently, dumps/restores the snapshot, compares all table counts, and invokes the real rotation CLI. Target retains one user while the source has two, proving snapshot consistency. It never imports the production driver or weakens its AWS guards.

This transfer prepares a staging copy. A later final copy cannot overwrite it: the no-existing-table guard deliberately rejects that operation. Final cutover needs a separately reviewed target reset or a fresh empty database and a new transfer run.

Run the synthetic integration fixture after rebuilding the transfer image:

```sh
docker run -d --rm --name keeper-transfer-fixture --network none \
  --tmpfs /var/lib/postgresql:rw,size=256m \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:18.6@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81
docker exec keeper-transfer-fixture pg_isready -U postgres
# Continue after pg_isready reports accepting connections.
docker run --rm --network container:keeper-transfer-fixture --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m --entrypoint bun \
  boca-keeper-transfer:test /app/scripts/aws-transfer/fixture.ts
docker stop keeper-transfer-fixture
```

The fixture also creates a restricted login with runtime DML rights and no access to the rotation receipt. It verifies that an ordinary full database dump fails with a permission error, captures that error without printing it, and checks the production backup recipe (`--schema=public --exclude-table=public.aws_migration_key_rotation_receipt`). It rebuilds a third database with reviewed migrations, restores backup data in one transaction with triggers disabled, and compares every application table count. The receipt is absent; migration history comes from the reviewed migrations. Local trust authentication is confined to the fixture's network namespace, which has no external network interface. The transfer image still runs as UID 65532.
