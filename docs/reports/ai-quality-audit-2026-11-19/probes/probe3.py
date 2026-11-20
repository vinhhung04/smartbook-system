"""Live checks after the P0-1 / P0-2 fixes."""
import json, sys
import probe as p

OUT = sys.argv[1]
res = []
for rep in range(3):
    for u in (None, "customer01", "librarian01"):
        for q in ("Thư viện có sách Atomic Habits không?", "thu vien co sach cua nguyen nhat anh khong",
                  "Thư viện có sách dạy lập trình Rust cho người mới không?"):
            r = p.call("/ai/chat", u, {"message": q + " " * rep})
            b = r["body"] if isinstance(r["body"], dict) else {}
            res.append({"rep": rep, "system": "chat", "user": u, "message": q, "status": r["status"],
                        "reply": b.get("reply"), "intent": b.get("intent"), "sources": b.get("context_sources"),
                        "warnings": b.get("retrieval_warnings")})
            print(rep, u, q[:30], r["status"], (b.get("reply") or "")[:110].replace("\n", " "), flush=True)
for rep in range(5):
    for q in ("bao nhieu dau sach dang duoi nguong ton", "Toàn hệ thống có bao nhiêu đầu sách dưới ngưỡng tồn tối thiểu?"):
        r = p.call("/ai/assistant", "hung", {"message": q})
        s = p.summarize_assist(r)
        res.append({"rep": rep, "system": "assistant", "message": q, "status": r["status"], **s})
        print(rep, q[:30], r["status"], s.get("verification"), (s.get("answer") or "")[:110].replace("\n", " "), flush=True)
json.dump(res, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("wrote", OUT, len(res))
