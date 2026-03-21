[Docs](../README.md) > [Installation](./) > Kubernetes

# Kubernetes Installation

Deploy luqen services to Kubernetes using Kustomize manifests from the `k8s/` directory.

---

## Prerequisites

- Kubernetes 1.28+
- kubectl
- kustomize (or `kubectl apply -k`)

---

## Repository layout

The `k8s/` directory at the monorepo root contains:

```
k8s/
├── base/                   # Shared base manifests
│   ├── compliance/         # Compliance service Deployment, Service, ConfigMap
│   ├── dashboard/          # Dashboard Deployment, Service
│   └── kustomization.yaml
├── overlays/
│   ├── dev/                # Dev overlay (reduced replicas, NodePort)
│   └── prod/               # Production overlay (PodDisruptionBudget, HPA)
└── README.md
```

---

## Deploy to development

```bash
kubectl apply -k k8s/overlays/dev
```

---

## Deploy to production

```bash
# 1. Create secrets (do not commit these)
kubectl create secret generic luqen-compliance-secrets \
  --from-literal=JWT_PRIVATE_KEY="$(cat keys/private.pem)" \
  --from-literal=JWT_PUBLIC_KEY="$(cat keys/public.pem)"

kubectl create secret generic luqen-dashboard-secrets \
  --from-literal=DASHBOARD_SESSION_SECRET="$(openssl rand -base64 32)" \
  --from-literal=DASHBOARD_COMPLIANCE_CLIENT_SECRET="<client-secret>"

# 2. Apply the production overlay
kubectl apply -k k8s/overlays/prod
```

---

## Configuration via ConfigMaps

The base manifests use a ConfigMap for non-secret configuration:

```yaml
# k8s/base/compliance/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: luqen-compliance-config
data:
  COMPLIANCE_PORT: "4000"
  COMPLIANCE_HOST: "0.0.0.0"
  COMPLIANCE_DB_ADAPTER: "sqlite"
  COMPLIANCE_DB_PATH: "/data/compliance.db"
```

Override values in your overlay's `kustomization.yaml`:

```yaml
configMapGenerator:
  - name: luqen-compliance-config
    behavior: merge
    literals:
      - COMPLIANCE_DB_ADAPTER=postgres
      - COMPLIANCE_DB_URL=postgres://user:pass@db-host:5432/compliance
```

---

## Persistent volumes

The compliance service needs a persistent volume for SQLite data and JWT keys:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: luqen-compliance-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 5Gi
```

For multi-replica deployments, switch to PostgreSQL (`COMPLIANCE_DB_ADAPTER=postgres`) — SQLite does not support concurrent writes from multiple pods.

---

## Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: luqen-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"   # Required for SSE
spec:
  rules:
    - host: luqen.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: luqen-dashboard
                port:
                  number: 5000
    - host: compliance.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: luqen-compliance
                port:
                  number: 4000
```

The `proxy-buffering: off` annotation is required for the dashboard's SSE progress stream to work correctly.

---

## Health checks

The compliance service exposes `GET /api/v1/health` (no auth required). Use this as your readiness and liveness probe:

```yaml
readinessProbe:
  httpGet:
    path: /api/v1/health
    port: 4000
  initialDelaySeconds: 5
  periodSeconds: 10
livenessProbe:
  httpGet:
    path: /api/v1/health
    port: 4000
  initialDelaySeconds: 15
  periodSeconds: 30
```

---

## Multi-Tenant Considerations

Multi-tenancy in luqen is entirely query-level — no separate databases, schemas, or per-org pods are required. A single deployment serves all organizations.

### Request routing

The `X-Org-Id` header is passed from the dashboard to the compliance service on every API call. Ensure your ingress and service mesh do not strip custom headers.

### Service-to-service authentication

In production, set the `COMPLIANCE_API_KEY` environment variable on both the dashboard and compliance service. The dashboard sends this key as a shared secret when calling the compliance API, providing an additional layer of trust beyond JWT tokens.

```yaml
# Add to dashboard and compliance secrets
kubectl create secret generic luqen-service-auth \
  --from-literal=COMPLIANCE_API_KEY="$(openssl rand -base64 32)"
```

### Session management

The dashboard stores the user's active organization context in their session. When a user switches orgs via the sidebar org switcher, the session is updated and all subsequent requests carry the new `X-Org-Id`.

### Data cleanup

When decommissioning an organization, call `DELETE /api/v1/orgs/:id/data` to remove all org-specific data. This is safe to run while other orgs continue operating — it only affects records matching the specified org ID.

### Scaling

Because tenancy is query-level, scaling works the same as a single-tenant deployment. Add replicas via HPA as load increases — all replicas serve all organizations. If using SQLite, switch to PostgreSQL before scaling beyond one replica (see [Persistent volumes](#persistent-volumes)).

---

*See also: [installation/docker.md](docker.md) | [installation/cloud.md](cloud.md) | [configuration/compliance.md](../configuration/compliance.md)*
