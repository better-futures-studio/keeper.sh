FROM boca-keeper:a79f73d-migration2 AS app
FROM oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9 AS bun
FROM public.ecr.aws/aws-cli/aws-cli:2.31.17@sha256:d3f5b7078a71fd7cb488719571c50abd252f4320cdf375601f2d6d40caf97b55 AS aws
FROM postgres:18.6@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81 AS postgres
# Copy the pinned rootfs without inheriting PostgreSQL server VOLUME metadata.
FROM scratch
COPY --from=postgres / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/postgresql/18/bin LANG=en_US.utf8
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
COPY --from=aws /usr/local/aws-cli /usr/local/aws-cli
RUN groupadd --gid 65532 keeper-transfer && useradd --uid 65532 --gid 65532 --home-dir /tmp --no-create-home --shell /usr/sbin/nologin keeper-transfer && ln -s /usr/local/aws-cli/v2/current/bin/aws /usr/local/bin/aws && aws --version && pg_dump --version && bun --version
WORKDIR /app
COPY --from=app /app /app
COPY scripts/aws-migration /app/scripts/aws-migration
COPY scripts/aws-transfer /app/scripts/aws-transfer
ENV HOME=/tmp AWS_PAGER="" AWS_CLI_AUTO_PROMPT=off NODE_ENV=production
USER 65532:65532
ENTRYPOINT ["bun", "/app/scripts/aws-transfer/driver.ts"]
