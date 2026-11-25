"""Reproduce: 'Tạo đề xuất nhập sách cho sách X ở kho Y' on /chat and /assistant.
Creates at most draft pending actions (confirmation-gated); never confirms them."""
import json, sys
import probe as p

OUT = sys.argv[1]
QS = [
    "Tạo đề xuất nhập sách cho sách Atomic Habits ở kho Kho HCM Chinh",
    "Tạo đề xuất nhập sách cho sách Norwegian Wood ở kho Chi Nhanh District 1",
    "Tạo đề xuất nhập sách cho sách Nhà Giả Kim ở kho Chi Nhanh District 1",
    "tao de xuat nhap sach cho sach Truyen Kieu o kho Ha Noi",
]
res = []
for u in ("hung", "manager01", "staff01"):
    for q in QS:
        r = p.call("/ai/chat", u, {"message": q})
        b = r["body"] if isinstance(r["body"], dict) else {}
        pa = b.get("pending_action") or {}
        res.append({"system": "chat", "user": u, "message": q, "status": r["status"], "intent": b.get("intent"),
                    "reply": b.get("reply") or b.get("detail"), "sources": b.get("context_sources"),
                    "pending_action": {k: pa.get(k) for k in ("type", "summary", "payload", "warnings", "requires_review")} if pa else None})
        print("chat", u, q[:50], r["status"], b.get("intent"), "| action:", pa.get("type"), "|", (b.get("reply") or "")[:90].replace("\n", " "), flush=True)
for u in ("hung", "manager01"):
    for q in QS:
        r = p.call("/ai/assistant", u, {"message": q})
        s = p.summarize_assist(r)
        b = r["body"] if isinstance(r["body"], dict) else {}
        pa = b.get("pending_action") or {}
        res.append({"system": "assistant", "user": u, "message": q, "status": r["status"], **s,
                    "pending_action": {k: pa.get(k) for k in ("type", "summary", "payload", "warnings")} if pa else None})
        print("asst", u, q[:50], r["status"], s.get("tools"), "| action:", pa.get("type"), "|", (s.get("answer") or "")[:90].replace("\n", " "), flush=True)
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT, len(res))
