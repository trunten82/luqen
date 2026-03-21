# Cloud Deployment Overview

Deploy the Luqen Compliance Service to AWS or Azure. This guide covers the key deployment patterns for each platform.

Note: Full infrastructure-as-code manifests (Terraform, Pulumi, ARM templates) are planned for a future release. This guide covers architecture decisions and key configuration for each approach.

## Key considerations for any cloud deployment

### Database adapter choice

| Deployment pattern | Recommended adapter | Reason |
|-------------------|--------------------|----|
| Single container (ECS Fargate, Azure Container Apps) | SQLite with persistent volume | Simplest, lowest cost |
| Lambda / Azure Functions (stateless) | PostgreSQL (RDS/Azure SQL) or MongoDB (Atlas) | No persistent local disk |
| Multi-instance behind load balancer | PostgreSQL or MongoDB | Shared state across instances |

### JWT key management

Store private keys in a secret manager, not in environment variables or application code:

- **AWS:** AWS Secrets Manager or Parameter Store (SecureString)
- **Azure:** Azure Key Vault

The service reads key files from the filesystem. In cloud deployments, mount secrets as files at container startup.

### CORS configuration

Set `COMPLIANCE_CORS_ORIGIN` to your frontend domain(s). For a fully internal API (accessed only by backend services), set `cors.origin` to only the service IPs.

---

## AWS

### Option 1: ECS Fargate (recommended for production)

**Architecture:**
```
Internet → ALB (HTTPS) → ECS Fargate service → RDS PostgreSQL
                                    ↓
                          Secrets Manager (JWT keys)
```

**Key steps:**

1. **Push image to ECR:**
   ```bash
   aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
   docker build -t luqen-compliance packages/compliance/
   docker tag luqen-compliance:latest <account>.dkr.ecr.us-east-1.amazonaws.com/luqen-compliance:latest
   docker push <account>.dkr.ecr.us-east-1.amazonaws.com/luqen-compliance:latest
   ```

2. **Create RDS PostgreSQL** (Aurora Serverless v2 is cost-effective for variable load)

3. **Store JWT keys in Secrets Manager:**
   ```bash
   aws secretsmanager create-secret \
     --name /luqen-compliance/jwt-private-key \
     --secret-string file://keys/private.pem
   aws secretsmanager create-secret \
     --name /luqen-compliance/jwt-public-key \
     --secret-string file://keys/public.pem
   ```

4. **ECS task definition** (key environment variables):
   ```json
   {
     "environment": [
       { "name": "COMPLIANCE_DB_ADAPTER", "value": "postgres" },
       { "name": "COMPLIANCE_PORT", "value": "4000" },
       { "name": "COMPLIANCE_URL", "value": "https://compliance.example.com" }
     ],
     "secrets": [
       {
         "name": "COMPLIANCE_DB_URL",
         "valueFrom": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:/luqen-compliance/db-url"
       }
     ]
   }
   ```

5. **Mount JWT key files** using ECS secrets as files (requires custom entrypoint to write Secrets Manager values to `/keys/*.pem`) or use AWS Systems Manager Parameter Store with the `ECS_EXEC` feature.

6. **ALB target group** health check: `GET /api/v1/health`, expected 200.

**Estimated cost (us-east-1, light traffic):**
- ECS Fargate (0.25 vCPU, 512 MB): ~$10/month
- RDS Aurora Serverless v2 (min 0.5 ACU): ~$45/month
- ALB: ~$20/month

### Option 2: AWS Lambda

Lambda is suitable for infrequent compliance checks (e.g., CI/CD pipelines calling the API a few times per run).

**Constraints:**
- No persistent local disk — must use RDS or MongoDB Atlas
- 15-minute max execution time (not relevant for this service)
- Cold starts add ~1-2 seconds on first request

**Fastify on Lambda** using `@fastify/aws-lambda`:

```typescript
// lambda.ts
import awsLambdaFastify from '@fastify/aws-lambda'
import { createServer } from './api/server.js'

const proxy = awsLambdaFastify(await createServer({
  db,
  signToken,
  verifyToken,
  tokenExpiry: '1h',
}))

export const handler = proxy
```

Set `COMPLIANCE_DB_ADAPTER=postgres` and provide `COMPLIANCE_DB_URL` via Lambda environment variables (stored in Secrets Manager, injected via Lambda's secret extension or a custom init layer).

### Option 3: EC2 with bare metal install

For maximum control or cost optimization at low scale, follow the [bare-metal installation guide](./bare-metal.md) on an EC2 instance. Use Amazon Linux 2023 or Ubuntu 24.04 LTS.

---

## Azure

### Option 1: Azure Container Apps (recommended)

Azure Container Apps is the easiest managed container option on Azure.

**Architecture:**
```
Internet → Container Apps (with built-in ingress/TLS) → Azure Database for PostgreSQL
                              ↓
                       Azure Key Vault (JWT keys)
```

**Key steps:**

1. **Push image to Azure Container Registry:**
   ```bash
   az acr login --name yourregistry
   docker build -t luqen-compliance packages/compliance/
   docker tag luqen-compliance:latest yourregistry.azurecr.io/luqen-compliance:latest
   docker push yourregistry.azurecr.io/luqen-compliance:latest
   ```

2. **Create Azure Database for PostgreSQL — Flexible Server**

3. **Store JWT keys in Azure Key Vault:**
   ```bash
   az keyvault secret set --vault-name your-vault --name jwt-private-key --file keys/private.pem
   az keyvault secret set --vault-name your-vault --name jwt-public-key --file keys/public.pem
   ```

4. **Create Container App with managed identity** to access Key Vault:
   ```bash
   az containerapp create \
     --name luqen-compliance \
     --resource-group my-rg \
     --environment my-env \
     --image yourregistry.azurecr.io/luqen-compliance:latest \
     --target-port 4000 \
     --ingress external \
     --env-vars \
       COMPLIANCE_DB_ADAPTER=postgres \
       COMPLIANCE_PORT=4000 \
       COMPLIANCE_URL=https://luqen-compliance.nicemeadow-abc123.eastus.azurecontainerapps.io
   ```

5. **Mount Key Vault secrets as files** using Container Apps secret volumes (see Azure docs for `secretVolumeMount`).

6. **Scale rules:** Container Apps scale to zero by default. For compliance checks that need consistent latency, set minimum replicas to 1.

**Estimated cost (East US, low traffic):**
- Container Apps (~1 replica): ~$15/month
- Azure Database for PostgreSQL (Burstable, 1 vCore): ~$25/month

### Option 2: Azure Functions

Similar to AWS Lambda — suitable for infrequent, event-driven compliance checks.

Use the `@azure/functions` Node.js v4 SDK with Fastify:

```typescript
// src/functions/compliance-api.ts
import { app as funcApp } from '@azure/functions'
import { createServer } from '../api/server.js'

const fastifyApp = await createServer({ db, signToken, verifyToken, tokenExpiry: '1h' })
await fastifyApp.ready()

funcApp.http('compliance-api', {
  route: '{*path}',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    // Forward to Fastify
    // ... adapter code
  }
})
```

Must use external database (Cosmos DB API for MongoDB or Azure SQL).

---

## Common cloud configuration

### Setting COMPLIANCE_URL for A2A

Always set `COMPLIANCE_URL` to your public HTTPS URL so the A2A agent card advertises the correct address:

```bash
COMPLIANCE_URL=https://compliance.example.com
```

The agent card at `GET /.well-known/agent.json` uses this value.

### Production CORS

Restrict CORS to your actual frontend domains:

```bash
COMPLIANCE_CORS_ORIGIN=https://app.example.com,https://admin.example.com
```

### Health check endpoint

All load balancers and container orchestrators should use:

```
GET /api/v1/health
Expected: 200 OK
Body: {"status":"ok",...}
```

### Managed identity / IAM for secrets

Never pass raw secret values as environment variables in production. Use:

- **AWS:** IAM role for ECS task with Secrets Manager `GetSecretValue` permission
- **Azure:** Managed identity with Key Vault `Get` secret permission

Mount the secret values as files at `/keys/private.pem` and `/keys/public.pem` using your platform's secret injection mechanism (ECS secrets → files, Container Apps secret volumes, etc.).
