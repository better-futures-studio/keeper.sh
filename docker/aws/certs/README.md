# Amazon RDS regional CA bundle

`aws-rds-us-east-2.pem` is the public AWS regional trust bundle downloaded on 2026-11-02 from https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem.

SHA256: `d46e1bdfda05c8e7644e50930806a19b139a222542bf0348082fb59ece2b5fa5`

Application and transfer images install it at `/app/certs/aws-rds-us-east-2.pem`. Target URLs require `sslmode=verify-full&sslrootcert=/app/certs/aws-rds-us-east-2.pem`; libpq restore uses the equivalent PGSSLMODE/PGSSLROOTCERT settings. Replace this public bundle through a reviewed image rebuild when AWS updates its trust roots. No private keys are included.

## Railway source trust

`railway-keeper-source-ca.pem` is the source PostgreSQL public root CA, read on 2026-11-02 from `/var/lib/postgresql/data/certs/root.crt` through authenticated Railway SSH for service `eb700f98-00bd-4227-8e21-d649d5d763a9`. SSH used the existing trusted `ssh.railway.com` host key. The temporary client key registration was removed after retrieval. No private CA/server keys or database rows were read.

Root certificate SHA256 fingerprint: `76:F3:AF:D6:21:31:2C:33:96:72:F2:49:78:58:BC:87:F3:85:64:62:3A:7B:C1:E7:70:A9:A4:7E:AE:62:0E:3A`. The served leaf fingerprint was `BB:21:77:08:3A:37:3A:98:14:D5:F0:67:E5:78:4D:2F:00:7D:32:EF:4F:A2:35:1B:B4:BA:D4:22:6C:1D:74:70`, issued for `localhost` and `postgres.railway.internal`. OpenSSL verified the live proxy chain and `postgres.railway.internal` hostname successfully with this CA.

The proxy host remains `turntable.proxy.rlwy.net:25437`. Source clients connect to its resolved IPv4 address but verify the certificate's `postgres.railway.internal` identity: node-postgres gets explicit CA/servername and rejects unauthorized certificates; libpq gets PGHOSTADDR for routing, PGHOST for identity and verify-full. The transfer image alone installs this source CA. Revalidate via authenticated control-plane access if Railway rotates it; never accept an unverified network certificate as the new trust anchor.
