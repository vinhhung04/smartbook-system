# Documentation Audit - SmartBook System

## Muc tieu

Dọn gọn he thong tai lieu, giu root folder sach va chi giu cac huong dan co gia tri cao cho contributor moi.

## 1) Phan loai README hien co

| File | Danh gia | Ly do | Khuyen nghi |
|---|---|---|---|
| README.md (root) | 🟢 Quan trong | Entry point cho toan bo du an, onboarding + architecture + quickstart | **Giu** lam Single Source of Truth cho tong quan |
| apps/web/README.md | 🟡 Co gia tri nhung can lam sach | Co thong tin frontend huu ich, nhung thuong de kem noi dung template Vite mac dinh | **Giu co chon loc**, xoa phan template/react-vite boilerplate |
| services/ai-service/README.md | 🟡 Gia tri trung binh | Co huong dan endpoint AI nhung pham vi hep, thieu tong quan service-level | **Gop/bo sung**: dua setup chung ve root/docs, giu lai phan AI dac thu |
| services/inventory-service/README.md | 🔴 Thieu gia tri doc lap | Noi dung qua ngan, de trung lap voi README tong va docs overview | **Gop vao README root + docs**, can nhac xoa file nay |

## 2) Danh sach de xoa hoac gop

### 🧹 Nen gop vao README root (hoac docs)

| File | Noi dung nen gop |
|---|---|
| services/inventory-service/README.md | Tong quan service, cach run co ban, route nhom inventory |
| services/ai-service/README.md | Cac endpoint cốt lõi, yeu cau Ollama model, bien moi truong AI |

### ❌ Nen xoa/noi dung can loai bo

| Vi tri | Noi dung |
|---|---|
| apps/web/README.md | Doan template mac dinh "React + Vite" va plugin boilerplate khong con gia tri domain |

### ✅ Nen giu nguyen

| File | Ly do |
|---|---|
| README.md (root) | Huong dan vao du an cho nguoi moi |
| docs/RUN_WITH_DOCKER.md | Runbook Docker chi tiet, troubleshooting thuc te |
| docs/PROJECT_OVERVIEW.md | Kien truc chi tiet, phu hop doc sau |

## 3) Documentation Tree de xuat (chuan monorepo)

```text
smartbook-system/
|- README.md                              # Entry point: tong quan, role map, quickstart, route map
|- docs/
|  |- PROJECT_OVERVIEW.md                 # Kien truc chi tiet
|  |- RUN_WITH_DOCKER.md                  # Huong dan van hanh bang Docker
|  |- CONTRIBUTING.md                     # Quy uoc dong gop, branch, commit, PR
|  |- API_REFERENCE.md                    # Route theo domain: auth/inventory/borrow/ai
|  |- SERVICES/
|  |  |- AUTH_SERVICE.md                  # Dac thu IAM, JWT, RBAC/PBAC
|  |  |- INVENTORY_SERVICE.md             # Dac thu kho, ton, supplier, stock-audit
|  |  |- BORROW_SERVICE.md                # Dac thu muon/tra, reservation, fines
|  |  \- AI_SERVICE.md                   # Dac thu OCR, metadata, Ollama model
|  \- TEST_GUIDES/
|     |- CUSTOMER_PORTAL_PHASE1_TEST_GUIDE.md
|     |- CUSTOMER_PORTAL_PHASE34_TEST_GUIDE.md
|     \- BORROW_PHASE1_HARDEN_TEST_GUIDE.md
|- apps/
|  \- web/README.md                      # CHI GIU setup frontend rieng, khong lap lai root
\- services/
   |- ai-service/README.md                # CHI GIU setup nhanh service dac thu (neu can)
   \- (cac service khac)                 # Co the bo README neu khong co setup rieng
```

## 4) Nguyen tac de root folder sach

- 📌 Root chi giu tai lieu dinh huong va cach chay nhanh.
- 📌 Service-level README chi ton tai neu co setup hoac rui ro van hanh dac thu.
- 📌 Cac noi dung trung lap (cung mot lenh setup, cung mot route map) phai quy ve 1 file chuan.
- 📌 Uu tien docs theo huong "overview -> domain detail -> test guide" de de scan.

## 5) Ke hoach dọn dep de xuat

1. Chot README root lam tai lieu tong.
2. Lam sach apps/web/README.md (xoa boilerplate template).
3. Gop noi dung inventory-service README vao docs/SERVICES/INVENTORY_SERVICE.md, sau do xoa README cu.
4. Chuan hoa ai-service README thanh quick note va tro den docs/SERVICES/AI_SERVICE.md.
5. Them docs/CONTRIBUTING.md va docs/API_REFERENCE.md de giam trao doi onboarding lap lai.
