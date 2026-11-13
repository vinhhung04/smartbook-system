"""Phase F end-to-end checks against the REAL local stack (gateway localhost:3000,
auth / inventory / borrow / analytics services, ai-service image built from
this working tree, live OpenRouter). Six demo roles, one login each (the
gateway rate-limits logins). The cover photo is a synthetic cover rendered
here with the title of a book that exists in the live catalog - no external
image is downloaded.

    python eval/phase_f_e2e.py          (writes eval/reports/phase_f_e2e.json)
"""
from __future__ import annotations

import io
import json
import os
import sys
import time

import httpx
from PIL import Image, ImageDraw, ImageFont

GW = os.getenv("SMARTBOOK_GATEWAY", "http://localhost:3000")
PASSWORD = "123456"
USERS = {"ADMIN": "hung", "WAREHOUSE_MANAGER": "manager01", "WAREHOUSE_STAFF": "staff01", "LIBRARIAN": "librarian01",
         "CUSTOMER": "customer01", "SUPPLIER": "supplier-sv"}
OUT = os.path.join(os.path.dirname(__file__), "reports", "phase_f_e2e.json")
results: list[dict] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append({"check": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail and not ok else ""))


def cover(title: str, author: str) -> bytes:
    img = Image.new("RGB", (600, 900), (245, 238, 220))
    draw = ImageDraw.Draw(img)
    font = None
    for path in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.exists(path):
            font, small = ImageFont.truetype(path, 64), ImageFont.truetype(path, 40)
            break
    if font is None:
        font = small = ImageFont.load_default()
    draw.rectangle([30, 30, 570, 870], outline=(90, 40, 30), width=8)
    draw.text((70, 300), title.upper(), fill=(90, 20, 20), font=font)
    draw.text((70, 700), author, fill=(40, 40, 40), font=small)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def main() -> None:
    c = httpx.Client(base_url=GW, timeout=180)
    tokens = {}
    for role, user in USERS.items():
        r = c.post("/auth/login", json={"username": user, "password": PASSWORD})
        tokens[role] = r.json()["token"]
        time.sleep(1.2)
    H = {role: {"Authorization": f"Bearer {t}"} for role, t in tokens.items()}

    # ── F1: capabilities per role ──────────────────────────────────────────
    expect = {"ADMIN": "decision_assistant", "WAREHOUSE_MANAGER": "decision_assistant",
              "WAREHOUSE_STAFF": "warehouse_work", "LIBRARIAN": "library_operations", "CUSTOMER": "reader",
              "SUPPLIER": "supplier"}
    caps = {}
    for role in USERS:
        body = c.get("/ai/capabilities", headers=H[role]).json()
        caps[role] = body
        check(f"capabilities:{role}:experience", body.get("experience") == expect[role], body.get("experience"))
    check("capabilities:anonymous", c.get("/ai/capabilities").json().get("experience") == "anonymous")
    check("capabilities:supplier_no_image", caps["SUPPLIER"]["multimodal"]["enabled"] is False)
    check("capabilities:customer_image", caps["CUSTOMER"]["multimodal"]["enabled"] is True)

    # ── F1: assistant gate unchanged ───────────────────────────────────────
    for role in ("WAREHOUSE_STAFF", "LIBRARIAN", "CUSTOMER", "SUPPLIER"):
        r = c.post("/ai/assistant", headers=H[role], json={"message": "Kho nào rủi ro nhất?"})
        check(f"assistant_gate:{role}:403", r.status_code == 403, r.status_code)

    # ── F1: personal data per role through /chat ───────────────────────────
    def chat(role, message, **extra):
        r = c.post("/ai/chat", headers=H[role], json={"message": message, **extra})
        return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else {})

    st, body = chat("SUPPLIER", "Đơn hàng của tôi đã giao đủ chưa?")
    eps = [s.get("endpoint") for s in body.get("context_sources", [])]
    check("supplier:chat_ok", st == 200, st)
    check("supplier:no_internal_sources", not any(str(e).startswith(("/analytics", "/api/books", "/borrow")) for e in eps), eps)
    check("supplier:explainability_present", bool(body.get("explainability")), list(body))
    st, body = chat("SUPPLIER", "Kho Hà Nội còn bao nhiêu sách tồn kho?")
    eps = [s.get("endpoint") for s in body.get("context_sources", [])]
    check("supplier:no_inventory_or_analytics", not any(str(e).startswith(("/analytics", "/api/inventory")) for e in eps), eps)
    st, body = chat("CUSTOMER", "Cho tôi xem KPI tổng quan toàn hệ thống hôm nay")
    eps = [s.get("endpoint") for s in body.get("context_sources", [])]
    check("customer:no_system_analytics", not any(str(e).startswith("/analytics") for e in eps), eps)
    st, body = chat("WAREHOUSE_STAFF", "Báo cáo ngoại lệ của tôi thế nào?")
    check("staff:chat_ok", st == 200, st)

    # ── F3: photo intake and refusals ──────────────────────────────────────
    catalog = c.get("/api/books", headers=H["ADMIN"]).json()
    book = next(b for b in catalog if b.get("title", "").startswith("Hoàng Tử Bé")) if any(
        b.get("title", "").startswith("Hoàng Tử Bé") for b in catalog) else catalog[1]
    photo = cover(book["title"], book.get("author") or "")

    def identify(role, data=photo, ack="true", ctype="image/jpeg"):
        return c.post("/ai/vision/identify?stream=false", headers=H[role],
                      files={"file": ("cover.jpg", data, ctype)}, data={"external_processing_ack": ack})

    r = identify("SUPPLIER")
    check("vision:supplier_403", r.status_code == 403, r.status_code)
    r = identify("CUSTOMER", ack="false")
    check("vision:no_notice_428", r.status_code == 428, r.status_code)
    r = identify("CUSTOMER", data=b'<svg xmlns="http://www.w3.org/2000/svg"></svg>' * 10, ctype="image/png")
    check("vision:svg_415", r.status_code == 415, r.status_code)
    r = c.post("/ai/vision/identify?stream=false", files={"file": ("c.jpg", photo, "image/jpeg")},
               data={"external_processing_ack": "true"})
    check("vision:anonymous_401", r.status_code == 401, r.status_code)

    started = time.perf_counter()
    r = identify("CUSTOMER")
    latency = round((time.perf_counter() - started) * 1000)
    rec = r.json() if r.status_code == 200 else {}
    top = (rec.get("candidates") or [{}])[0]
    check("vision:customer_identifies_catalog_book", r.status_code == 200 and top.get("book_id") == str(book["id"]),
          {"status": rec.get("status"), "top": top.get("title"), "want": book["title"], "http": r.status_code})
    check("vision:no_probability_wording", "%" not in json.dumps(rec.get("explanation", {}), ensure_ascii=False))
    aid = rec.get("attachment_id")

    st, body = chat("CUSTOMER", "Đây là sách gì? Thư viện còn không?", attachment_id=aid, image_turn=True)
    check("vision_chat:customer_followup_ok", st == 200 and (body.get("image_context") or {}).get("used") is True, st)
    check("vision_chat:image_evidence", any(e.get("source_type") == "IMAGE_RECOGNITION"
                                            for e in (body.get("explainability") or {}).get("evidence", [])))
    reply1 = body.get("reply", "")
    st, body = chat("CUSTOMER", "Sách này có được mượn nhiều không?", attachment_id=aid)
    check("vision_chat:second_followup_keeps_book", st == 200 and (body.get("image_context") or {}).get("used") is True,
          body.get("image_context"))
    st, body = chat("CUSTOMER", "Thư viện mở cửa mấy giờ?", attachment_id=aid)
    check("vision_chat:topic_switch_does_not_reuse", (body.get("image_context") or {}).get("used") is False,
          body.get("image_context"))
    st, _ = chat("LIBRARIAN", "Sách này là gì?", attachment_id=aid)
    check("vision_chat:other_user_410", st == 410, st)
    st, _ = chat("CUSTOMER", "Sách này?", attachment_id=aid, book_id="00000000-0000-0000-0000-000000000000")
    check("vision_chat:forged_book_400", st == 400, st)

    for role in ("WAREHOUSE_STAFF", "LIBRARIAN", "ADMIN"):
        r = identify(role)
        check(f"vision:{role}:identify", r.status_code == 200 and (r.json().get("candidates") or [{}])[0].get("book_id")
              == str(book["id"]), r.status_code)
        time.sleep(1)
    r = identify("WAREHOUSE_MANAGER")
    maid = r.json().get("attachment_id") if r.status_code == 200 else None
    check("vision:WAREHOUSE_MANAGER:identify", r.status_code == 200, r.status_code)
    if maid:
        r = c.post("/ai/assistant", headers=H["WAREHOUSE_MANAGER"],
                   json={"message": "Sách này có được mượn nhiều không, tồn kho thế nào?", "attachment_id": maid,
                         "image_turn": True})
        body = r.json() if r.status_code == 200 else {}
        check("vision_assistant:manager_ok", r.status_code == 200 and (body.get("image_context") or {}).get("used"),
              r.status_code)
        check("assistant:explainability_contract", set((body.get("explainability") or {})) >=
              {"evidence", "claims", "explanation", "verification"}, list(body.get("explainability") or {}))

    # ── revocation ─────────────────────────────────────────────────────────
    c.post("/auth/logout", headers=H["CUSTOMER"])
    r = c.get("/ai/capabilities", headers=H["CUSTOMER"])
    check("revoked_token:capabilities_401", r.status_code == 401, r.status_code)
    r = identify("CUSTOMER")
    check("revoked_token:vision_401", r.status_code == 401, r.status_code)

    passed = sum(1 for x in results if x["pass"])
    report = {"run_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "passed": passed, "total": len(results),
              "identify_latency_ms_customer": latency, "sample_reply_photo_turn": reply1[:400], "checks": results}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(report, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{passed}/{len(results)} passed; identify latency {latency} ms")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
