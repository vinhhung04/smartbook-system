// monitoring-service (through the gateway at /monitoring/*): incidents, alert
// routing policies, notification channels, delivery history, in-app notifications.
import { gatewayAPI } from './http-clients';

export type IncidentSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type IncidentCategory = 'TECHNICAL' | 'BUSINESS' | 'INFO';
export type ChannelType = 'EMAIL' | 'IN_APP' | 'WEBHOOK';
export type DeliveryStatus = 'PENDING' | 'SENDING' | 'RETRY' | 'SENT' | 'DEAD' | 'SUPPRESSED';
export type WebhookFormat = 'slack' | 'discord' | 'generic';

export interface Incident {
  id: string;
  fingerprint: string;
  source: 'GRAFANA' | 'HEALTHCHECK';
  rule_uid: string | null;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service_name: string;
  alert_kind: string | null;
  summary: string | null;
  description: string | null;
  runbook_url: string | null;
  labels: Record<string, string>;
  source_started_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  last_notified_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_type: 'AUTO' | 'MANUAL' | null;
  resolution_note: string | null;
  version: number;
}

export interface IncidentEvent {
  id: string;
  event_type: string;
  actor_name: string | null;
  message: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DeliveryAttempt {
  id: string;
  attempt_no: number;
  outcome: 'SENT' | 'RETRY' | 'DEAD';
  status_code: number | null;
  error_code: string | null;
  duration_ms: number;
  created_at: string;
}

export interface Delivery {
  id: string;
  channel: ChannelType;
  kind: 'OPEN' | 'REOPENED' | 'RESOLVED' | 'TEST';
  status: DeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  attempts?: DeliveryAttempt[];
  channel_config?: { name: string; channel_type: ChannelType; secret_hint?: string | null };
  incident?: { id: string; title: string; severity: IncidentSeverity } | null;
}

export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
  deliveries: Delivery[];
}

export interface IncidentList {
  items: Incident[];
  total: number;
  page: number;
  page_size: number;
  services: string[];
}

export interface MonitoringCapabilities { read: boolean; manage: boolean; settings: boolean }

export interface PrometheusOverview {
  available: boolean;
  reason?: string;
  checked_at?: string;
  host?: { cpu_percent: number | null; memory_percent: number | null; disk_percent: number | null; host_uptime_seconds: number | null; api_error_rate: number | null; api_p95_ms: number | null };
  services?: Record<string, { up?: number | null; request_rate?: number | null; error_rate?: number | null; p95_ms?: number | null }>;
}

export interface MonitoringOverview {
  incidents: { open: number; by_severity: Record<IncidentSeverity, number>; open_by_service: Record<string, number> };
  recent_activity: Array<{ id: string; event_type: string; created_at: string; actor_name: string | null; incident: { id: string; title: string; severity: IncidentSeverity; service_name: string } }>;
  prometheus: PrometheusOverview;
}

export interface MonitoringAnalytics {
  window_days: number;
  total: number;
  open: number;
  mttd_seconds: number | null;
  mtta_seconds: number | null;
  mttr_seconds: number | null;
  acknowledged_samples: number;
  resolved_samples: number;
  by_severity: Array<{ key: IncidentSeverity; count: number }>;
  by_service: Array<{ key: string; count: number }>;
  by_category: Array<{ key: IncidentCategory; count: number }>;
  trend: Array<{ day: string; severity: IncidentSeverity; count: number }>;
  deliveries: { by_channel: Array<{ channel: ChannelType; sent: number; failed: number; pending: number }>; success_rate: number | null };
}

export interface AlertPolicy {
  id: string;
  name: string;
  description: string | null;
  match_rule_uid: string | null;
  match_category: IncidentCategory | null;
  match_severity: IncidentSeverity | null;
  email_enabled: boolean;
  in_app_enabled: boolean;
  webhook_enabled: boolean;
  notify_on_resolve: boolean;
  cooldown_minutes: number;
  enabled: boolean;
  is_default: boolean;
}

export interface PolicyWarning { policy_id: string; code: string; message: string }
export interface PolicyList { items: AlertPolicy[]; warnings: PolicyWarning[] }

export interface ChannelConfig {
  id: string;
  channel_type: ChannelType;
  name: string;
  enabled: boolean;
  config: { recipients?: string[]; format?: WebhookFormat };
  secret_hint: string | null;
  has_secret: boolean;
  max_attempts: number;
  last_test_at: string | null;
  last_test_status: 'SENT' | 'FAILED' | null;
  last_test_error: string | null;
}

export interface ChannelList {
  items: ChannelConfig[];
  smtp_configured: boolean;
  secret_key_configured: boolean;
  webhook_formats: WebhookFormat[];
}

export interface SystemNotification {
  id: string;
  incident_id: string;
  kind: string;
  severity: IncidentSeverity;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationList { items: SystemNotification[]; total: number; unread_count: number }

export interface IncidentQuery {
  status?: string;
  severity?: string;
  category?: string;
  service?: string;
  q?: string;
  page?: number;
  page_size?: number;
}

const base = '/monitoring';
const data = <T>(promise: Promise<{ data: T }>) => promise.then((response) => response.data);

export const incidentService = {
  capabilities: () => data<{ can: MonitoringCapabilities }>(gatewayAPI.get(`${base}/me`)).then((r) => r.can),
  overview: () => data<MonitoringOverview>(gatewayAPI.get(`${base}/overview`)),
  list: (params: IncidentQuery) => data<IncidentList>(gatewayAPI.get(`${base}/incidents`, { params })),
  get: (id: string) => data<IncidentDetail>(gatewayAPI.get(`${base}/incidents/${id}`)),
  acknowledge: (id: string, version: number, note?: string) => data<Incident>(gatewayAPI.post(`${base}/incidents/${id}/acknowledge`, { version, note })),
  resolve: (id: string, version: number, note?: string) => data<Incident>(gatewayAPI.post(`${base}/incidents/${id}/resolve`, { version, note })),
  addNote: (id: string, note: string) => data<IncidentEvent>(gatewayAPI.post(`${base}/incidents/${id}/notes`, { note })),
  analytics: (days: number) => data<MonitoringAnalytics>(gatewayAPI.get(`${base}/analytics`, { params: { days } })),
  policies: () => data<PolicyList>(gatewayAPI.get(`${base}/policies`)),
  createPolicy: (body: Partial<AlertPolicy>) => data<PolicyList & { policy: AlertPolicy }>(gatewayAPI.post(`${base}/policies`, body)),
  updatePolicy: (id: string, body: Partial<AlertPolicy>) => data<PolicyList & { policy: AlertPolicy }>(gatewayAPI.patch(`${base}/policies/${id}`, body)),
  deletePolicy: (id: string) => data<PolicyList>(gatewayAPI.delete(`${base}/policies/${id}`)),
  channels: () => data<ChannelList>(gatewayAPI.get(`${base}/channels`)),
  createChannel: (body: Record<string, unknown>) => data<ChannelConfig>(gatewayAPI.post(`${base}/channels`, body)),
  updateChannel: (id: string, body: Record<string, unknown>) => data<ChannelConfig>(gatewayAPI.patch(`${base}/channels/${id}`, body)),
  deleteChannel: (id: string) => data<{ deleted: string }>(gatewayAPI.delete(`${base}/channels/${id}`)),
  testChannel: (id: string) => data<{ status: 'SENT' | 'FAILED'; error: string | null }>(gatewayAPI.post(`${base}/channels/${id}/test`, {}, { validateStatus: (s) => s === 200 || s === 502 })),
  notifications: (params: { unread?: boolean; page?: number; page_size?: number } = {}) =>
    data<NotificationList>(gatewayAPI.get(`${base}/notifications`, { params: { ...params, unread: params.unread ? 1 : undefined } })),
  markRead: (id: string) => data<{ id: string; unread_count: number }>(gatewayAPI.post(`${base}/notifications/${id}/read`, {})),
  markAllRead: () => data<{ marked: number; unread_count: number }>(gatewayAPI.post(`${base}/notifications/read-all`, {})),
};
