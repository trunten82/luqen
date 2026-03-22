{{/*
Expand the name of the chart.
*/}}
{{- define "luqen.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "luqen.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "luqen.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "luqen.labels" -}}
helm.sh/chart: {{ include "luqen.chart" . }}
app.kubernetes.io/part-of: luqen-ecosystem
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
{{- end }}

{{/*
Selector labels for a given component.
Usage: {{ include "luqen.selectorLabels" (dict "component" "compliance" "root" .) }}
*/}}
{{- define "luqen.selectorLabels" -}}
app.kubernetes.io/name: {{ include "luqen.fullname" .root }}-{{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/*
Component labels (common + selector + component metadata).
Usage: {{ include "luqen.componentLabels" (dict "component" "compliance" "tier" "backend" "root" .) }}
*/}}
{{- define "luqen.componentLabels" -}}
{{ include "luqen.labels" .root }}
{{ include "luqen.selectorLabels" (dict "component" .component "root" .root) }}
app.kubernetes.io/component: {{ .tier }}
{{- end }}

{{/*
Resolve image tag: component-specific tag falls back to global.imageTag.
Usage: {{ include "luqen.imageTag" (dict "tag" .Values.compliance.image.tag "global" .Values.global) }}
*/}}
{{- define "luqen.imageTag" -}}
{{- if .tag }}{{ .tag }}{{- else }}{{ .global.imageTag }}{{- end }}
{{- end }}

{{/*
Redis URL helper — returns the in-cluster Redis URL when redis is enabled.
*/}}
{{- define "luqen.redisUrl" -}}
{{- if .Values.redis.enabled -}}
redis://{{ include "luqen.fullname" . }}-redis:6379
{{- end -}}
{{- end }}
