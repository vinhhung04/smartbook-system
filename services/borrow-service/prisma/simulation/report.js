// Renders simulation-report.json as a human-readable Markdown report.

function table(rows, columns) {
  if (!rows || !rows.length) return '_no data_\n';
  const head = `| ${columns.map((c) => c[0]).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${columns.map((c) => (typeof c[1] === 'function' ? c[1](r) : r[c[1]]) ?? '').join(' | ')} |`);
  return `${[head, sep, ...body].join('\n')}\n`;
}

function renderMarkdown(report) {
  const p = report.provenance;
  const rel = report.validation.relationships;
  const dist = report.validation.distributions;
  const ev = report.evaluation;
  const out = [];
  out.push(`# SmartBook synthetic behavioural dataset — validation report\n`);
  out.push(`> **${p.disclaimer_vi}**  \n> ${p.disclaimer_en}\n`);
  out.push(`- Generator: \`${p.generator}\` v${p.generator_version}`);
  out.push(`- Seed: \`${p.seed}\` · customers: ${p.customer_count} · window: ${p.simulation_start.slice(0, 10)} → ${p.simulation_end.slice(0, 10)} (${p.simulation_months} months)\n`);

  out.push('## Row counts\n');
  out.push(table(Object.entries(report.validation.counts).map(([k, v]) => ({ k, v })), [['table', 'k'], ['rows', 'v']]));

  const s = report.validation.sanity;
  out.push(`## Sanity checks — ${s.passed ? 'ALL PASSED' : `FAILED: ${s.failed.join(', ')}`}\n`);
  out.push(table(Object.entries(s.checks).map(([k, v]) => ({ k, v })), [['check', 'k'], ['violations', 'v']]));

  out.push('## Persona → behaviour\n');
  out.push(table(rel.persona_activity, [['persona', 'persona'], ['customers', 'customers'], ['loans/year', 'loans_per_year'], ['items/loan', 'items_per_loan'], ['reservations/year', 'reservations_per_year'], ['wishlists/year', 'wishlists_per_year'], ['reviews/year', 'reviews_per_year'], ['late rate', 'late_rate'], ['WEB share', 'web_share']]));
  const ac = rel.activity_concentration;
  out.push(`Activity long tail: top 10% of customers hold **${ac.top_10pct_customers_share_of_loan_items}** of loan items; Gini ${ac.gini_loan_items_per_customer}; ${ac.customers_with_zero_loans} customers never borrowed.\n`);

  out.push('## Punctuality → late return rate\n');
  out.push(table(rel.punctuality_vs_late_rate, [['true punctuality', 'bucket'], ['customers', 'customers'], ['returned items', 'returned_items'], ['late rate', 'late_rate']]));
  out.push('## Digital affinity → WEB reservation share\n');
  out.push(table(rel.digital_affinity_vs_web_reservations, [['digital affinity', 'bucket'], ['customers', 'customers'], ['reservations', 'reservations'], ['WEB share', 'web_share']]));
  out.push('## Exploration → reading diversity (customers with ≥ 10 items)\n');
  out.push(table(rel.exploration_vs_diversity, [['exploration', 'bucket'], ['customers', 'customers'], ['unique categories in first 10 items', 'unique_categories_first_10_items'], ['unique categories / year', 'unique_categories_per_year'], ['normalised category entropy', 'category_entropy'], ['share outside top preference', 'share_outside_top_preference']]));
  const pr = rel.preference_vs_borrowed_categories;
  out.push('## True preference → borrowed categories\n');
  out.push(`- Mean Spearman(true preference, borrowed share) per customer: **${pr.mean_spearman_pref_vs_borrow_share}** (n=${pr.customers})`);
  out.push(`- Share of items in the top-preferred category: **${pr.mean_share_of_items_in_top_preferred_category}** (true preference mass of that category: ${pr.mean_true_preference_of_top_category})`);
  out.push(`- Most-borrowed category = top true preference for **${pr.most_borrowed_category_is_top_preference_rate}** of customers\n`);
  out.push('## Taste match → rating\n');
  out.push(table(rel.taste_match_vs_rating, [['taste match', 'bucket'], ['reviews', 'reviews'], ['avg rating', 'avg_rating']]));
  out.push(`Rating distribution: ${JSON.stringify(dist.rating_distribution)}\n`);
  out.push('## Other conditional effects\n');
  out.push(table(rel.page_count_vs_renewal, [['page count', 'bucket'], ['items', 'items'], ['renewal rate', 'renewal_rate']]));
  out.push(table(rel.payment_reliability_vs_fine_paid, [['payment reliability', 'bucket'], ['fines', 'fines'], ['paid share', 'paid_share']]));
  out.push(table(rel.activity_vs_membership_plan, [['latent activity', 'activity'], ['customers', 'customers'], ['GOLD/VIP share', 'gold_or_vip_share']]));
  out.push('## Gender fairness check (gender is not an input to any behaviour)\n');
  out.push(table(rel.gender_fairness, [['gender', 'gender'], ['customers', 'customers'], ['loans/year', 'loans_per_year'], ['late rate', 'late_rate'], ['literature share', 'literature_share_of_items'], ['GOLD/VIP share', 'gold_or_vip_share'], ['mean true punctuality', 'mean_true_punctuality']]));
  out.push('Differences between groups are sampling noise: test/simulation.test.js proves that changing the gender mix leaves every generated row identical.\n');
  out.push('## Temporal patterns by life stage\n');
  out.push(table(rel.temporal_by_life_stage, [['life stage', 'life_stage'], ['loans', 'loans'], ['local hour 08-11/11-14/14-17/17-20', (r) => Object.values(r.hour_distribution).join(' / ')], ['month index Jan..Dec', (r) => r.month_index.join(' ')]]));
  const bp = rel.book_popularity;
  out.push('## Book popularity & turnover\n');
  out.push(`Top-10 books hold ${bp.top_10_books_share_of_items} of items; Gini ${bp.gini_items_per_book}; items per book min/median/max = ${bp.min_items_per_book}/${bp.median_items_per_book}/${bp.max_items_per_book}. Variant turnover tiers (last 90 days): ${JSON.stringify(bp.variant_turnover_tiers_last_90_days)}.\n`);
  out.push(`Event chains: ${JSON.stringify(rel.event_chains)}\n`);

  if (ev) {
    out.push('## Evaluation\n');
    const risk = (name, r) => {
      const rows = ['point_in_time', 'legacy_sql'].filter((k) => r[k]).map((k) => ({ k, ...r[k] }));
      return `### ${name}\nBayes-optimal AUC ceiling (from the true generative probabilities): **${r.bayes_auc_ceiling}** over ${r.labelled_samples} labelled samples.\n\n${table(rows, [['feature semantics', 'k'], ['status', 'status'], ['train', 'train_size'], ['test', 'test_size'], ['test AUC', 'test_auc'], ['Brier', 'test_brier'], ['ECE', 'test_ece']])}`;
    };
    out.push(risk('Late-return risk (analytics-service risk-model.js)', ev.risk.late_return));
    out.push(risk('Reservation no-show risk (analytics-service risk-model.js)', ev.risk.no_show));
    if (ev.forecast.overall_models) {
      out.push(`### Demand forecast backtest (analytics-service forecast.js, ${ev.forecast.window_days}d window, ${ev.forecast.horizon_days}d horizon)\n`);
      out.push(`${ev.forecast.variants_backtested_ok}/${ev.forecast.variants_with_demand} variants backtested (INSUFFICIENT_DATA: ${ev.forecast.variants_insufficient_data}); mean zero-demand day share ${ev.forecast.mean_zero_demand_day_share}.\n`);
      out.push(table(ev.forecast.overall_models, [['model', 'model'], ['MAE', 'mae'], ['RMSE', 'rmse'], ['WAPE', 'wape'], ['samples', 'samples']]));
    }
    const rec = ev.recommendation;
    out.push(`### Recommendation (${rec.protocol})\n`);
    out.push(`Cutoff ${rec.cutoff}; ${rec.eligible_users} eligible users. ORACLE_TRUE_PREFERENCE reads the latent truth and is a reference ceiling only, not a deployable model.\n`);
    out.push(table(Object.entries(rec.models).map(([model, m]) => ({ model, ...m })), [['model', 'model'], ['HR@5', 'hit_rate@5'], ['Recall@5', 'recall@5'], ['NDCG@5', 'ndcg@5'], ['HR@10', 'hit_rate@10'], ['Recall@10', 'recall@10'], ['NDCG@10', 'ndcg@10'], ['MRR', 'mrr'], ['Coverage@10', 'catalog_coverage@10'], ['Personalization@10', 'personalization@10']]));
    out.push(`Preference recovery (observable history vs latent truth): Spearman ${rec.preference_recovery.mean_spearman_inferred_vs_true_category_preference}, top-category agreement ${rec.preference_recovery.top_category_agreement}.\n`);
  }
  return out.join('\n');
}

module.exports = { renderMarkdown };
