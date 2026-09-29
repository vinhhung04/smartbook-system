# SmartBook synthetic behavioural dataset — validation report

> **Đây là dữ liệu tổng hợp mô phỏng hành vi người dùng, không phải dữ liệu thu thập từ người dùng thực tế.**  
> Synthetic data from a behavioural simulation. Not collected from real users.

- Generator: `services/borrow-service/prisma/simulation` v2.0.0
- Seed: `20260928` · customers: 600 · window: 2024-09-28 → 2026-09-28 (24 months)

## Row counts

| table | rows |
| --- | --- |
| customers | 600 |
| customer_memberships | 600 |
| loan_transactions | 14308 |
| loan_items | 18456 |
| loan_renewals | 2284 |
| loan_reservations | 4059 |
| fines | 4040 |
| fine_payments | 3807 |
| book_wishlists | 6514 |
| book_reviews | 3083 |
| availability_alerts | 1203 |

## Sanity checks — ALL PASSED

| check | violations |
| --- | --- |
| reviews_of_books_not_borrowed_and_returned_before_review | 0 |
| loans_before_customer_created_at | 0 |
| reservations_before_customer_created_at | 0 |
| wishlists_before_customer_created_at | 0 |
| memberships_starting_before_customer_created_day | 0 |
| return_date_before_borrow_date | 0 |
| pickup_before_reservation | 0 |
| rating_outside_1_5 | 0 |
| impossible_due_dates | 0 |
| renewals_out_of_order | 0 |
| fines_paid_before_issued | 0 |
| fines_without_late_return | 0 |
| late_returns_without_fine | 0 |
| alert_notified_before_created | 0 |
| converted_reservation_loan_mismatch | 0 |
| events_after_simulation_end | 0 |
| invalid_foreign_keys | 0 |
| duplicate_review_customer_book | 0 |
| duplicate_wishlist_customer_book | 0 |
| duplicate_alert_customer_book | 0 |
| duplicate_natural_keys | 0 |
| rows_without_simulation_prefix | 0 |

## Persona → behaviour

| persona | customers | loans/year | items/loan | reservations/year | wishlists/year | reviews/year | late rate | WEB share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HEAVY_READER | 42 | 50.01 | 1.37 | 17.57 | 17.61 | 15.38 | 0.229 | 0.738 |
| TECH_FOCUSED_READER | 61 | 29.28 | 1.2 | 10.96 | 12.97 | 3.72 | 0.224 | 0.879 |
| LITERATURE_LOVER | 61 | 26.12 | 1.31 | 6 | 11.71 | 6.21 | 0.201 | 0.597 |
| SELF_DEVELOPMENT_READER | 86 | 21.12 | 1.22 | 6.67 | 11.18 | 4.8 | 0.195 | 0.701 |
| EXPLORER | 68 | 20.82 | 1.36 | 5.66 | 13.14 | 5.41 | 0.254 | 0.731 |
| PARENT_READER | 41 | 15.08 | 1.44 | 3.52 | 7.39 | 2.5 | 0.263 | 0.6 |
| CASUAL_READER | 132 | 6.71 | 1.17 | 1.07 | 3.16 | 0.5 | 0.242 | 0.649 |
| LOW_ENGAGEMENT | 109 | 1.38 | 1.12 | 0.07 | 1.03 | 0.02 | 0.347 | 0.6 |

Activity long tail: top 10% of customers hold **0.349** of loan items; Gini 0.56; 59 customers never borrowed.

## Punctuality → late return rate

| true punctuality | customers | returned items | late rate |
| --- | --- | --- | --- |
| 0.0-0.2 | 13 | 28 | 0.714 |
| 0.2-0.4 | 67 | 816 | 0.463 |
| 0.4-0.6 | 184 | 4247 | 0.331 |
| 0.6-0.8 | 212 | 7435 | 0.205 |
| 0.8-1.0 | 124 | 5341 | 0.134 |

## Digital affinity → WEB reservation share

| digital affinity | customers | reservations | WEB share |
| --- | --- | --- | --- |
| LOW (<0.4) | 117 | 222 | 0.428 |
| MEDIUM (0.4-0.7) | 268 | 1482 | 0.603 |
| HIGH (>=0.7) | 215 | 2355 | 0.84 |

## Exploration → reading diversity (customers with ≥ 10 items)

| exploration | customers | unique categories in first 10 items | unique categories / year | normalised category entropy | share outside top preference |
| --- | --- | --- | --- | --- | --- |
| LOW (<0.2) | 169 | 3.62 | 3.12 | 0.779 | 0.561 |
| MEDIUM (0.2-0.4) | 151 | 4.17 | 3.21 | 0.881 | 0.666 |
| HIGH (>=0.4) | 63 | 4.46 | 3.29 | 0.941 | 0.768 |

## True preference → borrowed categories

- Mean Spearman(true preference, borrowed share) per customer: **0.683** (n=383)
- Share of items in the top-preferred category: **0.364** (true preference mass of that category: 0.405)
- Most-borrowed category = top true preference for **0.632** of customers

## Taste match → rating

| taste match | reviews | avg rating |
| --- | --- | --- |
| LOW (<0.4) | 668 | 2.9 |
| MEDIUM (0.4-0.7) | 807 | 3.756 |
| HIGH (>=0.7) | 1608 | 4.484 |

Rating distribution: {"1":107,"2":255,"3":526,"4":992,"5":1203}

## Other conditional effects

| page count | items | renewal rate |
| --- | --- | --- |
| <250 pages | 5308 | 0.096 |
| 250-400 pages | 11136 | 0.125 |
| >400 pages | 2012 | 0.171 |

| payment reliability | fines | paid share |
| --- | --- | --- |
| LOW (<0.5) | 202 | 0.663 |
| MEDIUM (0.5-0.8) | 2295 | 0.939 |
| HIGH (>=0.8) | 1543 | 0.983 |

| latent activity | customers | GOLD/VIP share |
| --- | --- | --- |
| Q1 (<0.3) | 138 | 0.072 |
| Q2 (0.3-0.5) | 139 | 0.137 |
| Q3 (0.5-0.7) | 198 | 0.232 |
| Q4 (>=0.7) | 125 | 0.376 |

## Gender fairness check (gender is not an input to any behaviour)

| gender | customers | loans/year | late rate | literature share | GOLD/VIP share | mean true punctuality |
| --- | --- | --- | --- | --- | --- | --- |
| FEMALE | 295 | 17.68 | 0.211 | 0.586 | 0.203 | 0.626 |
| MALE | 268 | 16.61 | 0.231 | 0.555 | 0.183 | 0.614 |
| UNSPECIFIED | 23 | 17.7 | 0.339 | 0.627 | 0.391 | 0.602 |
| OTHER | 14 | 20.95 | 0.234 | 0.647 | 0.286 | 0.679 |

Differences between groups are sampling noise: test/simulation.test.js proves that changing the gender mix leaves every generated row identical.

## Temporal patterns by life stage

| life stage | loans | local hour 08-11/11-14/14-17/17-20 | month index Jan..Dec |
| --- | --- | --- | --- |
| WORKING | 7664 | 0.209 / 0.215 / 0.092 / 0.38 | 0.91 0.73 1.15 0.98 1.05 1.01 1.02 1.22 1.25 0.9 0.87 0.91 |
| RETIRED | 662 | 0.565 / 0.16 / 0.165 / 0.035 | 1.07 0.78 1.11 1 1.34 0.96 1.03 1.09 0.98 0.94 0.89 0.82 |
| STUDENT | 4753 | 0.181 / 0.113 / 0.265 / 0.335 | 0.94 0.56 1.19 1.11 1.16 0.87 0.7 1.03 1.45 0.99 0.96 1.04 |
| PARENT | 1229 | 0.182 / 0.075 / 0.273 / 0.393 | 0.9 0.61 0.9 1.05 1.02 1.09 1.6 1.45 0.91 0.83 0.81 0.83 |

## Book popularity & turnover

Top-10 books hold 0.377 of items; Gini 0.533; items per book min/median/max = 16/93/1627. Variant turnover tiers (last 90 days): {"HIGH (>=30)":28,"LOW (<8)":27,"MEDIUM (8-29)":59}.

Event chains: {"loans_created_from_reservation_pickup":2844,"alerts_notified":1160,"wishlists_later_borrowed":2547}

## Evaluation

### Late-return risk (analytics-service risk-model.js)
Bayes-optimal AUC ceiling (from the true generative probabilities): **0.7128** over 17867 labelled samples.

| feature semantics | status | train | test | test AUC | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- |
| point_in_time | OK | 13400 | 4467 | 0.676 | 0.1544 | 0.0085 |
| legacy_sql | OK | 13400 | 4467 | 0.6711 | 0.1553 | 0.0165 |

### Reservation no-show risk (analytics-service risk-model.js)
Bayes-optimal AUC ceiling (from the true generative probabilities): **0.7349** over 3579 labelled samples.

| feature semantics | status | train | test | test AUC | Brier | ECE |
| --- | --- | --- | --- | --- | --- | --- |
| point_in_time | OK | 2684 | 895 | 0.6902 | 0.1636 | 0.035 |
| legacy_sql | OK | 2684 | 895 | 0.6542 | 0.1678 | 0.0338 |

### Demand forecast backtest (analytics-service forecast.js, 180d window, 7d horizon)

114/114 variants backtested (INSUFFICIENT_DATA: 0); mean zero-demand day share 0.7948.

| model | MAE | RMSE | WAPE | samples |
| --- | --- | --- | --- | --- |
| MOVING_AVERAGE_30 | 0.3314 | 0.4583 | 1.5809 | 16758 |
| MOVING_AVERAGE_7 | 0.3381 | 0.4822 | 1.6009 | 16758 |
| CURRENT_EWMA_TREND | 0.3382 | 0.498 | 1.582 | 16758 |
| NAIVE_LAST_VALUE | 0.3577 | 0.6289 | 1.5812 | 16758 |

### Recommendation (temporal hold-out: global cutoff at the 80th percentile of loan-item borrow times; relevance = books first borrowed after the cutoff that were not borrowed/wishlisted/rated before it)

Cutoff 2026-05-30T18:50:54.068Z; 368 eligible users. ORACLE_TRUE_PREFERENCE reads the latent truth and is a reference ceiling only, not a deployable model.

| model | HR@5 | Recall@5 | NDCG@5 | HR@10 | Recall@10 | NDCG@10 | MRR | Coverage@10 | Personalization@10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| POPULARITY | 0.6766 | 0.2898 | 0.3177 | 0.8071 | 0.4498 | 0.3721 | 0.5124 | 0.7965 | 0.854 |
| RANDOM | 0.2065 | 0.0589 | 0.0574 | 0.4266 | 0.1542 | 0.0974 | 0.1471 | 1 | 0.9457 |
| ORACLE_TRUE_PREFERENCE | 0.8207 | 0.412 | 0.4259 | 0.9185 | 0.5852 | 0.4803 | 0.5952 | 0.9469 | 0.8997 |
| SMARTBOOK_PRODUCTION_RANKER | 0.5109 | 0.1847 | 0.2046 | 0.6223 | 0.2841 | 0.2362 | 0.3605 | 0.9735 | 0.8915 |

Preference recovery (observable history vs latent truth): Spearman 0.6543, top-category agreement 0.6467.
