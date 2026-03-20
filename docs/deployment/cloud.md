[Docs](../README.md) > [Installation](./) > Cloud

# Cloud Deployment

Deploy pally-agent services to AWS or Azure.

> Full infrastructure-as-code manifests (Terraform, Pulumi, ARM templates) are planned for a future release. This guide covers architecture decisions and key configuration for each approach.

---

## Key decisions before you deploy

### Database adapter

| Deployment pattern | Recommended adapter | Reason |
|-------------------|--------------------|----|
| Single container (ECS Fargate, Azure Container Apps) | SQLite with persistent volume | Simplest, lowest cost |
| Lambda / Azure Functions (stateless) | PostgreSQL or MongoDB | No persistent local disk |
| Multi-instance behind load balancer | PostgreSQL or MongoDB | Shared state across instances |

### JWT key management

Store private keys in a secret manager, not in environment variables or application code:

- **AWS:** AWS Secrets Manager or Parameter Store (SecureString)
- **Azure:** Azure Key Vault

The service reads key files from the filesystem. In cloud deployments, mount secrets as files at container startup.

### CORS

Set `COMPLIANCE_CORS_ORIGIN` to your frontend domain(s). For fully internal APIs, restrict to service IPs only.

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

1. Push image to ECR:
   ```bash
   aws ecr get-login-password --region us-east-1 | \
     docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
   docker build -t pally-compliance packages/compliance/
   docker tag pally-compliance:latest <account>.dkr.ecr.us-east-1.amazonaws.com/pally-compliance:latest
   docker push <account>.dkr.ecr.us-east-1.amazonaws.com/pally-compliance:latest
   ```

2. Create ECS task definition with environment variables:
   ```json
   {
     "environment": [
       { "name": "COMPLIANCE_DB_ADAPTER", "value": "postgres" },
       { "name": "COMPLIANCE_PORT", "value": "4000" }
     ],
     "secrets": [
       { "name": "COMPLIANCE_DB_URL", "valueFrom": "arn:aws:secretsmanager:...:db-url" },
       { "name": "COMPLIANCE_JWT_PRIVATE_KEY", "valueFrom": "arn:aws:secretsmanager:...:jwt-private-key" }
     ]
   }
   ```

3. Configure the ALB target group health check: `GET /api/v1/health`

4. Set ALB listener rule to forward to the ECS service.

### Option 2: Lambda (serverless, lower traffic)

Use Lambda with a PostgreSQL database (RDS or Aurora Serverless v2). The compliance service is a Fastify app — wrap it with `@fastify/aws-lambda`:

```typescript
import awsLambdaFastify from '@fastify/aws-lambda';
import { buildApp } from './app.js';

const app = await buildApp();
export const handler = awsLambdaFastify(app);
```

Note: SSE streaming (A2A task stream) does not work with standard Lambda. Use ECS Fargate if SSE is required.

---

## Azure

### Option 1: Azure Container Apps (recommended)

**Architecture:**
```
Internet → Container Apps Environment → Compliance App → Azure SQL / MongoDB Atlas
                                      → Dashboard App
```

```bash
# Create resource group
az group create --name pally-rg --location westeurope

# Create Container Apps environment
az containerapp env create \
  --name pally-env \
  --resource-group pally-rg \
  --location westeurope

# Deploy compliance service
az containerapp create \
  --name pally-compliance \
  --resource-group pally-rg \
  --environment pally-env \
  --image <your-registry>/pally-compliance:latest \
  --target-port 4000 \
  --ingress external \
  --env-vars \
    COMPLIANCE_DB_ADAPTER=postgres \
    COMPLIANCE_PORT=4000 \
  --secrets \
    db-url=<postgres-connection-string> \
    jwt-private-key=<private-key-contents>
```

### Option 2: Azure Functions

Similar caveats as AWS Lambda — use for stateless compliance checks, not SSE streaming.

---

## Environment variables for cloud

Full reference of environment variables for each service:

| Service | Variable | Required | Description |
|---------|----------|----------|-------------|
| compliance | `COMPLIANCE_DB_ADAPTER` | Yes | `sqlite`, `postgres`, or `mongodb` |
| compliance | `COMPLIANCE_DB_URL` | If postgres/mongo | Connection string |
| compliance | `COMPLIANCE_DB_PATH` | If sqlite | Absolute path |
| compliance | `COMPLIANCE_JWT_PRIVATE_KEY` | Yes | Path to private PEM file |
| compliance | `COMPLIANCE_JWT_PUBLIC_KEY` | Yes | Path to public PEM file |
| compliance | `COMPLIANCE_CORS_ORIGIN` | Yes | Frontend origin(s) |
| compliance | `COMPLIANCE_PORT` | No | Default: 4000 |
| dashboard | `DASHBOARD_SESSION_SECRET` | Yes | Min 32 bytes |
| dashboard | `DASHBOARD_COMPLIANCE_URL` | Yes | Internal URL of compliance service |
| dashboard | `DASHBOARD_COMPLIANCE_CLIENT_ID` | Yes | OAuth client ID |
| dashboard | `DASHBOARD_COMPLIANCE_CLIENT_SECRET` | Yes | OAuth client secret |

---

*See also: [installation/docker.md](docker.md) | [installation/kubernetes.md](kubernetes.md) | [configuration/compliance.md](../configuration/compliance.md)*
