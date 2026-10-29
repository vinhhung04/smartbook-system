import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Clock, PackagePlus, RefreshCw, Sparkles, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  analyticsService,
  type LateReturnRiskItem,
  type ReservationNoShowRiskItem,
  type RiskModelData,
  type WeedingSuggestionsData,
  type ReorderSuggestionsData,
} from '@/services/analytics';
import { getApiErrorMessage } from '@/services/api';
import { hasPermission } from '@/services/http-clients';
import { authService } from '@/services/auth';
import { canAccess, ROUTE_ACCESS } from '@/lib/rbac';
import { askChatbot } from '@/lib/chatbot-bus';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import { countByUrgency, formatCount, formatDateTime, type PlanLine } from '@/lib/reorder-intelligence';
import { DomainNavigation, type DomainTab } from '@/components/reorder-intelligence/domain-navigation';
import { panelId, tabId, type DomainId } from '@/components/reorder-intelligence/meta';
import { ReorderWorkspace } from '@/components/reorder-intelligence/reorder-workspace';
import { WeedingWorkspace } from '@/components/reorder-intelligence/weeding-workspace';
import { RiskWorkspace, type RiskDomainConfig } from '@/components/reorder-intelligence/risk-workspace';
import type { PurchaseOrderPrefill } from './purchase-order-form';

const LATE_RETURN: RiskDomainConfig = {
  id: 'late-return',
  icon: Clock,
  title: 'Rủi ro trả trễ',
  modelSummary: 'Mô hình hồi quy logistic ước tính khả năng một khoản mượn đang mở sẽ được trả sau hạn, học từ lịch sử mượn/trả của thư viện.',
  subjectNoun: 'khoản mượn',
  eventNoun: 'trả trễ',
  fromLabel: 'Mượn',
  toLabel: 'Hạn trả',
  pastDueLabel: 'Đã quá hạn trả',
  factorLabels: {
    loan_days: 'Số ngày được mượn',
    items_in_loan: 'Số đầu sách trong phiếu',
    prior_loans: 'Số lần mượn trước đây',
    prior_late_rate: 'Tỷ lệ trả trễ trước đây',
    prior_late_count: 'Số lần trả trễ trước đây',
    prior_renewal_rate: 'Tỷ lệ gia hạn trước đây',
    customer_tenure_days: 'Thời gian là thành viên',
    unpaid_fines_at_checkout: 'Tiền phạt chưa thanh toán',
    plan_max_loan_days: 'Hạn mượn theo gói thành viên',
    plan_fine_per_day: 'Mức phạt/ngày theo gói',
    from_reservation: 'Mượn từ đặt chỗ trước',
    condition_worn_at_checkout: 'Tình trạng sách khi mượn',
  },
  needs: 'Mô hình sẽ tự huấn luyện khi có thêm các khoản mượn đã kết thúc (đã trả, đúng hạn hoặc trễ hạn).',
  emptyTitle: 'Không có khoản mượn nào đang mở',
  emptyText: 'Mô hình đã sẵn sàng nhưng hiện không có khoản mượn nào cần chấm điểm rủi ro trả trễ.',
};

const NO_SHOW: RiskDomainConfig = {
  id: 'no-show',
  icon: UserX,
  title: 'Rủi ro bỏ lỡ đặt chỗ',
  modelSummary: 'Mô hình hồi quy logistic ước tính khả năng một đặt chỗ đang chờ sẽ hết hạn giữ mà bạn đọc không đến nhận sách.',
  subjectNoun: 'đặt chỗ',
  eventNoun: 'bỏ lỡ',
  fromLabel: 'Đặt lúc',
  toLabel: 'Hết hạn giữ',
  pastDueLabel: 'Đã hết hạn giữ',
  factorLabels: {
    hold_hours: 'Thời gian giữ chỗ',
    lead_hours: 'Thời gian đặt trước',
    quantity: 'Số lượng đặt',
    channel_web: 'Kênh đặt qua web',
    prior_reservations: 'Số lần đặt chỗ trước đây',
    prior_no_show_rate: 'Tỷ lệ bỏ lỡ trước đây',
    customer_tenure_days: 'Thời gian là thành viên',
    unpaid_fines_at_reservation: 'Tiền phạt chưa thanh toán',
    active_loans_at_reservation: 'Số phiếu đang mượn',
  },
  needs: 'Mô hình sẽ tự huấn luyện khi có thêm các đặt chỗ đã kết thúc (đã nhận sách hoặc hết hạn).',
  emptyTitle: 'Không có đặt chỗ nào đang chờ nhận',
  emptyText: 'Mô hình đã sẵn sàng nhưng hiện không có đặt chỗ nào cần chấm điểm rủi ro bỏ lỡ.',
};

export function ReorderSuggestionsPage() {
  const navigate = useNavigate();
  const canCreatePo = canAccess(authService.getCurrentUser(), ROUTE_ACCESS.purchaseWrite);
  const [activeTab, setActiveTab] = useState<DomainId>('reorder');
  // Borrow-domain risk models are gated by analytics.borrow.read; roles without it (e.g. warehouse manager) get 403.
  const canViewBorrowRisk = hasPermission('analytics.borrow.read');

  const [days, setDays] = useState(30);
  const [limit, setLimit] = useState(20);
  const [budgetVnd, setBudgetVnd] = useState<number | ''>('');
  const [data, setData] = useState<ReorderSuggestionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [weeding, setWeeding] = useState<WeedingSuggestionsData | null>(null);
  const [weedingLoading, setWeedingLoading] = useState(true);
  const [weedingError, setWeedingError] = useState<string | null>(null);

  const [lateReturn, setLateReturn] = useState<RiskModelData<LateReturnRiskItem> | null>(null);
  const [lateReturnLoading, setLateReturnLoading] = useState(true);
  const [lateReturnError, setLateReturnError] = useState<string | null>(null);

  const [noShow, setNoShow] = useState<RiskModelData<ReservationNoShowRiskItem> | null>(null);
  const [noShowLoading, setNoShowLoading] = useState(true);
  const [noShowError, setNoShowError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await analyticsService.getReorderSuggestions({
        days,
        priority: 'ALL',
        limit,
        budgetVnd: budgetVnd === '' ? undefined : budgetVnd,
      });
      setData(response);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Không thể tải gợi ý nhập thêm sách');
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [days, limit, budgetVnd]);

  const loadWeedingSuggestions = useCallback(async () => {
    try {
      setWeedingLoading(true);
      setWeedingError(null);
      const response = await analyticsService.getWeedingSuggestions({ days: 180, limit: 50 });
      setWeeding(response);
    } catch (err) {
      setWeedingError(getApiErrorMessage(err, 'Không thể tải danh sách sách nên thanh lý'));
    } finally {
      setWeedingLoading(false);
    }
  }, []);

  const loadLateReturnRisk = useCallback(async () => {
    try {
      setLateReturnLoading(true);
      setLateReturnError(null);
      const response = await analyticsService.getLateReturnRisk({ limit: 100 });
      setLateReturn(response);
    } catch (err) {
      setLateReturnError(getApiErrorMessage(err, 'Không thể tải dữ liệu rủi ro trả trễ'));
    } finally {
      setLateReturnLoading(false);
    }
  }, []);

  const loadNoShowRisk = useCallback(async () => {
    try {
      setNoShowLoading(true);
      setNoShowError(null);
      const response = await analyticsService.getReservationNoShowRisk({ limit: 100 });
      setNoShow(response);
    } catch (err) {
      setNoShowError(getApiErrorMessage(err, 'Không thể tải dữ liệu rủi ro bỏ lỡ đặt chỗ'));
    } finally {
      setNoShowLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    void loadWeedingSuggestions();
  }, [loadWeedingSuggestions]);

  useEffect(() => {
    if (canViewBorrowRisk) void loadLateReturnRisk();
  }, [canViewBorrowRisk, loadLateReturnRisk]);

  useEffect(() => {
    if (canViewBorrowRisk) void loadNoShowRisk();
  }, [canViewBorrowRisk, loadNoShowRisk]);

  const urgency = useMemo(
    () => countByUrgency(Array.isArray(data?.items) ? data.items : [], data?.range.leadTimeDays ?? 14),
    [data],
  );

  const createPurchaseOrder = (lines: PlanLine[]) => {
    const prefill: PurchaseOrderPrefill = {
      note: `Tạo từ đề xuất nhập thêm (${days} ngày qua, ${new Date().toLocaleDateString('vi-VN')})`,
      lines: lines.filter((line) => line.qty !== null).map((line) => ({
        variant_id: line.item.variant_id,
        title: line.item.title,
        isbn13: line.item.isbn || null,
        ordered_qty: line.qty as number,
        unit_cost: line.item.unit_cost || 0,
      })),
    };
    navigate('/purchase-orders/new', { state: { prefill } });
  };

  const askAiPrompts: Record<DomainId, string> = {
    reorder: `Giải thích danh sách đề xuất nhập thêm sách hiện tại (nhu cầu ${days} ngày qua): sách nào cần đặt gấp và vì sao?`,
    weeding: 'Giải thích danh sách sách nên thanh lý hoặc chuyển kho hiện tại.',
    'late-return': 'Giải thích các khoản mượn có nguy cơ trả trễ cao và đề xuất cách xử lý.',
    'no-show': 'Giải thích các đặt chỗ có nguy cơ bỏ lỡ cao và đề xuất cách xử lý.',
  };

  const handleAskAi = async () => {
    const prompt = askAiPrompts[activeTab];
    if (askChatbot(prompt)) return;
    // Roles with the full assistant page have no floating chatbot; hand the question over there.
    if (canAccess(authService.getCurrentUser(), ROUTE_ACCESS.aiAssistant)) {
      navigate('/ai-assistant', { state: { prompt } });
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('Đã sao chép prompt để hỏi AI chatbot');
    } catch {
      toast.info(prompt);
    }
  };

  const handleRefreshActiveTab = () => {
    if (activeTab === 'reorder') void loadData();
    else if (activeTab === 'weeding') void loadWeedingSuggestions();
    else if (activeTab === 'late-return') void loadLateReturnRisk();
    else void loadNoShowRisk();
  };

  const activeLoading =
    activeTab === 'reorder' ? loading
      : activeTab === 'weeding' ? weedingLoading
      : activeTab === 'late-return' ? lateReturnLoading
      : noShowLoading;
  const activeGeneratedAt =
    activeTab === 'reorder' ? data?.generated_at
      : activeTab === 'weeding' ? weeding?.generated_at
      : activeTab === 'late-return' ? lateReturn?.generated_at
      : noShow?.generated_at;

  const riskTab = (
    id: DomainId,
    config: RiskDomainConfig,
    model: RiskModelData<{ risk_band: string }> | null,
    isLoading: boolean,
    isError: string | null,
  ): DomainTab => {
    if (isError && !model) return { id, label: config.title, icon: config.icon, value: null, caption: 'Không tải được' };
    if (!model) return { id, label: config.title, icon: config.icon, value: null, caption: 'Đang chấm điểm…', busy: isLoading };
    if (model.status === 'INSUFFICIENT_DATA') return { id, label: config.title, icon: config.icon, value: null, caption: 'Chưa đủ dữ liệu' };
    return {
      id,
      label: config.title,
      icon: config.icon,
      value: model.items.filter((item) => item.risk_band === 'HIGH').length,
      caption: `nguy cơ cao / ${formatCount(model.items.length)}`,
      busy: isLoading,
    };
  };

  const tabs: DomainTab[] = [
    {
      id: 'reorder',
      label: 'Nhập thêm sách',
      icon: PackagePlus,
      value: data ? urgency.OUT + urgency.BEFORE_RESTOCK : null,
      caption: data ? `cần xem xét gấp · ${formatCount(data.summary.total_candidates)} đầu sách` : error ? 'Không tải được' : 'Đang phân tích…',
      alert: urgency.OUT > 0,
      busy: loading,
    },
    {
      id: 'weeding',
      label: 'Thanh lý / chuyển kho',
      icon: Archive,
      value: weeding ? weeding.summary.total_items : null,
      caption: weeding ? 'dòng tồn lâu, không hoạt động' : weedingError ? 'Không tải được' : 'Đang kiểm tra…',
      busy: weedingLoading,
    },
    ...(canViewBorrowRisk ? [
      riskTab('late-return', LATE_RETURN, lateReturn, lateReturnLoading, lateReturnError),
      riskTab('no-show', NO_SHOW, noShow, noShowLoading, noShowError),
    ] : []),
  ];

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Entrance once; afterwards only the switched-in workspace moves, so the eye
  // lands on the new content. Transform/opacity only, skipped for reduced motion.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from('[data-reveal]', { autoAlpha: 0, y: 10, duration: 0.6, stagger: 0.06, ease: EASE_OUT });
    });
    return () => mm.revert();
  }, { scope: rootRef });

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      if (panelRef.current) gsap.from(panelRef.current, { autoAlpha: 0, y: 8, duration: 0.4, ease: EASE_OUT, clearProps: 'all' });
    });
    return () => mm.revert();
  }, { dependencies: [activeTab], revertOnUpdate: true });

  return (
    <div ref={rootRef} className="mx-auto max-w-[1440px] space-y-5 p-4 pb-10 sm:p-6 lg:p-8">
      <header data-reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[12px] font-medium text-primary">Trung tâm hỗ trợ quyết định</p>
          <h1 className="font-[family-name:var(--font-display)] text-[26px] font-medium leading-tight tracking-[-0.01em] text-foreground sm:text-[30px]">
            Đề xuất & cảnh báo rủi ro
          </h1>
          <p className="max-w-[72ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Xem sách nào cần nhập, vì sao, trong ngân sách nào — cùng tồn kho tồn đọng và các khoản mượn, đặt chỗ có nguy cơ.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleAskAi()} title="Mở trợ lý AI với câu hỏi về mục đang xem — bạn vẫn quyết định có gửi hay không">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Hỏi AI về mục này
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleRefreshActiveTab} disabled={activeLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${activeLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Làm mới
            </Button>
          </div>
          <p className="text-[11.5px] text-muted-foreground" aria-live="polite">
            {activeLoading ? 'Đang cập nhật…' : activeGeneratedAt ? `Cập nhật ${formatDateTime(activeGeneratedAt)}` : ' '}
          </p>
        </div>
      </header>

      <div data-reveal>
        <DomainNavigation tabs={tabs} active={activeTab} onChange={setActiveTab} />
      </div>

      <div ref={panelRef} id={panelId(activeTab)} role="tabpanel" aria-labelledby={tabId(activeTab)} tabIndex={-1} className="outline-none">
        {activeTab === 'reorder' && (
          <ReorderWorkspace
            data={data}
            loading={loading}
            error={error}
            onRetry={() => void loadData()}
            days={days}
            onDaysChange={setDays}
            limit={limit}
            onLimitChange={setLimit}
            budgetVnd={budgetVnd}
            onBudgetChange={setBudgetVnd}
            canCreatePo={canCreatePo}
            onCreatePurchaseOrder={createPurchaseOrder}
          />
        )}
        {activeTab === 'weeding' && (
          <WeedingWorkspace data={weeding} loading={weedingLoading} error={weedingError} onRetry={() => void loadWeedingSuggestions()} />
        )}
        {activeTab === 'late-return' && canViewBorrowRisk && (
          <RiskWorkspace
            key="late-return"
            config={LATE_RETURN}
            data={lateReturn}
            loading={lateReturnLoading}
            error={lateReturnError}
            onRetry={() => void loadLateReturnRisk()}
            rows={(lateReturn?.items ?? []).map((item) => ({
              key: item.loan_item_id,
              customer: item.customer_name || 'Chưa xác định',
              title: item.title || 'Chưa xác định',
              from: item.borrow_date,
              to: item.due_date,
              score: item.risk_score,
              band: item.risk_band,
              factors: item.top_factors,
            }))}
          />
        )}
        {activeTab === 'no-show' && canViewBorrowRisk && (
          <RiskWorkspace
            key="no-show"
            config={NO_SHOW}
            data={noShow}
            loading={noShowLoading}
            error={noShowError}
            onRetry={() => void loadNoShowRisk()}
            rows={(noShow?.items ?? []).map((item) => ({
              key: item.reservation_id,
              customer: item.customer_name || 'Chưa xác định',
              title: item.title || 'Chưa xác định',
              from: item.reserved_at,
              to: item.expires_at,
              score: item.risk_score,
              band: item.risk_band,
              factors: item.top_factors,
            }))}
          />
        )}
      </div>
    </div>
  );
}
