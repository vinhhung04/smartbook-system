# Error categories (automatic)

| Method | Track | Category | Count |
|---|---|---|---|
| clip_only | A | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | 6 |
| clip_only | A | NO_RESULT | 6 |
| clip_only | A | OK | 11 |
| clip_only | A | WRONG_BOOK | 2 |
| clip_only | B | CORRECT_BUT_NOT_TOP1 | 6 |
| clip_only | B | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | 40 |
| clip_only | B | NO_RESULT | 9 |
| clip_only | B | OK | 1079 |
| clip_only | B | WRONG_BOOK | 9 |
| clip_only | OOC | FALSE_ACCEPT | 3 |
| clip_only | OOC | OK | 24 |
| hybrid | A | NO_RESULT | 1 |
| hybrid | A | OK | 23 |
| hybrid | A | WRONG_BOOK | 1 |
| hybrid | B | CORRECT_BUT_NOT_TOP1 | 42 |
| hybrid | B | NO_RESULT | 5 |
| hybrid | B | OK | 1055 |
| hybrid | B | SAME_AUTHOR_CONFUSION | 1 |
| hybrid | B | WRONG_BOOK | 40 |
| hybrid | OOC | FALSE_ACCEPT | 27 |
| ocr_only | A | OCR_NO_TEXT | 1 |
| ocr_only | A | OK | 24 |
| ocr_only | B | OCR_NO_TEXT | 82 |
| ocr_only | B | OK | 1022 |
| ocr_only | B | SAME_AUTHOR_CONFUSION | 1 |
| ocr_only | B | WRONG_BOOK | 38 |
| ocr_only | OOC | FALSE_ACCEPT | 27 |

## Non-OK queries

| Method | Track | Query | Category | Ground truth | Condition | Returned (id:conf:signals) | OCR | raw CLIP top-3 |
|---|---|---|---|---|---|---|---|---|
| clip_only | B | q-C-EN-EN001__occlusion | CORRECT_BUT_NOT_TOP1 | SB-ENS-EN001 Alice's Adventures in Wonderland | occlusion | SB-EN-0081:0.877:visual; SB-EN-0099:0.87:visual; SB-ENS-EN001:0.868:visual |  | SB-EN-0081:0.8773, SB-EN-0099:0.8701, SB-ENS-EN001:0.8679 |
| clip_only | A | q-C-EN-EN004 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0102 Dracula | scan |  |  | SB-EN-0102:0.7397, SB-EN-0071:0.6607, SB-EN-0081:0.6571 |
| clip_only | B | q-C-EN-EN006__gaussian_blur | NO_RESULT | SB-ENS-EN006 Little Women | gaussian_blur |  |  | SB-EN-0099:0.7881, SB-EN-0081:0.7858, SB-ENS-EN006:0.7797 |
| clip_only | B | q-C-EN-EN006__occlusion | WRONG_BOOK | SB-ENS-EN006 Little Women | occlusion | SB-EN-0026:0.803:visual |  | SB-EN-0026:0.8034, SB-EN-0043:0.7792, SB-EN-0071:0.7773 |
| clip_only | B | q-C-EN-EN007__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-ENS-EN007 Anne of Green Gables | occlusion |  |  | SB-ENS-EN007:0.786, SB-EN-0099:0.7774, SB-EN-0081:0.7723 |
| clip_only | B | q-C-EN-EN008__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-ENS-EN008 The Wind in the Willows | occlusion |  |  | SB-ENS-EN008:0.782, SB-EN-0089:0.7732, SB-EN-0081:0.7699 |
| clip_only | A | q-C-MD-0004 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-MD-0003 Jaws | scan |  |  | SB-MD-0003:0.7538, SB-EN-0055:0.6271, SB-EN-0053:0.5994 |
| clip_only | B | q-C-MD-0012__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-MD-0012 The Catcher in the Rye | mild_crop |  |  | SB-MD-0012:0.7922, SB-MD-0010:0.6966, SB-EN-0080:0.6805 |
| clip_only | B | q-C-VN-0008__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0008 Phan Trần truyện | gaussian_blur | SB-VN-0022:0.924:visual; SB-VN-0008:0.92:visual; SB-VN-0015:0.863:visual |  | SB-VN-0022:0.9242, SB-VN-0008:0.9198, SB-VN-0015:0.8628 |
| clip_only | B | q-C-VN-0012__occlusion | NO_RESULT | SB-VN-0012 Chí Phèo | occlusion |  |  | SB-EN-0051:0.7804, SB-EN-0026:0.7319, SB-EN-0099:0.731 |
| clip_only | B | q-C-VN-0014__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0014 Đảng Công-Nông Việt-Nam: Tuyên ngôn, chính cương và điều lệ | rot_m4 |  |  | SB-VN-0014:0.7924, SB-VN-0026:0.648, SB-VN-0022:0.5982 |
| clip_only | B | q-C-VN-0014__rot_p4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0014 Đảng Công-Nông Việt-Nam: Tuyên ngôn, chính cương và điều lệ | rot_p4 |  |  | SB-VN-0014:0.743, SB-VN-0048:0.5614, SB-VN-0024:0.561 |
| clip_only | B | q-C-VN-0016__occlusion | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | occlusion | SB-EN-0099:0.854:visual; SB-EN-0081:0.843:visual |  | SB-EN-0099:0.854, SB-EN-0081:0.8428, SB-EN-0071:0.7878 |
| clip_only | B | q-C-VN-0017__gaussian_blur | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0017 Lịch triều hiến chương loại chí | gaussian_blur |  |  | SB-VN-0017:0.7687, SB-EN-0081:0.6748, SB-EN-0099:0.6676 |
| clip_only | A | q-C-VN-0018 | NO_RESULT | SB-VN-0017 Lịch triều hiến chương loại chí | photo |  |  | SB-VN-0011:0.7012, SB-VN-0012:0.6872, SB-VN-0063:0.6847 |
| clip_only | OOC | q-C-VN-0020 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0019:0.841:visual; SB-VN-0069:0.832:visual; SB-VN-0023:0.822:visual |  | SB-VN-0019:0.841, SB-VN-0069:0.8324, SB-VN-0023:0.8218 |
| clip_only | B | q-C-VN-0021__rot_p4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0021 Trung tiết anh hùng – Lịch sử ông Võ Tánh | rot_p4 |  |  | SB-VN-0021:0.7925, SB-VN-0048:0.7259, SB-VN-0063:0.7228 |
| clip_only | B | q-C-VN-0029__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0029 Công giáo trên bờ vực thẳm | occlusion |  |  | SB-VN-0029:0.6924, SB-EN-0099:0.6514, SB-EN-0071:0.6449 |
| clip_only | B | q-C-VN-0030__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0030 Công giáo huyền thoại và tội ác | mild_crop |  |  | SB-VN-0030:0.767, SB-EN-0036:0.554, SB-VN-0048:0.5486 |
| clip_only | OOC | q-C-VN-0036 | FALSE_ACCEPT |  (out of catalog) | photo | SB-VN-0037:0.822:visual |  | SB-VN-0037:0.8221, SB-VN-0043:0.7882, SB-VN-0071:0.772 |
| clip_only | B | q-C-VN-0037__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0037 Tìm hiểu học thuyết Páp-lốp áp dụng vào giáo dục | gaussian_blur | SB-EN-0081:0.817:visual; SB-VN-0037:0.817:visual |  | SB-EN-0081:0.8169, SB-VN-0037:0.8167, SB-EN-0099:0.7929 |
| clip_only | B | q-C-VN-0037__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0037 Tìm hiểu học thuyết Páp-lốp áp dụng vào giáo dục | occlusion |  |  | SB-VN-0037:0.7881, SB-EN-0099:0.685, SB-EN-0051:0.6525 |
| clip_only | B | q-C-VN-0045__occlusion | NO_RESULT | SB-VN-0045 Đất rừng phương Nam | occlusion |  |  | SB-EN-0026:0.7634, SB-EN-0033:0.7493, SB-EN-0051:0.7358 |
| clip_only | B | q-C-VN-0048__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0048 Trước giờ tổng khởi nghĩa | mild_crop |  |  | SB-VN-0048:0.7979, SB-VN-0070:0.6448, SB-VN-0004:0.6367 |
| clip_only | B | q-C-VN-0048__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0048 Trước giờ tổng khởi nghĩa | occlusion |  |  | SB-VN-0048:0.7262, SB-EN-0051:0.6783, SB-EN-0026:0.6758 |
| clip_only | A | q-C-VN-0064 | NO_RESULT | SB-VN-0063 Đường kách mệnh | photo_angled |  |  | SB-EN-0099:0.7047, SB-EN-0051:0.6983, SB-VN-0063:0.6933 |
| clip_only | B | q-C-VN-0065__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0065 Le Procès de la Colonisation Française | occlusion |  |  | SB-VN-0065:0.7631, SB-EN-0099:0.7051, SB-ENS-EN002:0.6964 |
| clip_only | B | q-C-VN-0069__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0069 Ấu học ngũ ngôn thi | rot_m4 | SB-VN-0019:0.956:visual; SB-VN-0069:0.948:visual; SB-VN-0039:0.898:visual |  | SB-VN-0019:0.9555, SB-VN-0069:0.9483, SB-VN-0039:0.8983 |
| clip_only | B | q-C-VN-0070__gaussian_blur | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-VN-0070 Thực phổ bách thiên | gaussian_blur |  |  | SB-VN-0070:0.7368, SB-EN-0087:0.6999, SB-EN-0081:0.6878 |
| clip_only | B | q-G-EN-0005__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0005 Redcoat | mild_crop |  |  | SB-EN-0005:0.7609, SB-EN-0044:0.757, SB-EN-0093:0.6716 |
| clip_only | B | q-G-EN-0005__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0005 Redcoat | occlusion |  |  | SB-EN-0005:0.7984, SB-EN-0044:0.7804, SB-EN-0026:0.6914 |
| clip_only | B | q-G-EN-0006__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0006 Further Adventures of Lad | occlusion |  |  | SB-EN-0006:0.7808, SB-EN-0099:0.7619, SB-EN-0071:0.7556 |
| clip_only | B | q-G-EN-0007__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0007 Riders of the Purple Sage | rot_m4 |  |  | SB-EN-0007:0.785, SB-EN-0099:0.7053, SB-EN-0081:0.6872 |
| clip_only | B | q-G-EN-0009__occlusion | NO_RESULT | SB-EN-0009 Bleak House | occlusion |  |  | SB-EN-0099:0.7818, SB-EN-0081:0.769, SB-EN-0071:0.7606 |
| clip_only | B | q-G-EN-0014__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0014 South | occlusion |  |  | SB-EN-0014:0.7663, SB-EN-0081:0.6954, SB-EN-0071:0.6835 |
| clip_only | B | q-G-EN-0015__gaussian_blur | WRONG_BOOK | SB-EN-0015 Tom Grogan | gaussian_blur | SB-EN-0081:0.862:visual; SB-EN-0099:0.849:visual; SB-EN-0071:0.812:visual |  | SB-EN-0081:0.8623, SB-EN-0099:0.8489, SB-ENS-EN001:0.8124 |
| clip_only | B | q-G-EN-0016__occlusion | WRONG_BOOK | SB-EN-0016 My Friend Annabel Lee | occlusion | SB-EN-0099:0.84:visual; SB-EN-0081:0.826:visual; SB-EN-0043:0.8:visual |  | SB-EN-0099:0.8396, SB-EN-0081:0.8265, SB-EN-0043:0.8005 |
| clip_only | B | q-G-EN-0020__gaussian_blur | NO_RESULT | SB-EN-0020 Report of a topographical and geological exploration of the western districts of the Nelson province, New Zealand | gaussian_blur |  |  | SB-EN-0081:0.7766, SB-VN-0043:0.7264, SB-EN-0099:0.7208 |
| clip_only | B | q-G-EN-0022__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0022 Mink Trapping | occlusion |  |  | SB-EN-0022:0.7832, SB-EN-0071:0.7572, SB-EN-0081:0.7554 |
| clip_only | B | q-G-EN-0025__mild_crop | WRONG_BOOK | SB-EN-0025 The Prisoner of Zenda | mild_crop | SB-EN-0099:0.868:visual; SB-EN-0081:0.843:visual; SB-EN-0036:0.826:visual |  | SB-EN-0099:0.8678, SB-EN-0081:0.8434, SB-EN-0036:0.8256 |
| clip_only | B | q-G-EN-0029__gaussian_blur | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0029 The Meat Fetish | gaussian_blur |  |  | SB-EN-0029:0.7869, SB-EN-0081:0.7464, SB-EN-0047:0.7313 |
| clip_only | B | q-G-EN-0029__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0029 The Meat Fetish | mild_crop |  |  | SB-EN-0029:0.7962, SB-EN-0081:0.667, SB-EN-0073:0.6562 |
| clip_only | B | q-G-EN-0029__perspective | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0029 The Meat Fetish | perspective |  |  | SB-EN-0029:0.7601, SB-EN-0081:0.6471, SB-EN-0110:0.6383 |
| clip_only | B | q-G-EN-0029__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0029 The Meat Fetish | rot_m4 |  |  | SB-EN-0029:0.7894, SB-EN-0081:0.7099, SB-EN-0019:0.6682 |
| clip_only | B | q-G-EN-0029__rot_p4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0029 The Meat Fetish | rot_p4 |  |  | SB-EN-0029:0.7947, SB-EN-0073:0.653, SB-EN-0081:0.6507 |
| clip_only | B | q-G-EN-0031__occlusion | NO_RESULT | SB-EN-0031 Hare and Tortoise | occlusion |  |  | SB-EN-0026:0.7964, SB-EN-0043:0.7883, SB-EN-0051:0.76 |
| clip_only | B | q-G-EN-0037__gaussian_blur | NO_RESULT | SB-EN-0037 The Able McLaughlins | gaussian_blur |  |  | SB-EN-0081:0.761, SB-EN-0099:0.7455, SB-EN-0037:0.7303 |
| clip_only | B | q-G-EN-0043__jpeg_q20 | CORRECT_BUT_NOT_TOP1 | SB-EN-0043 Tom Beauling | jpeg_q20 | SB-EN-0099:0.866:visual; SB-EN-0043:0.856:visual; SB-EN-0081:0.833:visual |  | SB-EN-0099:0.8658, SB-EN-0043:0.8563, SB-EN-0081:0.8328 |
| clip_only | B | q-G-EN-0043__perspective | WRONG_BOOK | SB-EN-0043 Tom Beauling | perspective | SB-EN-0099:0.823:visual; SB-EN-0081:0.814:visual |  | SB-EN-0099:0.8225, SB-EN-0081:0.8138, SB-EN-0043:0.797 |
| clip_only | B | q-G-EN-0044__occlusion | CORRECT_BUT_NOT_TOP1 | SB-EN-0044 The Way of the Wild | occlusion | SB-EN-0026:0.838:visual; SB-EN-0044:0.809:visual |  | SB-EN-0026:0.8379, SB-EN-0044:0.8091, SB-EN-0099:0.7993 |
| clip_only | B | q-G-EN-0047__perspective | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0047 Lady Audley's Secret | perspective |  |  | SB-EN-0047:0.737, SB-EN-0099:0.7164, SB-EN-0081:0.7044 |
| clip_only | B | q-G-EN-0047__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0047 Lady Audley's Secret | rot_m4 |  |  | SB-EN-0047:0.722, SB-EN-0099:0.7095, SB-EN-0006:0.6989 |
| clip_only | B | q-G-EN-0047__rot_p4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0047 Lady Audley's Secret | rot_p4 |  |  | SB-EN-0047:0.714, SB-EN-0099:0.7125, SB-EN-0081:0.7014 |
| clip_only | B | q-G-EN-0050__gaussian_blur | NO_RESULT | SB-EN-0050 By Sanction of Law | gaussian_blur |  |  | SB-EN-0099:0.7711, SB-EN-0071:0.7619, SB-EN-0050:0.7566 |
| clip_only | B | q-G-EN-0055__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0055 Cabbages and Kings | rot_m4 |  |  | SB-EN-0055:0.7876, SB-EN-0071:0.7491, SB-EN-0093:0.6239 |
| clip_only | B | q-G-EN-0057__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0057 Glinda of Oz | occlusion |  |  | SB-EN-0057:0.7601, SB-EN-0059:0.722, SB-EN-0085:0.7043 |
| clip_only | B | q-G-EN-0067__mild_crop | WRONG_BOOK | SB-EN-0067 The Traitor | mild_crop | SB-EN-0026:0.81:visual |  | SB-EN-0026:0.8102, SB-EN-0067:0.7411, SB-EN-0099:0.7359 |
| clip_only | B | q-G-EN-0067__perspective | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0067 The Traitor | perspective |  |  | SB-EN-0067:0.7819, SB-EN-0071:0.6864, SB-EN-0099:0.6571 |
| clip_only | B | q-G-EN-0067__rot_m4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0067 The Traitor | rot_m4 |  |  | SB-EN-0067:0.7548, SB-EN-0071:0.7074, SB-EN-0099:0.6903 |
| clip_only | B | q-G-EN-0067__rot_p4 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0067 The Traitor | rot_p4 |  |  | SB-EN-0067:0.7172, SB-EN-0071:0.6262, SB-EN-0099:0.6075 |
| clip_only | B | q-G-EN-0068__occlusion | WRONG_BOOK | SB-EN-0068 Mistress Madcap Surrenders | occlusion | SB-EN-0026:0.809:visual |  | SB-EN-0026:0.809, SB-EN-0099:0.7826, SB-EN-0068:0.773 |
| clip_only | B | q-G-EN-0070__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0070 The Tale of Squirrel Nutkin | occlusion |  |  | SB-EN-0070:0.7782, SB-EN-0099:0.6208, SB-EN-0044:0.6203 |
| clip_only | B | q-G-EN-0072__gaussian_blur | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0072 In Our Time | gaussian_blur |  |  | SB-EN-0072:0.7925, SB-EN-0081:0.6894, SB-EN-0099:0.686 |
| clip_only | B | q-G-EN-0072__occlusion | NO_RESULT | SB-EN-0072 In Our Time | occlusion |  |  | SB-EN-0099:0.7976, SB-EN-0081:0.7913, SB-EN-0036:0.7553 |
| clip_only | B | q-G-EN-0074__perspective | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0074 Pleased to Meet You | perspective |  |  | SB-EN-0074:0.7909, SB-EN-0051:0.6449, SB-EN-0016:0.6445 |
| clip_only | B | q-G-EN-0093__mild_crop | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0093 The Hound of the Baskervilles | mild_crop |  |  | SB-EN-0093:0.7973, SB-EN-0081:0.7528, SB-EN-0036:0.7474 |
| clip_only | B | q-G-EN-0094__gaussian_blur | WRONG_BOOK | SB-EN-0094 O Genteel Lady! | gaussian_blur | SB-EN-0081:0.859:visual; SB-EN-0099:0.855:visual; SB-EN-0071:0.813:visual |  | SB-EN-0081:0.8589, SB-EN-0099:0.8549, SB-EN-0071:0.8127 |
| clip_only | B | q-G-EN-0097__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0097 20 Hrs. 40 Min. | occlusion |  |  | SB-EN-0097:0.7702, SB-EN-0085:0.6886, SB-VN-0009:0.6678 |
| clip_only | B | q-G-EN-0102__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0102 Dracula | occlusion |  |  | SB-EN-0102:0.7884, SB-EN-0081:0.7332, SB-EN-0099:0.7255 |
| clip_only | B | q-G-EN-0103__occlusion | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0103 The House on the Cliff | occlusion |  |  | SB-EN-0103:0.7956, SB-EN-0099:0.7239, SB-EN-0088:0.7199 |
| clip_only | OOC | q-O-EN-0003 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0081:0.835:visual |  | SB-EN-0081:0.8345, SB-VN-0043:0.7878, SB-ENS-EN001:0.7682 |
| clip_only | A | q-Q-EN-0005 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0083 The Moon Maid | scan |  |  | SB-EN-0083:0.6809, SB-EN-0071:0.6336, SB-EN-0058:0.6288 |
| clip_only | A | q-Q-EN-0013 | NO_RESULT | SB-EN-0034 How the Other Half Lives | scan |  |  | SB-EN-0081:0.7998, SB-EN-0099:0.7638, SB-EN-0078:0.7407 |
| clip_only | A | q-Q-EN-0015 | NO_RESULT | SB-EN-0041 The Age of Innocence | low_resolution |  |  | SB-EN-0085:0.6691, SB-EN-0004:0.6682, SB-EN-0041:0.6533 |
| clip_only | A | q-Q-EN-0019 | WRONG_BOOK | SB-EN-0051 Through the Woods | scan | SB-EN-0081:0.846:visual; SB-EN-0099:0.835:visual; SB-EN-0089:0.817:visual |  | SB-EN-0081:0.8457, SB-EN-0099:0.8355, SB-EN-0089:0.8172 |
| clip_only | A | q-Q-EN-0025 | NO_RESULT | SB-EN-0072 In Our Time | scan |  |  | SB-VN-0007:0.7485, SB-EN-0099:0.7317, SB-EN-0081:0.7144 |
| clip_only | A | q-Q-EN-0029 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-EN-0080 The Sun Also Rises | scan |  |  | SB-EN-0080:0.7091, SB-MD-0010:0.655, SB-EN-0071:0.6326 |
| clip_only | A | q-Q-EN-0035 | NO_RESULT | SB-EN-0102 Dracula | scan |  |  | SB-VN-0007:0.7039, SB-VN-0056:0.6975, SB-EN-0021:0.6956 |
| clip_only | A | q-Q-EN-0038 | WRONG_BOOK | SB-EN-0102 Dracula | scan | SB-EN-0081:0.817:visual |  | SB-EN-0081:0.8171, SB-EN-0036:0.7748, SB-ENS-EN001:0.771 |
| clip_only | A | q-Q-EN-0042 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-ENS-EN005 Pride and Prejudice | photo |  |  | SB-ENS-EN005:0.7476, SB-EN-0081:0.6986, SB-EN-0073:0.6937 |
| clip_only | A | q-Q-EN-0043 | GATE_REJECTED_CORRECT_TOP1 (cosine below 0.80) | SB-ENS-EN006 Little Women | scan |  |  | SB-ENS-EN006:0.7336, SB-ENS-EN008:0.6238, SB-EN-0002:0.6186 |
| hybrid | B | q-C-EN-EN001__occlusion | CORRECT_BUT_NOT_TOP1 | SB-ENS-EN001 Alice's Adventures in Wonderland | occlusion | SB-EN-0081:0.877:visual; SB-EN-0099:0.87:visual; SB-ENS-EN001:0.868:visual |  |  |
| hybrid | B | q-C-EN-EN006__occlusion | WRONG_BOOK | SB-ENS-EN006 Little Women | occlusion | SB-EN-0026:0.803:visual |  |  |
| hybrid | B | q-C-EN-EN007__occlusion | WRONG_BOOK | SB-ENS-EN007 Anne of Green Gables | occlusion | SB-EN-0052:0.5:ocr_text | {'title': 'ANNIE GREEN', 'author': 'L.M.M.'} |  |
| hybrid | A | q-C-MD-0004 | NO_RESULT | SB-MD-0003 Jaws | scan |  |  |  |
| hybrid | OOC | q-C-VN-0002 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0056:0.5:ocr_text | {'title': 'LỊCH SƯ TIỂU THUYẾT GIA-LONG TÂU-QUỐC', 'author': 'TÂN-DÂN-TỬ'} |  |
| hybrid | B | q-C-VN-0008__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0008 Phan Trần truyện | gaussian_blur | SB-VN-0022:0.924:visual; SB-VN-0008:0.92:visual; SB-VN-0015:0.863:visual | {'title': '潘陳傳', 'author': None} |  |
| hybrid | OOC | q-C-VN-0010 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0030:0.5:ocr_text | {'title': 'Khám phá Bí ẩn của những điểm chiêm bao', 'author': 'Nguyễn Trí Hiếu'} |  |
| hybrid | B | q-C-VN-0016__perspective | CORRECT_BUT_NOT_TOP1 | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | perspective | SB-VN-0063:0.805:visual; SB-VN-0016:0.762:visual+ocr_text; SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG HOÀNG-ĐẾ VÀ BINH TƯỞNG', 'author': 'J.-B. BÙI-MINH-DƯƠNG'} |  |
| hybrid | B | q-C-VN-0016__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | rot_m4 | SB-VN-0063:0.802:visual; SB-VN-0016:0.758:visual+ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG HOÀNG-ĐẾ VÀ BINH TƯỞNG', 'author': 'Thầy J.-B. BÙI-MINH-DƯƠNG'} |  |
| hybrid | B | q-C-VN-0019__gaussian_blur | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | gaussian_blur | SB-VN-0069:0.921:visual; SB-VN-0039:0.886:visual; SB-VN-0015:0.836:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__jpeg_q20 | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | jpeg_q20 | SB-VN-0069:0.929:visual; SB-VN-0039:0.921:visual; SB-VN-0071:0.893:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__low_contrast | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | low_contrast | SB-VN-0069:0.919:visual; SB-VN-0039:0.906:visual; SB-VN-0071:0.867:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__low_light | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | low_light | SB-VN-0069:0.937:visual; SB-VN-0039:0.892:visual; SB-VN-0071:0.877:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__mild_crop | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | mild_crop | SB-VN-0069:0.942:visual; SB-VN-0039:0.883:visual; SB-VN-0071:0.829:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__perspective | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | perspective | SB-VN-0069:0.919:visual; SB-VN-0039:0.875:visual; SB-VN-0071:0.874:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | B | q-C-VN-0019__rot_m4 | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | rot_m4 | SB-VN-0069:0.932:visual; SB-VN-0039:0.874:visual; SB-VN-0071:0.864:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏撰'} |  |
| hybrid | B | q-C-VN-0019__rot_p4 | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | rot_p4 | SB-VN-0069:0.926:visual; SB-VN-0039:0.882:visual; SB-VN-0071:0.871:visual | {'title': '南圻六省地輿誌', 'author': '惟明氏'} |  |
| hybrid | OOC | q-C-VN-0020 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0019:0.841:visual; SB-VN-0069:0.832:visual; SB-VN-0023:0.822:visual | {'title': 'TIÊN-NGUYỄN LOÁT-YỂU PHỒ (Thuộc về Tiền Biên)', 'author': 'TÔN-THẤT-HÂN; ƯNG-BÌNH; ƯNG-TÔN'} |  |
| hybrid | B | q-C-VN-0022__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | gaussian_blur | SB-VN-0015:0.813:visual; SB-VN-0069:0.803:visual; SB-VN-0022:0.772:visual+ocr_text | {'title': '天乎帝乎', 'author': '潘足漢'} |  |
| hybrid | B | q-C-VN-0022__jpeg_q20 | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | jpeg_q20 | SB-VN-0015:0.856:visual; SB-VN-0071:0.825:visual; SB-VN-0022:0.767:visual+ocr_text | {'title': '天乎帝乎', 'author': '潘是漢越南著'} |  |
| hybrid | B | q-C-VN-0022__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | low_contrast | SB-VN-0008:0.903:visual; SB-VN-0015:0.832:visual; SB-VN-0071:0.812:visual | {'title': '天乎帝乎', 'author': '潘是漢'} |  |
| hybrid | B | q-C-VN-0022__low_light | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | low_light | SB-VN-0069:0.831:visual; SB-VN-0015:0.828:visual; SB-VN-0071:0.802:visual | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| hybrid | B | q-C-VN-0022__mild_crop | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | mild_crop | SB-VN-0069:0.857:visual; SB-VN-0015:0.854:visual; SB-VN-0071:0.821:visual | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| hybrid | B | q-C-VN-0022__occlusion | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | occlusion | SB-VN-0008:0.869:visual; SB-VN-0071:0.827:visual; SB-VN-0015:0.815:visual | {'title': '天平論', 'author': '潘是漢'} |  |
| hybrid | B | q-C-VN-0022__perspective | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | perspective | SB-VN-0069:0.858:visual; SB-VN-0015:0.849:visual; SB-VN-0071:0.83:visual | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| hybrid | B | q-C-VN-0022__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | rot_m4 | SB-VN-0069:0.841:visual; SB-VN-0015:0.84:visual; SB-VN-0071:0.815:visual | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| hybrid | B | q-C-VN-0022__rot_p4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0022 Thiên hồ Đế hồ | rot_p4 | SB-VN-0015:0.811:visual; SB-VN-0022:0.741:visual+ocr_text; SB-VN-0008:0.704:visual+ocr_text | {'title': '天乎帝乎', 'author': '潘是漢越南著者'} |  |
| hybrid | B | q-C-VN-0023__gaussian_blur | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | gaussian_blur | SB-VN-0069:0.847:visual; SB-VN-0039:0.832:visual; SB-VN-0015:0.82:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__jpeg_q20 | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | jpeg_q20 | SB-VN-0039:0.928:visual; SB-VN-0069:0.878:visual; SB-VN-0019:0.875:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__low_contrast | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | low_contrast | SB-VN-0039:0.898:visual; SB-VN-0069:0.87:visual; SB-VN-0015:0.862:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__low_light | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | low_light | SB-VN-0069:0.883:visual; SB-VN-0015:0.875:visual; SB-VN-0039:0.861:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__mild_crop | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | mild_crop | SB-VN-0069:0.883:visual; SB-VN-0039:0.875:visual; SB-VN-0015:0.864:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__occlusion | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | occlusion | SB-VN-0039:0.9:visual; SB-VN-0069:0.846:visual; SB-VN-0019:0.843:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__perspective | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | perspective | SB-VN-0015:0.914:visual; SB-VN-0069:0.911:visual; SB-VN-0039:0.892:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__rot_m4 | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | rot_m4 | SB-VN-0069:0.867:visual; SB-VN-0015:0.864:visual; SB-VN-0039:0.855:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | B | q-C-VN-0023__rot_p4 | WRONG_BOOK | SB-VN-0023 Đại Nam quốc ngữ | rot_p4 | SB-VN-0015:0.875:visual; SB-VN-0069:0.87:visual; SB-VN-0039:0.848:visual | {'title': '大南國語', 'author': '海株子'} |  |
| hybrid | OOC | q-C-VN-0028 | FALSE_ACCEPT |  (out of catalog) | photo | SB-EN-0026:0.5:ocr_text | {'title': 'DAGESTAN CỦA TÔI', 'author': 'RASUL GAMZATOV'} |  |
| hybrid | B | q-C-VN-0029__occlusion | WRONG_BOOK | SB-VN-0029 Công giáo trên bờ vực thẳm | occlusion | SB-EN-0018:0.5:ocr_text | {'title': 'Cổ Tích Trên Giường Hãm', 'author': 'Charmian Maitland'} |  |
| hybrid | OOC | q-C-VN-0036 | FALSE_ACCEPT |  (out of catalog) | photo | SB-VN-0037:0.693:visual+ocr_text | {'title': 'NHỮNG KINH NGHIỆM TIÊN TIẾN CỦA NỀN GIÁO DỤC XÃ HỘI CHỦ NGHĨA Ở CỘNG HÒA DÂN CHỦ ĐỨC', 'author': 'NGUYỄN VĂN HUYỆN, NGUYỄN SĨ TỲ'} |  |
| hybrid | OOC | q-C-VN-0038 | FALSE_ACCEPT |  (out of catalog) | photo | SB-VN-0037:0.5:ocr_text | {'title': 'Vấn đề cải cách giáo dục ở Liên Xô', 'author': 'Nguyễn Văn Huyên, Nguyễn Sỹ Tỳ'} |  |
| hybrid | B | q-C-VN-0039__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | gaussian_blur | SB-VN-0023:0.909:visual; SB-VN-0019:0.881:visual; SB-VN-0039:0.766:visual+ocr_text | {'title': '詩經解音', 'author': '繼善堂'} |  |
| hybrid | B | q-C-VN-0039__jpeg_q20 | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | jpeg_q20 | SB-VN-0019:0.905:visual; SB-VN-0015:0.836:visual; SB-VN-0071:0.831:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | low_contrast | SB-VN-0019:0.894:visual; SB-VN-0015:0.848:visual; SB-VN-0071:0.832:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__low_light | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | low_light | SB-VN-0015:0.889:visual; SB-VN-0019:0.881:visual; SB-VN-0071:0.834:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__mild_crop | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | mild_crop | SB-VN-0019:0.888:visual; SB-VN-0071:0.827:visual; SB-VN-0015:0.825:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__occlusion | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | occlusion | SB-VN-0023:0.91:visual; SB-VN-0019:0.871:visual; SB-VN-0015:0.83:visual | {'title': '繼志書發幽音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__perspective | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | perspective | SB-VN-0019:0.911:visual; SB-VN-0071:0.887:visual; SB-VN-0015:0.848:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | rot_m4 | SB-VN-0019:0.917:visual; SB-VN-0071:0.852:visual; SB-VN-0015:0.849:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0039__rot_p4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0039 Thi kinh giải âm | rot_p4 | SB-VN-0019:0.916:visual; SB-VN-0071:0.878:visual; SB-VN-0015:0.858:visual | {'title': '詩經解音', 'author': None} |  |
| hybrid | B | q-C-VN-0043__gaussian_blur | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | gaussian_blur | SB-VN-0019:0.86:visual; SB-VN-0023:0.855:visual; SB-VN-0071:0.838:visual | {'title': '天南餘暇集', 'author': '阮兆翔'} |  |
| hybrid | B | q-C-VN-0043__jpeg_q20 | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | jpeg_q20 | SB-VN-0071:0.899:visual; SB-VN-0019:0.861:visual; SB-VN-0015:0.842:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-VN-0043 Thiên Nam dư hạ tập | low_contrast | SB-VN-0019:0.872:visual; SB-VN-0071:0.859:visual; SB-VN-0023:0.84:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__low_light | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | low_light | SB-VN-0019:0.874:visual; SB-VN-0071:0.872:visual; SB-VN-0023:0.855:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__mild_crop | CORRECT_BUT_NOT_TOP1 | SB-VN-0043 Thiên Nam dư hạ tập | mild_crop | SB-VN-0019:0.883:visual; SB-VN-0023:0.846:visual; SB-VN-0071:0.844:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__occlusion | CORRECT_BUT_NOT_TOP1 | SB-VN-0043 Thiên Nam dư hạ tập | occlusion | SB-VN-0019:0.803:visual; SB-VN-0043:0.763:visual+ocr_text; SB-VN-0069:0.5:ocr_text | {'title': '瓊苑九歌', 'author': None} |  |
| hybrid | B | q-C-VN-0043__perspective | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | perspective | SB-VN-0019:0.895:visual; SB-VN-0071:0.882:visual; SB-VN-0023:0.861:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__rot_m4 | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | rot_m4 | SB-VN-0071:0.871:visual; SB-VN-0019:0.862:visual; SB-VN-0023:0.839:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0043__rot_p4 | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | rot_p4 | SB-VN-0071:0.889:visual; SB-VN-0019:0.877:visual; SB-VN-0023:0.862:visual | {'title': '天南餘暇集', 'author': '瓊苑九歌'} |  |
| hybrid | B | q-C-VN-0048__occlusion | NO_RESULT | SB-VN-0048 Trước giờ tổng khởi nghĩa | occlusion |  |  |  |
| hybrid | B | q-C-VN-0069__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0069 Ấu học ngũ ngôn thi | gaussian_blur | SB-VN-0019:0.898:visual; SB-VN-0015:0.838:visual; SB-VN-0022:0.802:visual | {'title': '幼學五言詩', 'author': '狀元詩'} |  |
| hybrid | B | q-C-VN-0069__jpeg_q20 | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | jpeg_q20 | SB-VN-0019:0.925:visual; SB-VN-0015:0.904:visual; SB-VN-0023:0.896:visual | {'title': 'Trạng nguyên thi - Initial learning five-line poetry (状元诗 - 初学五言诗)', 'author': None} |  |
| hybrid | B | q-C-VN-0069__low_contrast | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | low_contrast | SB-VN-0019:0.934:visual; SB-VN-0015:0.881:visual; SB-VN-0008:0.827:visual | {'title': 'Trạng nguyên thi - Initial learning five-line poetry (Trạng nguyên thi - Initial learning five-line poetry)', 'author': None} |  |
| hybrid | B | q-C-VN-0069__low_light | CORRECT_BUT_NOT_TOP1 | SB-VN-0069 Ấu học ngũ ngôn thi | low_light | SB-VN-0019:0.892:visual; SB-VN-0015:0.871:visual; SB-VN-0022:0.829:visual | {'title': 'Trạng nguyên thi ấu học ngũ ngôn thi', 'author': None} |  |
| hybrid | B | q-C-VN-0069__mild_crop | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | mild_crop | SB-VN-0019:0.965:visual; SB-VN-0023:0.899:visual; SB-VN-0015:0.867:visual | {'title': '幼學五言詩', 'author': None} |  |
| hybrid | B | q-C-VN-0069__occlusion | CORRECT_BUT_NOT_TOP1 | SB-VN-0069 Ấu học ngũ ngôn thi | occlusion | SB-VN-0019:0.878:visual; SB-VN-0015:0.859:visual; SB-VN-0069:0.761:visual+ocr_text | {'title': 'Tương Đức thập lục niên trượng nguyên thi ngũ ngôn thi', 'author': None} |  |
| hybrid | B | q-C-VN-0069__perspective | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | perspective | SB-VN-0019:0.935:visual; SB-VN-0039:0.913:visual; SB-VN-0023:0.9:visual | {'title': 'Trạng nguyên诗 - 幼學五言詩', 'author': None} |  |
| hybrid | B | q-C-VN-0069__rot_m4 | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | rot_m4 | SB-VN-0019:0.956:visual; SB-VN-0039:0.898:visual; SB-VN-0023:0.879:visual | {'title': '初學五言詩', 'author': '狀元'} |  |
| hybrid | B | q-C-VN-0069__rot_p4 | WRONG_BOOK | SB-VN-0069 Ấu học ngũ ngôn thi | rot_p4 | SB-VN-0019:0.946:visual; SB-VN-0023:0.911:visual; SB-VN-0015:0.866:visual | {'title': '初學五言詩', 'author': None} |  |
| hybrid | B | q-C-VN-0070__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-VN-0070 Thực phổ bách thiên | low_contrast | SB-VN-0043:0.8:visual; SB-VN-0070:0.778:visual+ocr_text | {'title': 'THỰC-PHỔ BÁCH TIỂN', 'author': 'TRƯƠNG-THI-BÍCH'} |  |
| hybrid | B | q-C-VN-0071__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | gaussian_blur | SB-VN-0022:0.859:visual; SB-VN-0008:0.818:visual; SB-VN-0071:0.73:visual+ocr_text | {'title': '太南寰錄正編第二紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__jpeg_q20 | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | jpeg_q20 | SB-VN-0022:0.852:visual; SB-VN-0015:0.848:visual; SB-VN-0019:0.835:visual | {'title': '大南實錄正編第二紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__low_contrast | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | low_contrast | SB-VN-0022:0.869:visual; SB-VN-0019:0.867:visual; SB-VN-0008:0.826:visual | {'title': '大南實錄正編第二紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__low_light | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | low_light | SB-VN-0019:0.882:visual; SB-VN-0022:0.87:visual; SB-VN-0008:0.833:visual | {'title': '大南實錄正編第二紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__mild_crop | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | mild_crop | SB-VN-0022:0.853:visual; SB-VN-0019:0.844:visual; SB-VN-0015:0.842:visual | {'title': '大南寔錄正編第一紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__perspective | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | perspective | SB-VN-0019:0.847:visual; SB-VN-0008:0.835:visual; SB-VN-0022:0.831:visual | {'title': '大南實錄正編第一紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | rot_m4 | SB-VN-0022:0.859:visual; SB-VN-0008:0.847:visual; SB-VN-0015:0.81:visual | {'title': '大南實錄正編第二紀', 'author': None} |  |
| hybrid | B | q-C-VN-0071__rot_p4 | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | rot_p4 | SB-VN-0008:0.859:visual; SB-VN-0022:0.855:visual; SB-VN-0019:0.851:visual | {'title': '大南實錄正編第一紀', 'author': None} |  |
| hybrid | B | q-G-EN-0009__occlusion | NO_RESULT | SB-EN-0009 Bleak House | occlusion |  |  |  |
| hybrid | B | q-G-EN-0015__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-EN-0015 Tom Grogan | gaussian_blur | SB-EN-0081:0.862:visual; SB-EN-0099:0.849:visual; SB-EN-0071:0.812:visual | {'title': 'TOM GROGAN', 'author': 'F. HOPKINSON SMITH'} |  |
| hybrid | B | q-G-EN-0016__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-EN-0016 My Friend Annabel Lee | gaussian_blur | SB-EN-0081:0.802:visual; SB-EN-0016:0.732:visual+ocr_text | {'title': 'My Friend Annabel Lee', 'author': 'Mary Mac Lane'} |  |
| hybrid | B | q-G-EN-0016__occlusion | WRONG_BOOK | SB-EN-0016 My Friend Annabel Lee | occlusion | SB-EN-0099:0.84:visual; SB-EN-0081:0.826:visual; SB-EN-0043:0.8:visual |  |  |
| hybrid | B | q-G-EN-0022__occlusion | NO_RESULT | SB-EN-0022 Mink Trapping | occlusion |  |  |  |
| hybrid | B | q-G-EN-0031__occlusion | NO_RESULT | SB-EN-0031 Hare and Tortoise | occlusion |  |  |  |
| hybrid | B | q-G-EN-0047__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-EN-0047 Lady Audley's Secret | low_contrast | SB-EN-0081:0.802:visual; SB-EN-0047:0.768:visual+ocr_text | {'title': "Lady Audley's Secret", 'author': 'M.E. Braddon'} |  |
| hybrid | B | q-G-EN-0047__low_light | CORRECT_BUT_NOT_TOP1 | SB-EN-0047 Lady Audley's Secret | low_light | SB-EN-0081:0.816:visual; SB-EN-0047:0.766:visual+ocr_text | {'title': "LADY AUDLEY'S SECRET", 'author': 'M.E. BRADDON'} |  |
| hybrid | B | q-G-EN-0051__perspective | CORRECT_BUT_NOT_TOP1 | SB-EN-0051 Through the Woods | perspective | SB-EN-0026:0.814:visual; SB-EN-0099:0.81:visual; SB-EN-0051:0.712:visual+ocr_text | {'title': 'Through The Woods', 'author': 'Katherine M. Yates'} |  |
| hybrid | B | q-G-EN-0051__rot_m4 | CORRECT_BUT_NOT_TOP1 | SB-EN-0051 Through the Woods | rot_m4 | SB-EN-0026:0.835:visual; SB-EN-0099:0.834:visual; SB-EN-0081:0.82:visual | {'title': 'Through The Woods', 'author': 'Katherine M. Yates'} |  |
| hybrid | B | q-G-EN-0067__occlusion | CORRECT_BUT_NOT_TOP1 | SB-EN-0067 The Traitor | occlusion | SB-EN-0071:0.809:visual; SB-EN-0081:0.805:visual; SB-EN-0067:0.72:visual+ocr_text | {'title': 'THE TRAILBLAZER', 'author': 'THOMAS DIXON JR'} |  |
| hybrid | B | q-G-EN-0071__occlusion | CORRECT_BUT_NOT_TOP1 | SB-EN-0071 If I Were King | occlusion | SB-EN-0081:0.806:visual; SB-EN-0071:0.78:visual+ocr_text | {'title': 'IF I WERE KING', 'author': 'JUSTIN ... HY'} |  |
| hybrid | B | q-G-EN-0072__occlusion | NO_RESULT | SB-EN-0072 In Our Time | occlusion |  |  |  |
| hybrid | B | q-G-EN-0075__low_contrast | CORRECT_BUT_NOT_TOP1 | SB-EN-0075 Kabumpo in Oz | low_contrast | SB-EN-0059:0.801:visual; SB-EN-0075:0.78:visual+ocr_text | {'title': 'Kabumpo in O', 'author': 'Ruth Plumly Thompson'} |  |
| hybrid | B | q-G-EN-0075__low_light | CORRECT_BUT_NOT_TOP1 | SB-EN-0075 Kabumpo in Oz | low_light | SB-EN-0059:0.816:visual; SB-EN-0075:0.78:visual+ocr_text | {'title': 'Kabumpo in O', 'author': 'Ruth Plumly Thompson'} |  |
| hybrid | B | q-G-EN-0077__occlusion | SAME_AUTHOR_CONFUSION | SB-EN-0077 The Roly-Poly Pudding | occlusion | SB-EN-0018:0.984:ocr_text; SB-EN-0086:0.977:ocr_text; SB-EN-0070:0.968:ocr_text | {'title': None, 'author': 'BEATRIX POTTER'} |  |
| hybrid | B | q-G-EN-0081__gaussian_blur | CORRECT_BUT_NOT_TOP1 | SB-EN-0081 The Man Who Died Twice | gaussian_blur | SB-EN-0099:0.854:visual; SB-EN-0071:0.828:visual; SB-EN-0051:0.803:visual | {'title': 'The Man Who Died Twice', 'author': 'David Colquhoun Maclean'} |  |
| hybrid | B | q-G-EN-0094__gaussian_blur | WRONG_BOOK | SB-EN-0094 O Genteel Lady! | gaussian_blur | SB-EN-0081:0.859:visual; SB-EN-0071:0.813:visual; SB-EN-0026:0.811:visual | {'title': 'O Senteel Lady!', 'author': 'Esther Forbes'} |  |
| hybrid | OOC | q-O-EN-0001 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0099:0.5:ocr_text | {'title': 'OOD-LE-VK THE WANDERER', 'author': 'LIDE AND JOHANSEN'} |  |
| hybrid | OOC | q-O-EN-0002 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0038:0.5:ocr_text | {'title': 'FUTILITY', 'author': 'MORGAN ROBERTSON'} |  |
| hybrid | OOC | q-O-EN-0003 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0081:0.835:visual; SB-VN-0040:0.5:ocr_text | {'title': 'MONISM OR ADVAITISM?', 'author': 'MANILAL NABHUBHAI DVIVEDL'} |  |
| hybrid | OOC | q-O-EN-0005 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0019:0.5:ocr_text | {'title': 'My Autobiography', 'author': 'Benito Mussolini'} |  |
| hybrid | OOC | q-O-EN-0007 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0004:0.5:ocr_text | {'title': 'Lud in the Mist', 'author': 'Hope Mirrlees'} |  |
| hybrid | OOC | q-O-EN-0008 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'The Family Herb Doctor Medical Recipe Book', 'author': None} |  |
| hybrid | OOC | q-O-EN-0011 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'Fifty Years a Hunter and Trapper', 'author': None} |  |
| hybrid | OOC | q-O-EN-0012 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0025:0.5:ocr_text | {'title': 'The Bondman', 'author': 'Hall Caine'} |  |
| hybrid | OOC | q-O-EN-0013 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0070:0.5:ocr_text | {'title': "Doctor Dolittle's Zoo", 'author': 'Hugh Lofting'} |  |
| hybrid | OOC | q-O-EN-0014 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0091:0.5:ocr_text | {'title': 'WITH LEE IN VIRGINIA', 'author': 'G.A. HENTY'} |  |
| hybrid | OOC | q-O-EN-0015 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'The Life Of The Spider', 'author': 'J·H·Fabre'} |  |
| hybrid | OOC | q-O-EN-0016 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0083:0.5:ocr_text | {'title': 'THE SHIP OF ISHTAR', 'author': 'A. MERRITT'} |  |
| hybrid | OOC | q-O-EN-0018 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0010:0.5:ocr_text | {'title': 'The Damnation of Theron Ware', 'author': 'Harold Frederic'} |  |
| hybrid | OOC | q-O-EN-0020 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0020:0.5:ocr_text | {'title': 'The New Zealanders at Gallipoli', 'author': 'Major Fred Waite, D.S.O., N.Z.E.'} |  |
| hybrid | OOC | q-O-EN-0021 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0010:0.5:ocr_text | {'title': 'THE TURNSTILE', 'author': 'A.E.W. MASON'} |  |
| hybrid | OOC | q-O-EN-0022 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0091:0.5:ocr_text | {'title': 'The BRIMMING CUP', 'author': 'Dorothy Canfield'} |  |
| hybrid | OOC | q-O-EN-0023 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0103:0.5:ocr_text | {'title': 'THE MISSING CHUMS', 'author': 'FRANKLIN W. DIXON'} |  |
| hybrid | OOC | q-O-EN-0025 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0085:0.5:ocr_text | {'title': 'New Amazonia', 'author': 'Mrs. George Corbett'} |  |
| hybrid | OOC | q-O-EN-0026 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0078:0.5:ocr_text | {'title': 'Froudacity: West Indian Fables Explained', 'author': 'J.J. Thomas'} |  |
| hybrid | OOC | q-O-EN-0028 | FALSE_ACCEPT |  (out of catalog) | scan | SB-ENS-EN007:0.5:ocr_text | {'title': 'The BLUE CASTLE', 'author': 'L.M. MONTGOMERY'} |  |
| hybrid | OOC | q-O-EN-0029 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0050:0.5:ocr_text | {'title': 'THE COMMON LAW.', 'author': 'O. W. HOLMES, Jr.'} |  |
| hybrid | A | q-Q-EN-0019 | WRONG_BOOK | SB-EN-0051 Through the Woods | scan | SB-EN-0081:0.846:visual; SB-EN-0099:0.835:visual; SB-EN-0089:0.817:visual | {'title': 'Through The Woods', 'author': 'Katherine M. Yates'} |  |
| ocr_only | B | q-C-EN-EN001__gaussian_blur | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | gaussian_blur |  |  |  |
| ocr_only | B | q-C-EN-EN001__jpeg_q20 | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | jpeg_q20 |  |  |  |
| ocr_only | B | q-C-EN-EN001__low_contrast | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | low_contrast |  |  |  |
| ocr_only | B | q-C-EN-EN001__low_light | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | low_light |  |  |  |
| ocr_only | B | q-C-EN-EN001__mild_crop | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | mild_crop |  |  |  |
| ocr_only | B | q-C-EN-EN001__occlusion | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | occlusion |  |  |  |
| ocr_only | B | q-C-EN-EN001__perspective | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | perspective |  |  |  |
| ocr_only | B | q-C-EN-EN001__rot_m4 | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | rot_m4 |  |  |  |
| ocr_only | B | q-C-EN-EN001__rot_p4 | OCR_NO_TEXT | SB-ENS-EN001 Alice's Adventures in Wonderland | rot_p4 |  |  |  |
| ocr_only | B | q-C-EN-EN006__occlusion | OCR_NO_TEXT | SB-ENS-EN006 Little Women | occlusion |  |  |  |
| ocr_only | B | q-C-EN-EN007__occlusion | WRONG_BOOK | SB-ENS-EN007 Anne of Green Gables | occlusion | SB-EN-0052:0.5:ocr_text | {'title': 'ANNIE GREEN', 'author': 'L.M.M.'} |  |
| ocr_only | A | q-C-MD-0004 | OCR_NO_TEXT | SB-MD-0003 Jaws | scan |  |  |  |
| ocr_only | OOC | q-C-VN-0002 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0056:0.5:ocr_text | {'title': 'LỊCH SƯ TIỂU THUYẾT GIA-LONG TÂU-QUỐC', 'author': 'TÂN-DÂN-TỬ'} |  |
| ocr_only | B | q-C-VN-0004__low_contrast | WRONG_BOOK | SB-VN-0004 Lịch sử nước ta | low_contrast | SB-VN-0003:0.5:ocr_text | {'title': 'LỊCH SỬ NƯỚC TA', 'author': 'VM TUYÊN TRUYỀN BỘ XUẤT BẢN'} |  |
| ocr_only | B | q-C-VN-0006__gaussian_blur | OCR_NO_TEXT | SB-VN-0006 Thề non nước | gaussian_blur |  |  |  |
| ocr_only | B | q-C-VN-0006__jpeg_q20 | OCR_NO_TEXT | SB-VN-0006 Thề non nước | jpeg_q20 |  |  |  |
| ocr_only | B | q-C-VN-0006__low_contrast | OCR_NO_TEXT | SB-VN-0006 Thề non nước | low_contrast |  |  |  |
| ocr_only | B | q-C-VN-0006__low_light | OCR_NO_TEXT | SB-VN-0006 Thề non nước | low_light |  |  |  |
| ocr_only | B | q-C-VN-0006__mild_crop | OCR_NO_TEXT | SB-VN-0006 Thề non nước | mild_crop |  |  |  |
| ocr_only | B | q-C-VN-0006__occlusion | OCR_NO_TEXT | SB-VN-0006 Thề non nước | occlusion |  |  |  |
| ocr_only | B | q-C-VN-0006__perspective | OCR_NO_TEXT | SB-VN-0006 Thề non nước | perspective |  |  |  |
| ocr_only | B | q-C-VN-0006__rot_m4 | OCR_NO_TEXT | SB-VN-0006 Thề non nước | rot_m4 |  |  |  |
| ocr_only | B | q-C-VN-0006__rot_p4 | OCR_NO_TEXT | SB-VN-0006 Thề non nước | rot_p4 |  |  |  |
| ocr_only | B | q-C-VN-0008__gaussian_blur | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | gaussian_blur | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__jpeg_q20 | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | jpeg_q20 | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__low_contrast | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | low_contrast | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__low_light | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | low_light | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__mild_crop | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | mild_crop | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__occlusion | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | occlusion | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__perspective | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | perspective | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__rot_m4 | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | rot_m4 | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | B | q-C-VN-0008__rot_p4 | WRONG_BOOK | SB-VN-0008 Phan Trần truyện | rot_p4 | SB-VN-0069:0.5:ocr_text | {'title': '潘陳傳', 'author': None} |  |
| ocr_only | OOC | q-C-VN-0010 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0030:0.5:ocr_text | {'title': 'Khám phá Bí ẩn của những điểm chiêm bao', 'author': 'Nguyễn Trí Hiếu'} |  |
| ocr_only | B | q-C-VN-0016__gaussian_blur | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | gaussian_blur | SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG', 'author': 'HOÀNG-HỒ VÀ HENRI FUYER'} |  |
| ocr_only | B | q-C-VN-0016__low_contrast | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | low_contrast | SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG HOÀNG-ĐẾ VÀ BINH TƯỚNG', 'author': 'J.-B. BÙI-MINH-DƯƠNG'} |  |
| ocr_only | B | q-C-VN-0016__low_light | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | low_light | SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG HOÀNG-ĐẾ VÀ BINH TƯỚNG', 'author': 'J.-B. BÙI-MINH-DƯƠNG'} |  |
| ocr_only | B | q-C-VN-0016__mild_crop | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | mild_crop | SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỀN PHAN-XÍCH-LONG', 'author': 'J.-B. BUI-MINH-BƯƠNG'} |  |
| ocr_only | B | q-C-VN-0016__perspective | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | perspective | SB-VN-0008:0.5:ocr_text | {'title': 'TRUYỆN PHAN-XÍCH-LONG HOÀNG-ĐẾ VÀ BINH TƯỞNG', 'author': 'J.-B. BÙI-MINH-DƯƠNG'} |  |
| ocr_only | B | q-C-VN-0016__rot_p4 | WRONG_BOOK | SB-VN-0016 Truyện Phan Xích Long – hoàng đế và binh tướng bị xử tại Tòa Đại hình Sài Gòn | rot_p4 | SB-VN-0023:0.5:ocr_text | {'title': 'TRUYỀN PHAN-XÍCH-LONG', 'author': 'J.-B. BÙI-MINH-DƯƠNG'} |  |
| ocr_only | B | q-C-VN-0019__occlusion | WRONG_BOOK | SB-VN-0019 Nam Kỳ lục tỉnh địa dư chí | occlusion | SB-VN-0003:0.5:ocr_text | {'title': '南圻興志', 'author': '惟明氏'} |  |
| ocr_only | OOC | q-C-VN-0020 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0017:0.5:ocr_text | {'title': 'TIÊN-NGUYỄN LOÁT-YỂU PHỒ (Thuộc về Tiền Biên)', 'author': 'TÔN-THẤT-HÂN; ƯNG-BÌNH; ƯNG-TÔN'} |  |
| ocr_only | B | q-C-VN-0022__gaussian_blur | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | gaussian_blur | SB-VN-0043:0.5:ocr_text | {'title': '天乎帝乎', 'author': '潘足漢'} |  |
| ocr_only | B | q-C-VN-0022__jpeg_q20 | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | jpeg_q20 | SB-VN-0043:0.5:ocr_text | {'title': '天乎帝乎', 'author': '潘是漢越南著'} |  |
| ocr_only | B | q-C-VN-0022__low_light | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | low_light | SB-VN-0023:0.5:ocr_text | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| ocr_only | B | q-C-VN-0022__mild_crop | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | mild_crop | SB-VN-0023:0.5:ocr_text | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| ocr_only | B | q-C-VN-0022__occlusion | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | occlusion | SB-VN-0024:0.5:ocr_text | {'title': '天平論', 'author': '潘是漢'} |  |
| ocr_only | B | q-C-VN-0022__perspective | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | perspective | SB-VN-0023:0.5:ocr_text | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| ocr_only | B | q-C-VN-0022__rot_m4 | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | rot_m4 | SB-VN-0023:0.5:ocr_text | {'title': '天乎帝乎', 'author': '越南潘是漢'} |  |
| ocr_only | B | q-C-VN-0022__rot_p4 | WRONG_BOOK | SB-VN-0022 Thiên hồ Đế hồ | rot_p4 | SB-VN-0043:0.5:ocr_text | {'title': '天乎帝乎', 'author': '潘是漢越南著者'} |  |
| ocr_only | B | q-C-VN-0027__low_light | WRONG_BOOK | SB-VN-0027 Huỳnh Thúc Kháng tự truyện | low_light | SB-VN-0003:0.5:ocr_text | {'title': 'HUYNH - THUC - KHANG TU - TRUYEN', 'author': 'Nguyen Han-Van'} |  |
| ocr_only | OOC | q-C-VN-0028 | FALSE_ACCEPT |  (out of catalog) | photo | SB-EN-0026:0.5:ocr_text | {'title': 'DAGESTAN CỦA TÔI', 'author': 'RASUL GAMZATOV'} |  |
| ocr_only | B | q-C-VN-0029__occlusion | WRONG_BOOK | SB-VN-0029 Công giáo trên bờ vực thẳm | occlusion | SB-EN-0018:0.5:ocr_text | {'title': 'Cổ Tích Trên Giường Hãm', 'author': 'Charmian Maitland'} |  |
| ocr_only | OOC | q-C-VN-0036 | FALSE_ACCEPT |  (out of catalog) | photo | SB-VN-0037:0.5:ocr_text | {'title': 'NHỮNG KINH NGHIỆM TIÊN TIẾN CỦA NỀN GIÁO DỤC XÃ HỘI CHỦ NGHĨA Ở CỘNG HÒA DÂN CHỦ ĐỨC', 'author': 'NGUYỄN VĂN HUYỆN, NGUYỄN SĨ TỲ'} |  |
| ocr_only | OOC | q-C-VN-0038 | FALSE_ACCEPT |  (out of catalog) | photo | SB-VN-0037:0.5:ocr_text | {'title': 'Vấn đề cải cách giáo dục ở Liên Xô', 'author': 'Nguyễn Văn Huyên, Nguyễn Sỹ Tỳ'} |  |
| ocr_only | B | q-C-VN-0039__occlusion | WRONG_BOOK | SB-VN-0039 Thi kinh giải âm | occlusion | SB-VN-0069:0.5:ocr_text | {'title': '繼志書發幽音', 'author': None} |  |
| ocr_only | B | q-C-VN-0043__occlusion | WRONG_BOOK | SB-VN-0043 Thiên Nam dư hạ tập | occlusion | SB-VN-0069:0.5:ocr_text | {'title': '瓊苑九歌', 'author': None} |  |
| ocr_only | B | q-C-VN-0048__occlusion | OCR_NO_TEXT | SB-VN-0048 Trước giờ tổng khởi nghĩa | occlusion |  |  |  |
| ocr_only | B | q-C-VN-0054__gaussian_blur | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | gaussian_blur |  |  |  |
| ocr_only | B | q-C-VN-0054__jpeg_q20 | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | jpeg_q20 |  |  |  |
| ocr_only | B | q-C-VN-0054__low_contrast | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | low_contrast |  |  |  |
| ocr_only | B | q-C-VN-0054__low_light | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | low_light |  |  |  |
| ocr_only | B | q-C-VN-0054__mild_crop | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | mild_crop |  |  |  |
| ocr_only | B | q-C-VN-0054__occlusion | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | occlusion |  |  |  |
| ocr_only | B | q-C-VN-0054__perspective | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | perspective |  |  |  |
| ocr_only | B | q-C-VN-0054__rot_m4 | OCR_NO_TEXT | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | rot_m4 |  |  |  |
| ocr_only | B | q-C-VN-0054__rot_p4 | WRONG_BOOK | SB-VN-0054 Hoàng tử Cảnh như Tây (Quyển 1) | rot_p4 | SB-VN-0065:0.5:ocr_text | {'title': 'LICHÉ_N.ĐỨC', 'author': 'La Nature'} |  |
| ocr_only | B | q-C-VN-0055__gaussian_blur | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | gaussian_blur |  |  |  |
| ocr_only | B | q-C-VN-0055__jpeg_q20 | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | jpeg_q20 |  |  |  |
| ocr_only | B | q-C-VN-0055__low_contrast | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | low_contrast |  |  |  |
| ocr_only | B | q-C-VN-0055__low_light | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | low_light |  |  |  |
| ocr_only | B | q-C-VN-0055__mild_crop | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | mild_crop |  |  |  |
| ocr_only | B | q-C-VN-0055__occlusion | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | occlusion |  |  |  |
| ocr_only | B | q-C-VN-0055__perspective | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | perspective |  |  |  |
| ocr_only | B | q-C-VN-0055__rot_m4 | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | rot_m4 |  |  |  |
| ocr_only | B | q-C-VN-0055__rot_p4 | OCR_NO_TEXT | SB-VN-0055 Hoàng tử Cảnh như Tây (Quyển 2) | rot_p4 |  |  |  |
| ocr_only | B | q-C-VN-0056__gaussian_blur | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | gaussian_blur |  |  |  |
| ocr_only | B | q-C-VN-0056__jpeg_q20 | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | jpeg_q20 |  |  |  |
| ocr_only | B | q-C-VN-0056__low_contrast | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | low_contrast |  |  |  |
| ocr_only | B | q-C-VN-0056__low_light | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | low_light |  |  |  |
| ocr_only | B | q-C-VN-0056__mild_crop | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | mild_crop |  |  |  |
| ocr_only | B | q-C-VN-0056__occlusion | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | occlusion |  |  |  |
| ocr_only | B | q-C-VN-0056__perspective | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | perspective |  |  |  |
| ocr_only | B | q-C-VN-0056__rot_m4 | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | rot_m4 |  |  |  |
| ocr_only | B | q-C-VN-0056__rot_p4 | OCR_NO_TEXT | SB-VN-0056 Gia Long phục quốc | rot_p4 |  |  |  |
| ocr_only | B | q-C-VN-0071__gaussian_blur | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | gaussian_blur | SB-VN-0043:0.5:ocr_text | {'title': '太南寰錄正編第二紀', 'author': None} |  |
| ocr_only | B | q-C-VN-0071__occlusion | WRONG_BOOK | SB-VN-0071 Đại Nam thực lục chính biên đệ nhị kỷ | occlusion | SB-EN-0044:0.5:ocr_text | {'title': 'Thập Đại', 'author': None} |  |
| ocr_only | B | q-G-EN-0009__occlusion | OCR_NO_TEXT | SB-EN-0009 Bleak House | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0016__occlusion | OCR_NO_TEXT | SB-EN-0016 My Friend Annabel Lee | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0019__occlusion | OCR_NO_TEXT | SB-EN-0019 Ten Days that Shook the World | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0021__gaussian_blur | WRONG_BOOK | SB-EN-0021 Springhaven | gaussian_blur | SB-EN-0091:0.5:ocr_text | {'title': 'Springhaven: A Tale of the Great War', 'author': 'R. D. Blackmore'} |  |
| ocr_only | B | q-G-EN-0022__occlusion | OCR_NO_TEXT | SB-EN-0022 Mink Trapping | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0026__gaussian_blur | OCR_NO_TEXT | SB-EN-0026 Firecrackers | gaussian_blur |  |  |  |
| ocr_only | B | q-G-EN-0026__jpeg_q20 | OCR_NO_TEXT | SB-EN-0026 Firecrackers | jpeg_q20 |  |  |  |
| ocr_only | B | q-G-EN-0026__low_contrast | OCR_NO_TEXT | SB-EN-0026 Firecrackers | low_contrast |  |  |  |
| ocr_only | B | q-G-EN-0026__low_light | OCR_NO_TEXT | SB-EN-0026 Firecrackers | low_light |  |  |  |
| ocr_only | B | q-G-EN-0026__mild_crop | OCR_NO_TEXT | SB-EN-0026 Firecrackers | mild_crop |  |  |  |
| ocr_only | B | q-G-EN-0026__occlusion | OCR_NO_TEXT | SB-EN-0026 Firecrackers | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0026__perspective | OCR_NO_TEXT | SB-EN-0026 Firecrackers | perspective |  |  |  |
| ocr_only | B | q-G-EN-0026__rot_m4 | OCR_NO_TEXT | SB-EN-0026 Firecrackers | rot_m4 |  |  |  |
| ocr_only | B | q-G-EN-0026__rot_p4 | OCR_NO_TEXT | SB-EN-0026 Firecrackers | rot_p4 |  |  |  |
| ocr_only | B | q-G-EN-0030__gaussian_blur | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | gaussian_blur |  |  |  |
| ocr_only | B | q-G-EN-0030__jpeg_q20 | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | jpeg_q20 |  |  |  |
| ocr_only | B | q-G-EN-0030__low_contrast | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | low_contrast |  |  |  |
| ocr_only | B | q-G-EN-0030__low_light | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | low_light |  |  |  |
| ocr_only | B | q-G-EN-0030__mild_crop | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | mild_crop |  |  |  |
| ocr_only | B | q-G-EN-0030__occlusion | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0030__perspective | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | perspective |  |  |  |
| ocr_only | B | q-G-EN-0030__rot_m4 | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | rot_m4 |  |  |  |
| ocr_only | B | q-G-EN-0030__rot_p4 | OCR_NO_TEXT | SB-EN-0030 Little Joe Otter | rot_p4 |  |  |  |
| ocr_only | B | q-G-EN-0031__occlusion | OCR_NO_TEXT | SB-EN-0031 Hare and Tortoise | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0038__occlusion | WRONG_BOOK | SB-EN-0038 The Mysterious Stranger | occlusion | SB-EN-0025:0.5:ocr_text | {'title': 'The Once and Future King', 'author': 'T. H. White'} |  |
| ocr_only | B | q-G-EN-0039__gaussian_blur | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | gaussian_blur |  |  |  |
| ocr_only | B | q-G-EN-0039__jpeg_q20 | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | jpeg_q20 |  |  |  |
| ocr_only | B | q-G-EN-0039__low_contrast | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | low_contrast |  |  |  |
| ocr_only | B | q-G-EN-0039__low_light | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | low_light |  |  |  |
| ocr_only | B | q-G-EN-0039__mild_crop | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | mild_crop |  |  |  |
| ocr_only | B | q-G-EN-0039__occlusion | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0039__perspective | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | perspective |  |  |  |
| ocr_only | B | q-G-EN-0039__rot_m4 | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | rot_m4 |  |  |  |
| ocr_only | B | q-G-EN-0039__rot_p4 | OCR_NO_TEXT | SB-EN-0039 Confederate Military History | rot_p4 |  |  |  |
| ocr_only | B | q-G-EN-0043__mild_crop | OCR_NO_TEXT | SB-EN-0043 Tom Beauling | mild_crop |  |  |  |
| ocr_only | B | q-G-EN-0044__mild_crop | WRONG_BOOK | SB-EN-0044 The Way of the Wild | mild_crop | SB-EN-0090:0.5:ocr_text | {'title': 'Call of the Wild', 'author': None} |  |
| ocr_only | B | q-G-EN-0062__occlusion | OCR_NO_TEXT | SB-EN-0062 A Month in Honolulu | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0072__occlusion | OCR_NO_TEXT | SB-EN-0072 In Our Time | occlusion |  |  |  |
| ocr_only | B | q-G-EN-0077__occlusion | SAME_AUTHOR_CONFUSION | SB-EN-0077 The Roly-Poly Pudding | occlusion | SB-EN-0018:0.984:ocr_text; SB-EN-0086:0.977:ocr_text; SB-EN-0077:0.976:ocr_text | {'title': None, 'author': 'BEATRIX POTTER'} |  |
| ocr_only | B | q-G-EN-0099__gaussian_blur | OCR_NO_TEXT | SB-EN-0099 Afloat and Ashore | gaussian_blur |  |  |  |
| ocr_only | B | q-G-EN-0099__mild_crop | WRONG_BOOK | SB-EN-0099 Afloat and Ashore | mild_crop | SB-EN-0077:0.5:ocr_text | {'title': 'LOAF AND HAVE', 'author': None} |  |
| ocr_only | B | q-G-EN-0105__occlusion | WRONG_BOOK | SB-EN-0105 Pratt Portraits | occlusion | SB-EN-0073:0.5:ocr_text | {'title': 'Portraits Sketched in a New England Suburb', 'author': 'Fuller'} |  |
| ocr_only | OOC | q-O-EN-0001 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0099:0.5:ocr_text | {'title': 'OOD-LE-VK THE WANDERER', 'author': 'LIDE AND JOHANSEN'} |  |
| ocr_only | OOC | q-O-EN-0002 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0038:0.5:ocr_text | {'title': 'FUTILITY', 'author': 'MORGAN ROBERTSON'} |  |
| ocr_only | OOC | q-O-EN-0003 | FALSE_ACCEPT |  (out of catalog) | scan | SB-VN-0040:0.5:ocr_text | {'title': 'MONISM OR ADVAITISM?', 'author': 'MANILAL NABHUBHAI DVIVEDL'} |  |
| ocr_only | OOC | q-O-EN-0005 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0019:0.5:ocr_text | {'title': 'My Autobiography', 'author': 'Benito Mussolini'} |  |
| ocr_only | OOC | q-O-EN-0007 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0004:0.5:ocr_text | {'title': 'Lud in the Mist', 'author': 'Hope Mirrlees'} |  |
| ocr_only | OOC | q-O-EN-0008 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'The Family Herb Doctor Medical Recipe Book', 'author': None} |  |
| ocr_only | OOC | q-O-EN-0011 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'Fifty Years a Hunter and Trapper', 'author': None} |  |
| ocr_only | OOC | q-O-EN-0012 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0025:0.5:ocr_text | {'title': 'The Bondman', 'author': 'Hall Caine'} |  |
| ocr_only | OOC | q-O-EN-0013 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0070:0.5:ocr_text | {'title': "Doctor Dolittle's Zoo", 'author': 'Hugh Lofting'} |  |
| ocr_only | OOC | q-O-EN-0014 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0091:0.5:ocr_text | {'title': 'WITH LEE IN VIRGINIA', 'author': 'G.A. HENTY'} |  |
| ocr_only | OOC | q-O-EN-0015 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0058:0.5:ocr_text | {'title': 'The Life Of The Spider', 'author': 'J·H·Fabre'} |  |
| ocr_only | OOC | q-O-EN-0016 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0083:0.5:ocr_text | {'title': 'THE SHIP OF ISHTAR', 'author': 'A. MERRITT'} |  |
| ocr_only | OOC | q-O-EN-0018 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0010:0.5:ocr_text | {'title': 'The Damnation of Theron Ware', 'author': 'Harold Frederic'} |  |
| ocr_only | OOC | q-O-EN-0020 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0020:0.5:ocr_text | {'title': 'The New Zealanders at Gallipoli', 'author': 'Major Fred Waite, D.S.O., N.Z.E.'} |  |
| ocr_only | OOC | q-O-EN-0021 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0010:0.5:ocr_text | {'title': 'THE TURNSTILE', 'author': 'A.E.W. MASON'} |  |
| ocr_only | OOC | q-O-EN-0022 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0091:0.5:ocr_text | {'title': 'The BRIMMING CUP', 'author': 'Dorothy Canfield'} |  |
| ocr_only | OOC | q-O-EN-0023 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0103:0.5:ocr_text | {'title': 'THE MISSING CHUMS', 'author': 'FRANKLIN W. DIXON'} |  |
| ocr_only | OOC | q-O-EN-0025 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0085:0.5:ocr_text | {'title': 'New Amazonia', 'author': 'Mrs. George Corbett'} |  |
| ocr_only | OOC | q-O-EN-0026 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0078:0.5:ocr_text | {'title': 'Froudacity: West Indian Fables Explained', 'author': 'J.J. Thomas'} |  |
| ocr_only | OOC | q-O-EN-0028 | FALSE_ACCEPT |  (out of catalog) | scan | SB-ENS-EN007:0.5:ocr_text | {'title': 'The BLUE CASTLE', 'author': 'L.M. MONTGOMERY'} |  |
| ocr_only | OOC | q-O-EN-0029 | FALSE_ACCEPT |  (out of catalog) | scan | SB-EN-0050:0.5:ocr_text | {'title': 'THE COMMON LAW.', 'author': 'O. W. HOLMES, Jr.'} |  |

## Success samples (first 5 per method/track by query id)

- clip_only / B / q-C-EN-EN001__gaussian_blur: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.893:visual (condition gaussian_blur)
- clip_only / B / q-C-EN-EN001__jpeg_q20: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.96:visual (condition jpeg_q20)
- clip_only / B / q-C-EN-EN001__low_contrast: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.985:visual (condition low_contrast)
- clip_only / B / q-C-EN-EN001__low_light: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.972:visual (condition low_light)
- clip_only / B / q-C-EN-EN001__mild_crop: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.963:visual (condition mild_crop)
- clip_only / OOC / q-C-VN-0002:  (out of catalog) ←  (condition scan)
- clip_only / OOC / q-C-VN-0010:  (out of catalog) ←  (condition scan)
- clip_only / OOC / q-C-VN-0028:  (out of catalog) ←  (condition photo)
- clip_only / OOC / q-C-VN-0038:  (out of catalog) ←  (condition photo)
- clip_only / OOC / q-O-EN-0001:  (out of catalog) ←  (condition scan)
- clip_only / A / q-Q-EN-0001: SB-EN-0009 Bleak House ← SB-EN-0009:0.924:visual (condition low_resolution)
- clip_only / A / q-Q-EN-0002: SB-EN-0049 The Beautiful and Damned ← SB-EN-0049:0.92:visual (condition scan)
- clip_only / A / q-Q-EN-0006: SB-EN-0038 The Mysterious Stranger ← SB-EN-0038:0.853:visual (condition scan)
- clip_only / A / q-Q-EN-0007: SB-EN-0110 Three Men in a Boat ← SB-EN-0110:0.835:visual (condition low_resolution)
- clip_only / A / q-Q-EN-0022: SB-EN-0055 Cabbages and Kings ← SB-EN-0055:0.825:visual (condition scan)
- hybrid / B / q-C-EN-EN001__gaussian_blur: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.893:visual (condition gaussian_blur)
- hybrid / B / q-C-EN-EN001__jpeg_q20: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.96:visual (condition jpeg_q20)
- hybrid / B / q-C-EN-EN001__low_contrast: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.985:visual (condition low_contrast)
- hybrid / B / q-C-EN-EN001__low_light: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.972:visual (condition low_light)
- hybrid / B / q-C-EN-EN001__mild_crop: SB-ENS-EN001 Alice's Adventures in Wonderland ← SB-ENS-EN001:0.963:visual (condition mild_crop)
- hybrid / A / q-C-EN-EN004: SB-EN-0102 Dracula ← SB-EN-0102:1.0:ocr_text (condition scan)
- hybrid / A / q-C-VN-0018: SB-VN-0017 Lịch triều hiến chương loại chí ← SB-VN-0017:1.0:ocr_text (condition photo)
- hybrid / A / q-C-VN-0064: SB-VN-0063 Đường kách mệnh ← SB-VN-0063:0.5:ocr_text (condition photo_angled)
- hybrid / A / q-Q-EN-0001: SB-EN-0009 Bleak House ← SB-EN-0009:0.955:visual+ocr_text (condition low_resolution)
- hybrid / A / q-Q-EN-0002: SB-EN-0049 The Beautiful and Damned ← SB-EN-0049:0.952:visual+ocr_text (condition scan)
- ocr_only / B / q-C-EN-EN003__gaussian_blur: SB-ENS-EN003 The Wonderful Wizard of Oz ← SB-ENS-EN003:1.0:ocr_text (condition gaussian_blur)
- ocr_only / B / q-C-EN-EN003__jpeg_q20: SB-ENS-EN003 The Wonderful Wizard of Oz ← SB-ENS-EN003:1.0:ocr_text (condition jpeg_q20)
- ocr_only / B / q-C-EN-EN003__low_contrast: SB-ENS-EN003 The Wonderful Wizard of Oz ← SB-ENS-EN003:1.0:ocr_text (condition low_contrast)
- ocr_only / B / q-C-EN-EN003__low_light: SB-ENS-EN003 The Wonderful Wizard of Oz ← SB-ENS-EN003:1.0:ocr_text (condition low_light)
- ocr_only / B / q-C-EN-EN003__mild_crop: SB-ENS-EN003 The Wonderful Wizard of Oz ← SB-ENS-EN003:1.0:ocr_text (condition mild_crop)
- ocr_only / A / q-C-EN-EN004: SB-EN-0102 Dracula ← SB-EN-0102:1.0:ocr_text (condition scan)
- ocr_only / A / q-C-VN-0018: SB-VN-0017 Lịch triều hiến chương loại chí ← SB-VN-0017:1.0:ocr_text (condition photo)
- ocr_only / A / q-C-VN-0064: SB-VN-0063 Đường kách mệnh ← SB-VN-0063:0.5:ocr_text (condition photo_angled)
- ocr_only / A / q-Q-EN-0001: SB-EN-0009 Bleak House ← SB-EN-0009:1.0:ocr_text (condition low_resolution)
- ocr_only / A / q-Q-EN-0002: SB-EN-0049 The Beautiful and Damned ← SB-EN-0049:1.0:ocr_text (condition scan)