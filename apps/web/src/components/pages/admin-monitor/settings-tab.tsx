import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { LoadingOverlay } from '@/components/ui/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/components/ui/utils';
import { getApiErrorMessage } from '@/services/http-clients';
import {
  incidentService, type AlertPolicy, type ChannelConfig, type ChannelList, type IncidentCategory, type IncidentSeverity, type PolicyList, type WebhookFormat,
} from '@/services/incidents';
import { CATEGORY_LABEL, CHANNEL_LABEL, SEVERITY_META, formatDateTime } from './incident-format';

const FORMAT_LABEL: Record<WebhookFormat, string> = { slack: 'Slack', discord: 'Discord', generic: 'JSON tùy chỉnh' };
const RETRY_SCHEDULE = '30 giây → 2 phút → 10 phút → 30 phút → 1 giờ → 2 giờ…';

function Section({ id, title, description, children, action }: { id: string; title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <h2 id={id} className="font-display text-[18px] font-semibold tracking-tight text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TestResult({ channel }: { channel: ChannelConfig }) {
  if (!channel.last_test_at) return null;
  return (
    <p className={cn('text-[12px]', channel.last_test_status === 'SENT' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
      Thử lúc {formatDateTime(channel.last_test_at)}: {channel.last_test_status === 'SENT' ? 'thành công' : `thất bại${channel.last_test_error ? ` (${channel.last_test_error})` : ''}`}
    </p>
  );
}

function ChannelRow({ channel, editable, onChanged }: { channel: ChannelConfig; editable: boolean; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(channel.name);
  const [recipients, setRecipients] = useState((channel.config.recipients || []).join('\n'));
  const [url, setUrl] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(String(channel.max_attempts));
  const [busy, setBusy] = useState<'save' | 'test' | 'toggle' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = name !== channel.name || String(channel.max_attempts) !== maxAttempts || url.trim() !== ''
    || (channel.channel_type === 'EMAIL' && recipients !== (channel.config.recipients || []).join('\n'));

  const run = async (kind: 'save' | 'test' | 'toggle', task: () => Promise<unknown>, success: string) => {
    setBusy(kind);
    try { await task(); toast.success(success); await onChanged(); if (kind === 'save') setUrl(''); }
    catch (error) { toast.error(getApiErrorMessage(error, 'Không cập nhật được kênh')); }
    finally { setBusy(null); }
  };
  const save = () => run('save', () => incidentService.updateChannel(channel.id, {
    name: name.trim(), max_attempts: Number(maxAttempts),
    ...(channel.channel_type === 'EMAIL' ? { recipients: recipients.split(/[\n,;]+/).map((r) => r.trim()).filter(Boolean) } : {}),
    ...(channel.channel_type === 'WEBHOOK' && url.trim() ? { url: url.trim() } : {}),
  }), 'Đã lưu kênh');
  const test = async () => {
    setBusy('test');
    try {
      const result = await incidentService.testChannel(channel.id);
      if (result.status === 'SENT') toast.success('Đã gửi thông báo thử'); else toast.error(`Gửi thử thất bại: ${result.error || 'không rõ lỗi'}`);
      await onChanged();
    } catch (error) { toast.error(getApiErrorMessage(error, 'Không gửi được thông báo thử')); }
    finally { setBusy(null); }
  };

  return (
    <li className="border-b border-border px-5 py-4 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-foreground">{channel.name}</p>
          <p className="text-[12px] text-muted-foreground">
            {CHANNEL_LABEL[channel.channel_type]}
            {channel.channel_type === 'WEBHOOK' ? ` · ${FORMAT_LABEL[channel.config.format || 'generic']} · ${channel.secret_hint || 'chưa có URL'}` : ''}
            {channel.channel_type === 'EMAIL' ? ` · ${(channel.config.recipients || []).length} người nhận` : ''}
          </p>
          <TestResult channel={channel} />
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-foreground">
            <Switch checked={channel.enabled} disabled={!editable || busy !== null} aria-label={`Bật kênh ${channel.name}`}
              onCheckedChange={(enabled) => void run('toggle', () => incidentService.updateChannel(channel.id, { enabled }), enabled ? 'Đã bật kênh' : 'Đã tắt kênh')} />
            {channel.enabled ? 'Đang bật' : 'Đang tắt'}
          </label>
          {editable ? <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void test()} loading={busy === 'test'} loadingLabel="Đang gửi thử"><Send className="h-4 w-4" />Gửi thử</Button> : null}
          {editable && channel.channel_type !== 'IN_APP' ? (
            <Button type="button" variant="outline" size="sm" aria-label={`Xóa kênh ${channel.name}`} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
          ) : null}
        </div>
      </div>
      {editable && channel.channel_type !== 'IN_APP' ? (
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px_auto] md:items-end">
          <label className="text-[12px] text-muted-foreground">Tên kênh
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="mt-1 h-9" />
          </label>
          {channel.channel_type === 'EMAIL' ? (
            <label className="text-[12px] text-muted-foreground">Người nhận (mỗi dòng một email)
              <Textarea value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={2} className="mt-1" />
            </label>
          ) : (
            <label className="text-[12px] text-muted-foreground">Thay URL webhook (để trống nếu giữ nguyên)
              <Input type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-1 h-9" />
            </label>
          )}
          <label className="text-[12px] text-muted-foreground">Số lần thử tối đa
            <Input type="number" min={1} max={12} value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} className="mt-1 h-9" />
          </label>
          <Button type="button" size="sm" disabled={!dirty} onClick={() => void save()} loading={busy === 'save'} loadingLabel="Đang lưu">Lưu</Button>
        </div>
      ) : null}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} variant="destructive" title={`Xóa kênh "${channel.name}"?`}
        description="Các thông báo đang chờ gửi qua kênh này sẽ bị hủy. Lịch sử sự cố vẫn được giữ." confirmLabel="Xóa kênh"
        onConfirm={async () => { try { await incidentService.deleteChannel(channel.id); toast.success('Đã xóa kênh'); setConfirmDelete(false); await onChanged(); } catch (error) { toast.error(getApiErrorMessage(error, 'Không xóa được kênh')); } }} />
    </li>
  );
}

function NewChannelForm({ formats, onCreated }: { formats: WebhookFormat[]; onCreated: () => Promise<void> }) {
  const [type, setType] = useState<'EMAIL' | 'WEBHOOK'>('EMAIL');
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState('');
  const [format, setFormat] = useState<WebhookFormat>(formats[0] || 'slack');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await incidentService.createChannel(type === 'EMAIL'
        ? { channel_type: 'EMAIL', name: name.trim(), recipients: recipients.split(/[\n,;]+/).map((r) => r.trim()).filter(Boolean) }
        : { channel_type: 'WEBHOOK', name: name.trim(), format, url: url.trim() });
      toast.success('Đã thêm kênh');
      setName(''); setRecipients(''); setUrl('');
      await onCreated();
    } catch (error) { toast.error(getApiErrorMessage(error, 'Không thêm được kênh')); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 border-t border-border bg-muted/20 px-5 py-4 md:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.4fr)_auto] md:items-end">
      <label className="text-[12px] text-muted-foreground">Loại kênh
        <Select value={type} onValueChange={(v) => setType(v as 'EMAIL' | 'WEBHOOK')}>
          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="EMAIL">Email</SelectItem><SelectItem value="WEBHOOK">Webhook</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="text-[12px] text-muted-foreground">Tên kênh
        <Input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={type === 'EMAIL' ? 'Đội vận hành' : 'Kênh #sự-cố'} className="mt-1 h-9" />
      </label>
      {type === 'EMAIL' ? (
        <label className="text-[12px] text-muted-foreground">Người nhận (mỗi dòng một email)
          <Textarea required value={recipients} onChange={(e) => setRecipients(e.target.value)} rows={1} className="mt-1" />
        </label>
      ) : (
        <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
          <label className="text-[12px] text-muted-foreground">Định dạng
            <Select value={format} onValueChange={(v) => setFormat(v as WebhookFormat)}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{formats.map((f) => <SelectItem key={f} value={f}>{FORMAT_LABEL[f]}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="text-[12px] text-muted-foreground">URL webhook (HTTPS)
            <Input required type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" className="mt-1 h-9" />
          </label>
        </div>
      )}
      <Button type="submit" size="sm" className="gap-2" loading={saving} loadingLabel="Đang thêm"><Plus className="h-4 w-4" />Thêm kênh</Button>
    </form>
  );
}

function PolicyRow({ policy, editable, onSaved }: { policy: AlertPolicy; editable: boolean; onSaved: (result: PolicyList) => void }) {
  const [cooldown, setCooldown] = useState(String(policy.cooldown_minutes));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setCooldown(String(policy.cooldown_minutes)), [policy.cooldown_minutes]);
  const patch = async (body: Partial<AlertPolicy>) => {
    setBusy(true);
    try { onSaved(await incidentService.updatePolicy(policy.id, body)); }
    catch (error) { toast.error(getApiErrorMessage(error, 'Không lưu được chính sách')); }
    finally { setBusy(false); }
  };
  const scope = [
    policy.match_rule_uid ? `Rule ${policy.match_rule_uid}` : null,
    policy.match_category ? CATEGORY_LABEL[policy.match_category] : null,
    policy.match_severity ? SEVERITY_META[policy.match_severity].label : null,
  ].filter(Boolean).join(' · ') || 'Mọi cảnh báo';
  const toggle = (key: keyof AlertPolicy, label: string) => (
    <td className="px-3 py-3 text-center">
      <Switch checked={Boolean(policy[key])} disabled={!editable || busy} aria-label={`${label}: ${policy.name}`} onCheckedChange={(value) => void patch({ [key]: value })} />
    </td>
  );
  return (
    <tr className={cn('border-b border-border last:border-0', !policy.enabled && 'opacity-60')}>
      <td className="px-5 py-3">
        <p className="font-semibold text-foreground">{policy.name}</p>
        <p className="text-[12px] text-muted-foreground">{scope}</p>
      </td>
      {toggle('email_enabled', 'Email')}
      {toggle('in_app_enabled', 'Trong ứng dụng')}
      {toggle('webhook_enabled', 'Webhook')}
      {toggle('notify_on_resolve', 'Báo khi phục hồi')}
      <td className="px-3 py-3">
        <Input type="number" min={0} max={1440} value={cooldown} disabled={!editable || busy} aria-label={`Thời gian chờ (phút): ${policy.name}`}
          onChange={(e) => setCooldown(e.target.value)} onBlur={() => { if (cooldown !== String(policy.cooldown_minutes)) void patch({ cooldown_minutes: Number(cooldown) }); }}
          className="h-8 w-20 tabular-nums" />
      </td>
      {toggle('enabled', 'Bật chính sách')}
      <td className="px-5 py-3 text-right">
        {editable && !policy.is_default ? <Button type="button" variant="outline" size="sm" aria-label={`Xóa chính sách ${policy.name}`} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button> : null}
        <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} variant="destructive" title={`Xóa chính sách "${policy.name}"?`} confirmLabel="Xóa"
          description="Cảnh báo khớp chính sách này sẽ dùng chính sách chung hơn."
          onConfirm={async () => { try { onSaved(await incidentService.deletePolicy(policy.id)); setConfirmDelete(false); } catch (error) { toast.error(getApiErrorMessage(error, 'Không xóa được chính sách')); } }} />
      </td>
    </tr>
  );
}

function NewPolicyForm({ onCreated }: { onCreated: (result: PolicyList) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<IncidentCategory | 'ANY'>('ANY');
  const [severity, setSeverity] = useState<IncidentSeverity | 'ANY'>('ANY');
  const [ruleUid, setRuleUid] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onCreated(await incidentService.createPolicy({
        name: name.trim(), match_category: category === 'ANY' ? null : category, match_severity: severity === 'ANY' ? null : severity,
        match_rule_uid: ruleUid.trim() || null, in_app_enabled: true, email_enabled: false, webhook_enabled: false,
      }));
      toast.success('Đã thêm chính sách, hãy chọn kênh cho nó');
      setName(''); setRuleUid('');
    } catch (error) { toast.error(getApiErrorMessage(error, 'Không thêm được chính sách')); }
    finally { setSaving(false); }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 border-t border-border bg-muted/20 px-5 py-4 md:grid-cols-[minmax(0,1fr)_150px_150px_minmax(0,1fr)_auto] md:items-end">
      <label className="text-[12px] text-muted-foreground">Tên chính sách
        <Input required value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="mt-1 h-9" />
      </label>
      <label className="text-[12px] text-muted-foreground">Phân loại
        <Select value={category} onValueChange={(v) => setCategory(v as IncidentCategory | 'ANY')}>
          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ANY">Bất kỳ</SelectItem>{(Object.keys(CATEGORY_LABEL) as IncidentCategory[]).map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="text-[12px] text-muted-foreground">Mức độ
        <Select value={severity} onValueChange={(v) => setSeverity(v as IncidentSeverity | 'ANY')}>
          <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ANY">Bất kỳ</SelectItem>{(Object.keys(SEVERITY_META) as IncidentSeverity[]).map((s) => <SelectItem key={s} value={s}>{SEVERITY_META[s].label}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="text-[12px] text-muted-foreground">Chỉ cho rule (uid, không bắt buộc)
        <Input value={ruleUid} onChange={(e) => setRuleUid(e.target.value)} maxLength={100} placeholder="smartbook-low-stock-critical" className="mt-1 h-9 font-mono text-[12px]" />
      </label>
      <Button type="submit" size="sm" className="gap-2" loading={saving} loadingLabel="Đang thêm"><Plus className="h-4 w-4" />Thêm</Button>
    </form>
  );
}

export function SettingsTab({ editable }: { editable: boolean }) {
  const [channels, setChannels] = useState<ChannelList | null>(null);
  const [policies, setPolicies] = useState<PolicyList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => Promise.all([incidentService.channels(), incidentService.policies()]).then(
    ([c, p]) => { setChannels(c); setPolicies(p); setError(null); },
    (err) => { setError(getApiErrorMessage(err, 'Không tải được cấu hình thông báo')); },
  ), []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <EmptyState variant="error" title="Không tải được cấu hình thông báo" description={error} action={<Button type="button" onClick={() => void load()}>Thử lại</Button>} />;
  if (!channels || !policies) return <div className="rounded-2xl border border-border bg-card"><LoadingOverlay /></div>;

  return (
    <div className="space-y-5">
      {!editable ? <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-[13px] text-muted-foreground">Bạn chỉ có quyền xem cấu hình. Cần quyền <span className="font-mono text-[12px]">monitoring.settings.manage</span> để thay đổi.</p> : null}

      <Section id="channels-title" title="Kênh thông báo" description={`Thông báo lỗi được thử lại tự động: ${RETRY_SCHEDULE}`}>
        {!channels.smtp_configured || !channels.secret_key_configured ? (
          <div className="space-y-1 border-b border-border bg-amber-50/60 px-5 py-3 text-[12px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {!channels.smtp_configured ? <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />SMTP chưa được cấu hình trên máy chủ: email cảnh báo sẽ thất bại cho đến khi đặt SMTP_HOST.</p> : null}
            {!channels.secret_key_configured ? <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Chưa có MONITORING_SECRET_KEY: không lưu được URL webhook.</p> : null}
          </div>
        ) : null}
        <ul>{channels.items.map((channel) => <ChannelRow key={channel.id} channel={channel} editable={editable} onChanged={load} />)}</ul>
        {editable ? <NewChannelForm formats={channels.webhook_formats} onCreated={load} /> : null}
      </Section>

      <Section id="policies-title" title="Chính sách định tuyến" description="Chính sách cụ thể nhất sẽ được áp dụng: rule > phân loại + mức độ > mức độ > phân loại > mặc định. Thời gian chờ chặn việc báo lại khi sự cố tái diễn liên tục.">
        {policies.warnings.length ? (
          <div className="space-y-1 border-b border-border bg-red-50/70 px-5 py-3 text-[12px] font-medium text-red-800 dark:bg-red-500/10 dark:text-red-300" role="alert">
            {policies.warnings.map((warning) => <p key={warning.policy_id + warning.code} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{warning.message}</p>)}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-border text-[12px] text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Chính sách</th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">Email</th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">Trong ứng dụng</th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">Webhook</th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">Báo phục hồi</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Chờ (phút)</th>
                <th scope="col" className="px-3 py-2.5 text-center font-medium">Bật</th>
                <th scope="col" className="px-5 py-2.5"><span className="sr-only">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>{policies.items.map((policy) => <PolicyRow key={policy.id} policy={policy} editable={editable} onSaved={setPolicies} />)}</tbody>
          </table>
        </div>
        {editable ? <NewPolicyForm onCreated={setPolicies} /> : null}
      </Section>
    </div>
  );
}
