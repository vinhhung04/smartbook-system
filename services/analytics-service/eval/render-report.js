// Fills the auto-generated sections of docs/ANALYSIS/REORDER_DECISION_EVALUATION.md
// from the evaluation results. Every number and every comparison word
// ("cao hơn", "thấp hơn"...) in those sections is computed here from the
// results - nothing is typed by hand - so re-running the pipeline with another
// seed rewrites them consistently. Sections are delimited by
//   <!-- AUTO:<name>:start --> ... <!-- AUTO:<name>:end -->

const pct = (x, digits = 2) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
const num = (x, digits = 1) => (x === null || x === undefined ? '—' : Number(x).toFixed(digits));
const int = (x) => (x === null || x === undefined ? '—' : String(Math.round(x)));
const mvnd = (x) => (x === null || x === undefined ? '—' : `${(x / 1e6).toFixed(1)}`);
const pp = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)} điểm %`;

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

const MODEL_LABEL = {
  NAIVE_LAST_VALUE: 'Naive (giá trị cuối)',
  MOVING_AVERAGE_7: 'MA7',
  MOVING_AVERAGE_30: 'MA30',
  CURRENT_EWMA_TREND: 'EWMA + trend (production)',
  CROSTON: 'Croston',
  SBA: 'SBA',
  TSB: 'TSB',
};

function forecastSection({ forecast }) {
  const parts = [
    `Dữ liệu: ${forecast.variants_with_demand} variant có lượt mượn trong ${forecast.protocol.window_days} ngày cuối; `
      + `tỉ lệ ngày không có lượt mượn trung bình ${pct(forecast.mean_zero_demand_day_share, 1)}; `
      + `phân lớp nhu cầu (Syntetos–Boylan): ${Object.entries(forecast.demand_class_counts).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
  ];
  for (const h of forecast.horizons) {
    const sorted = [...h.overall].sort((a, b) => a.mae - b.mae);
    parts.push(`\n**Horizon ${h.horizon_days} ngày** (${h.variants_backtested} variant, ${h.overall[0].samples} điểm dự báo mỗi mô hình; sắp xếp theo MAE)\n`);
    parts.push(table(
      ['Mô hình', 'MAE', 'RMSE', 'WAPE', 'MAPE (ngày có cầu)', 'Bias', 'Số variant thắng (MAE)'],
      sorted.map((m) => [MODEL_LABEL[m.model] || m.model, num(m.mae, 4), num(m.rmse, 4), num(m.wape, 3), num(m.mape, 3), num(m.bias, 4), String(h.best_model_votes[m.model])]),
    ));
  }
  const h7 = forecast.horizons[0];
  parts.push(`\n**MAE theo lớp nhu cầu, horizon ${h7.horizon_days} ngày**\n`);
  const models = h7.overall.map((m) => m.model);
  parts.push(table(
    ['Lớp nhu cầu', 'Số variant', ...models.map((m) => MODEL_LABEL[m] || m)],
    h7.by_demand_class.map((c) => [c.demand_class, String(c.variants), ...models.map((m) => num(c.models.find((x) => x.model === m).mae, 4))]),
  ));
  return parts.join('\n');
}

function policyTable(rows, windowKey) {
  return table(
    ['Chính sách', 'Fill rate', 'Unmet', 'Stockout days', 'Stockout rate', 'Tồn kho TB (bản)', 'Tồn kho max', 'Số bản đặt', 'Số đơn', 'Chi phí (triệu VND)', 'Cỡ đơn TB'],
    rows.map((p) => {
      const m = p[windowKey];
      return [p.policy || p.variant, pct(m.fill_rate), int(m.unmet_demand), int(m.stockout_days), pct(m.stockout_rate, 3), num(m.average_inventory), int(m.max_inventory), int(m.ordered_units), int(m.order_count), mvnd(m.procurement_cost), num(m.average_order_size, 2)];
    }),
  );
}

function reorderSection({ reorder }) {
  const p = reorder.protocol;
  const parts = [
    `Cửa sổ chấm điểm: ${p.scoring_start} → ${p.scoring_end_exclusive} (không gồm ngày cuối), ${p.evaluated_days} ngày × ${p.variants} variant; `
      + `xem xét đặt hàng mỗi ${p.review_period_days} ngày. Tồn kho = tổng số bản sở hữu của toàn danh mục (cả bản đang cho mượn).`,
  ];
  for (const s of reorder.scenarios) {
    const rows = reorder.policies.filter((x) => x.scenario === s.id);
    parts.push(`\n**Kịch bản ${s.id}** — ${s.description} Bộ sưu tập ban đầu: ${s.initial_catalog_copies} bản.\n`);
    parts.push(policyTable(rows, 'metrics'));
    const budget = rows.find((x) => x.policy === 'SMARTBOOK_BUDGET_MATCHED');
    parts.push(`\nNgân sách SMARTBOOK_BUDGET_MATCHED: ${mvnd(s.budget_per_review_vnd)} triệu VND/lần xem xét; `
      + `mức sử dụng ${pct(budget.metrics.budget_utilization, 1)}; ${int(budget.metrics.unfunded_reorder_count)} dòng đề xuất không được cấp vốn.`);
  }
  return parts.join('\n');
}

function steadySection({ reorder }) {
  const p = reorder.protocol;
  const parts = [`Cửa sổ ổn định: từ ${p.steady_state_start} (${p.steady_state_days} ngày). Chi phí và số đơn chỉ tính các đơn đặt trong cửa sổ này.`];
  for (const s of reorder.scenarios) {
    parts.push(`\n**Kịch bản ${s.id}**\n`);
    parts.push(policyTable(reorder.policies.filter((x) => x.scenario === s.id), 'steady_state_metrics'));
  }
  return parts.join('\n');
}

function ablationSection({ reorder }) {
  const parts = [];
  for (const s of reorder.scenarios) {
    const rows = reorder.ablation.filter((a) => a.scenario === s.id);
    const full = rows.find((a) => a.variant === 'SMARTBOOK_FULL' && !a.budget_constrained).metrics;
    const fullBudget = rows.find((a) => a.variant === 'SMARTBOOK_FULL' && a.budget_constrained).metrics;
    parts.push(`\n**Kịch bản ${s.id}** (Δ so với SMARTBOOK_FULL cùng điều kiện ngân sách)\n`);
    parts.push(table(
      ['Biến thể', 'Ngân sách', 'Fill rate', 'Δ fill', 'Stockout days', 'Δ stockout', 'Tồn kho TB', 'Δ tồn kho', 'Chi phí (triệu)', 'Δ chi phí'],
      rows.map((a) => {
        const base = a.budget_constrained ? fullBudget : full;
        const m = a.metrics;
        const rel = (x, y) => (y ? `${((x / y - 1) * 100).toFixed(1)}%` : '—');
        return [a.variant, a.budget_constrained ? 'có' : 'không', pct(m.fill_rate), pp(m.fill_rate - base.fill_rate), int(m.stockout_days), `${m.stockout_days - base.stockout_days >= 0 ? '+' : ''}${m.stockout_days - base.stockout_days}`, num(m.average_inventory), rel(m.average_inventory, base.average_inventory), mvnd(m.procurement_cost), rel(m.procurement_cost, base.procurement_cost)];
      }),
    ));
  }
  return parts.join('\n');
}

function leadTimeSection({ leadTime }) {
  const parts = [
    `Trạng thái: **${leadTime.status}** — nguồn \`${leadTime.source}\`: ${leadTime.deliveries} lần giao, ${leadTime.variants} variant, ${leadTime.suppliers} nhà cung cấp; `
      + `${leadTime.paired_samples} lần giao đủ điều kiện so sánh cặp (cần ≥ ${leadTime.min_evaluation_samples}).`,
  ];
  if (leadTime.note) parts.push(`\n${leadTime.note}`);
  parts.push('');
  parts.push(table(
    ['Phương pháp', 'Mẫu dự đoán được', 'MAE (ngày)', 'Median AE', 'RMSE', 'Mẫu so sánh cặp', 'MAE cặp'],
    leadTime.methods.map((m) => [m.method, String(m.applicable.samples), num(m.applicable.mae, 2), num(m.applicable.median_absolute_error, 2), num(m.applicable.rmse, 2), m.paired ? String(m.paired.samples) : '—', m.paired ? num(m.paired.mae, 2) : '—']),
  ));
  return parts.join('\n');
}

function compareWord(delta, { higher = 'cao hơn', lower = 'thấp hơn', equal = 'bằng', eps = 1e-12 } = {}) {
  if (Math.abs(delta) <= eps) return equal;
  return delta > 0 ? higher : lower;
}

function findingsSection({ forecast, reorder }) {
  const lines = [];
  for (const h of forecast.horizons) {
    const byMae = [...h.overall].sort((a, b) => a.mae - b.mae);
    const rank = byMae.findIndex((m) => m.model === 'CURRENT_EWMA_TREND') + 1;
    const ewma = h.overall.find((m) => m.model === 'CURRENT_EWMA_TREND');
    const bestIntermittent = byMae.find((m) => ['CROSTON', 'SBA', 'TSB'].includes(m.model));
    lines.push(`- Dự báo, horizon ${h.horizon_days} ngày: MAE thấp nhất là ${MODEL_LABEL[byMae[0].model]} (${num(byMae[0].mae, 4)}); `
      + `EWMA + trend (production) xếp hạng ${rank}/${byMae.length} (MAE ${num(ewma.mae, 4)}, bias ${num(ewma.bias, 4)}); `
      + `mô hình intermittent tốt nhất là ${MODEL_LABEL[bestIntermittent.model]} (MAE ${num(bestIntermittent.mae, 4)}, `
      + `${compareWord(bestIntermittent.mae - ewma.mae)} EWMA ${num(Math.abs(bestIntermittent.mae / ewma.mae - 1) * 100, 1)}%).`);
  }
  for (const s of reorder.scenarios) {
    const get = (name, key = 'metrics') => reorder.policies.find((p) => p.scenario === s.id && p.policy === name)[key];
    for (const key of ['metrics', 'steady_state_metrics']) {
      const sb = get('SMARTBOOK', key);
      const label = key === 'metrics' ? 'toàn cửa sổ' : 'cửa sổ ổn định';
      for (const baseline of ['REORDER_POINT', 'MA30_FIXED_LT']) {
        const b = get(baseline, key);
        lines.push(`- ${s.id}, ${label}: SMARTBOOK so với ${baseline} — fill rate ${pct(sb.fill_rate)} vs ${pct(b.fill_rate)} (${pp(sb.fill_rate - b.fill_rate)}), `
          + `stockout days ${sb.stockout_days} vs ${b.stockout_days}, tồn kho TB ${num(sb.average_inventory)} vs ${num(b.average_inventory)} bản (×${num(sb.average_inventory / b.average_inventory, 2)}), `
          + `chi phí ${mvnd(sb.procurement_cost)} vs ${mvnd(b.procurement_cost)} triệu VND (×${b.procurement_cost ? num(sb.procurement_cost / b.procurement_cost, 2) : '—'}).`);
      }
    }
    const budget = get('SMARTBOOK_BUDGET_MATCHED');
    const rp = get('REORDER_POINT');
    const ma = get('MA30_FIXED_LT');
    const cheaper = rp.procurement_cost <= ma.procurement_cost ? ['REORDER_POINT', rp] : ['MA30_FIXED_LT', ma];
    lines.push(`- ${s.id}, cùng ngân sách với ${cheaper[0]}: SMARTBOOK_BUDGET_MATCHED đạt fill rate ${pct(budget.fill_rate)}, `
      + `${compareWord(budget.fill_rate - cheaper[1].fill_rate)} ${cheaper[0]} (${pct(cheaper[1].fill_rate)}), chênh ${pp(budget.fill_rate - cheaper[1].fill_rate)}.`);
  }
  return lines.join('\n');
}

const SECTIONS = {
  forecast: forecastSection,
  reorder: reorderSection,
  reorder_steady: steadySection,
  ablation: ablationSection,
  lead_time: leadTimeSection,
  findings: findingsSection,
};

function renderReport(markdown, results) {
  let out = markdown;
  for (const [name, render] of Object.entries(SECTIONS)) {
    const re = new RegExp(`(<!-- AUTO:${name}:start -->)[\\s\\S]*?(<!-- AUTO:${name}:end -->)`);
    if (!re.test(out)) throw new Error(`missing AUTO:${name} markers in the report`);
    out = out.replace(re, (_, start, end) => `${start}\n${render(results)}\n${end}`);
  }
  return out;
}

module.exports = { renderReport };
