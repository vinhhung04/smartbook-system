# Chẩn đoán mô hình dự báo nhu cầu (tự động)

> Sinh bởi `services/analytics-service/eval/forecast-diagnostics.js` — không sửa tay. Dữ liệu TỔNG HỢP
> (seed 20260928), 114 variant, cửa sổ 360 ngày.

Giao thức: rolling origin, cửa sổ huấn luyện mở rộng, mỗi fold cách 7 ngày. Fold có mốc cắt ở
nửa đầu cửa sổ = **validation**, nửa sau = **test**. Mô hình được **chọn trên validation** (MAE thấp nhất trong
nhóm SES/EWMA); kết quả báo cáo của nó là trên **test**. CI 95% bootstrap ghép cặp theo variant
(2000 lần, seed 20261008). "Tổng 14 ngày" = sai số của tổng dự báo trong lead time 14
ngày — đại lượng mà gợi ý nhập kho thực sự dùng.

Mô hình được chọn trên validation: **SES_0.05**.

## Validation
| Mô hình | MAE ngày | RMSE ngày | Bias ngày | MAE tổng 14 ngày | Bias tổng 14 ngày |
| --- | --- | --- | --- | --- | --- |
| MA30 | 0.3201 | 0.5139 | -0.0020 | 1.372 | -0.019 |
| SES_0.05 (chọn trên val) | 0.3203 | 0.5151 | -0.0030 | 1.387 | -0.033 |
| SES_0.1 | 0.3233 | 0.5211 | -0.0010 | 1.562 | -0.005 |
| TSB | 0.3233 | 0.5206 | -0.0006 | 1.557 | 0.000 |
| SES_0.2 | 0.3286 | 0.5364 | 0.0026 | 1.935 | 0.045 |
| SES_0.35_30D | 0.3376 | 0.5634 | 0.0105 | 2.494 | 0.155 |
| SES_0.35 | 0.3376 | 0.5634 | 0.0105 | 2.494 | 0.155 |
| EWMA_TREND_EXPANDING | 0.3381 | 0.5646 | 0.0102 | 2.542 | 0.153 |
| PROD_EWMA_TREND_30D | 0.3430 | 0.5729 | 0.0152 | 2.784 | 0.303 |

## Test
| Mô hình | MAE ngày | RMSE ngày | Bias ngày | MAE tổng 14 ngày | Bias tổng 14 ngày |
| --- | --- | --- | --- | --- | --- |
| MA30 | 0.3313 | 0.5204 | -0.0016 | 1.398 | -0.047 |
| SES_0.05 (chọn trên val) | 0.3313 | 0.5202 | -0.0029 | 1.392 | -0.065 |
| SES_0.1 | 0.3332 | 0.5277 | -0.0028 | 1.596 | -0.063 |
| TSB | 0.3334 | 0.5266 | -0.0023 | 1.583 | -0.056 |
| SES_0.2 | 0.3372 | 0.5447 | -0.0013 | 2.005 | -0.043 |
| SES_0.35_30D | 0.3446 | 0.5744 | 0.0039 | 2.600 | 0.030 |
| SES_0.35 | 0.3446 | 0.5744 | 0.0039 | 2.600 | 0.030 |
| EWMA_TREND_EXPANDING | 0.3448 | 0.5746 | 0.0040 | 2.604 | 0.034 |
| PROD_EWMA_TREND_30D | 0.3491 | 0.5833 | 0.0068 | 2.861 | 0.132 |

## So sánh trên test (hiệu A − B; âm = A tốt hơn)
| Cặp | Δ MAE ngày [CI 95%] | Δ MAE tổng 14 ngày [CI 95%] |
| --- | --- | --- |
| SES_0.05 - PROD_EWMA_TREND_30D | -0.0177 [-0.0248, -0.0113] | -1.468 [-1.674, -1.271] |
| SES_0.05 - MA30 | 0.0000 [-0.0005, 0.0005] | -0.005 [-0.024, 0.013] |
| PROD_EWMA_TREND_30D - MA30 | 0.0177 [0.0114, 0.0249] | 1.463 [1.256, 1.677] |
| SES_0.35_30D - PROD_EWMA_TREND_30D | -0.0045 [-0.0054, -0.0036] | -0.261 [-0.317, -0.211] |
