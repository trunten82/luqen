[Docs](../README.md) > [Installation](./) > Kubernetes

# Kubernetes Installation

Deploy Luqen to Kubernetes using the Helm chart in `k8s/helm/luqen/`.

---

## Prerequisites

- Kubernetes 1.28+
- kubectl configured for your cluster
- Helm 3.12+

---

## Quick start

```bash
helm install luqen ./k8s/helm/luqen
```

This deploys with default values: compliance API, dashboard, pa11y scanner, and Redis cache — all using SQLite and in-cluster networking.

Access via port-forward:

```bash
kubectl port-forward svc/luqen-dashboard 5000:5000
```

Then open http://localhost:5000.

---

## Configuration

All values are defined in `k8s/helm/luqen/values.yaml`. Override them with `--set` flags or a custom values file (`-f my-values.yaml`).

### Minimal (development)

```bash
helm install luqen ./k8s/helm/luqen \
  --set compliance.replicas=1 \
  --set dashboard.replicas=1 \
  --set redis.enabled=false \
  --set pa11y.enabled=false
```

### Standard (staging)

```bash
helm install luqen ./k8s/helm/luqen \
  --set dashboard.sessionSecret="$(openssl rand -hex 32)" \
  --set ingress.enabled=true \
  --set ingress.host=luqen.staging.example.com
```

### Full (production)

Create a `production-values.yaml`:

```yaml
global:
  imageTag: "1.1.0"
  imagePullPolicy: Always

compliance:
  replicas: 3
  dbAdapter: postgres
  dbUrl: "postgresql://luqen:secret@pg-host:5432/compliance"
  resources:
    requests:
      memory: "256Mi"
      cpu: "500m"
    limits:
      memory: "512Mi"
      cpu: "1000m"
  persistence:
    data:
      enabled: false   # Not needed with PostgreSQL
    keys:
      enabled: true
      size: 10Mi

dashboard:
  replicas: 3
  sessionSecret: "<generate-with-openssl-rand-hex-32>"
  complianceClientId: "<your-client-id>"
  complianceClientSecret: "<your-client-secret>"
  resources:
    requests:
      memory: "256Mi"
      cpu: "500m"
    limits:
      memory: "512Mi"
      cpu: "1000m"

pa11y:
  enabled: true

redis:
  enabled: true

monitor:
  enabled: true

ingress:
  enabled: true
  host: luqen.example.com
  tls:
    enabled: true
    clusterIssuer: letsencrypt-prod

secrets:
  jwtPrivateKey: |
    -----BEGIN RSA PRIVATE KEY-----
    <your-private-key>
    -----END RSA PRIVATE KEY-----
  jwtPublicKey: |
    -----BEGIN PUBLIC KEY-----
    <your-public-key>
    -----END PUBLIC KEY-----
```

Deploy:

```bash
helm install luqen ./k8s/helm/luqen -f production-values.yaml
```

Upgrade:

```bash
helm upgrade luqen ./k8s/helm/luqen -f production-values.yaml
```

---

## Ingress configuration

Enable ingress to expose the dashboard and compliance API through a single hostname:

```bash
helm install luqen ./k8s/helm/luqen \
  --set ingress.enabled=true \
  --set ingress.host=luqen.example.com \
  --set ingress.className=nginx \
  --set ingress.tls.enabled=true \
  --set ingress.tls.clusterIssuer=letsencrypt-prod
```

Routing rules:
- `/api/*` routes to the compliance service
- `/*` routes to the dashboard

The ingress template includes security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) and configurable proxy timeouts for long-running scan operations.

The `proxy-buffering: off` annotation may be needed for SSE progress streams — add it via `ingress.annotations`:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
```

---

## Scaling

### Horizontal scaling

Increase replicas for the compliance API and dashboard:

```bash
helm upgrade luqen ./k8s/helm/luqen \
  --set compliance.replicas=5 \
  --set dashboard.replicas=5
```

### Database considerations

SQLite does not support concurrent writes. For multi-replica deployments of the **compliance service**, switch to PostgreSQL:

```bash
helm upgrade luqen ./k8s/helm/luqen \
  --set compliance.dbAdapter=postgres \
  --set compliance.dbUrl="postgresql://user:pass@host:5432/compliance" \
  --set compliance.persistence.data.enabled=false
```

For the **dashboard**, SQLite is the only storage adapter currently available. A PostgreSQL storage adapter plugin (`@luqen/plugin-storage-postgres`) is coming soon and is recommended for multi-replica dashboard deployments. Until then, limit the dashboard to a single replica or use session affinity when running with SQLite.

### Redis for multi-instance

When running multiple dashboard replicas, enable Redis for SSE pub/sub and scan queue coordination:

```bash
helm upgrade luqen ./k8s/helm/luqen --set redis.enabled=true
```

---

## Monitoring

Enable the monitoring sidecar for health-check aggregation:

```bash
helm upgrade luqen ./k8s/helm/luqen --set monitor.enabled=true
```

The monitor service exposes metrics on port 9090 and checks the health of both the compliance API and dashboard.

---

## Persistent volumes

The chart creates PVCs for:

| PVC | Purpose | Default size |
|-----|---------|-------------|
| `*-compliance-data` | SQLite database | 2Gi |
| `*-compliance-keys` | JWT RSA key pair | 10Mi |
| `*-dashboard-reports` | Generated PDF reports (optional) | 5Gi |

Disable PVCs you do not need:

```yaml
compliance:
  persistence:
    data:
      enabled: false   # When using PostgreSQL
    keys:
      enabled: true    # Always needed for JWT signing
```

---

## Secrets management

The chart creates a single Secret resource containing all sensitive values. For production, consider using:

- [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets)
- [External Secrets Operator](https://external-secrets.io/)
- [Vault Agent Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector)

The secret has `helm.sh/resource-policy: keep` to prevent deletion on `helm uninstall`.

---

## Multi-tenancy

Multi-tenancy is query-level — no separate databases, schemas, or per-org pods are required. A single deployment serves all organizations. The `X-Org-Id` header is passed from the dashboard to the compliance service on every API call. Ensure your ingress does not strip custom headers.

---

## Uninstall

```bash
helm uninstall luqen
```

Note: PVCs and the secrets resource are retained by default. Delete manually if no longer needed:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=luqen
kubectl delete secret -l app.kubernetes.io/instance=luqen
```

---

## Legacy Kustomize manifests

The original Kustomize manifests remain available in `k8s/` (outside the `helm/` directory) for users who prefer `kubectl apply -k`. The Helm chart is the recommended approach for new deployments.

---

*See also: [installation/docker.md](docker.md) | [installation/cloud.md](cloud.md)*
