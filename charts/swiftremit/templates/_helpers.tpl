{{/*
Expand the name of the chart.
*/}}
{{- define "swiftremit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "swiftremit.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Chart label.
*/}}
{{- define "swiftremit.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "swiftremit.labels" -}}
helm.sh/chart: {{ include "swiftremit.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Component selector labels — pass component name as $.component
*/}}
{{- define "swiftremit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "swiftremit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Image helper — prepend global registry when set.
*/}}
{{- define "swiftremit.image" -}}
{{- $reg := .global.imageRegistry -}}
{{- if $reg }}
{{- printf "%s/%s:%s" $reg .image.repository .image.tag }}
{{- else }}
{{- printf "%s:%s" .image.repository .image.tag }}
{{- end }}
{{- end }}
