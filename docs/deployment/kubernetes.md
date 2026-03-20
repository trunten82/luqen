[Docs](../README.md) > [Installation](./) > Kubernetes

# Kubernetes Installation

Deploy pally-agent services to Kubernetes using Kustomize manifests from the `k8s/` directory.

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
kubectl create secret generic pally-compliance-secrets \
  --from-literal=JWT_PRIVATE_KEY="$(cat keys/private.pem)" \
  --from-literal=JWT_PUBLIC_KEY="$(cat keys/public.pem)"

kubectl create secret generic pally-dashboard-secrets \
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
  name: pally-compliance-config
data:
  COMPLIANCE_PORT: "4000"
  COMPLIANCE_HOST: "0.0.0.0"
  COMPLIANCE_DB_ADAPTER: "sqlite"
  COMPLIANCE_DB_PATH: "/data/compliance.db"
```

Override values in your overlay's `kustomization.yaml`:

```yaml
configMapGenerator:
  - name: pally-compliance-config
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
  name: pally-compliance-data
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
  name: pally-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-buffering: "off"   # Required for SSE
spec:
  rules:
    - host: pally.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: pally-dashboard
                port:
                  number: 5000
    - host: compliance.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: pally-compliance
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

*See also: [installation/docker.md](docker.md) | [installation/cloud.md](cloud.md) | [configuration/compliance.md](../configuration/compliance.md)*
