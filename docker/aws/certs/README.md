# Amazon RDS regional CA bundle

`aws-rds-us-east-2.pem` is the public AWS regional trust bundle downloaded on 2026-11-02 from https://truststore.pki.rds.amazonaws.com/us-east-2/us-east-2-bundle.pem.

SHA256: `d46e1bdfda05c8e7644e50930806a19b139a222542bf0348082fb59ece2b5fa5`

Application and transfer images install it at `/app/certs/aws-rds-us-east-2.pem`. Target URLs require `sslmode=verify-full&sslrootcert=/app/certs/aws-rds-us-east-2.pem`; libpq restore uses the equivalent PGSSLMODE/PGSSLROOTCERT settings. Replace this public bundle through a reviewed image rebuild when AWS updates its trust roots. No private keys are included.
