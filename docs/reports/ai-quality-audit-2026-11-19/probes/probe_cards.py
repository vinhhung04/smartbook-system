import json, sys
import probe as p
res = []
for u in ("hung", "manager01"):
    for q in ("Kho HCM Chinh có sách nào tồn thấp cần nhập thêm?", "Chi Nhanh District 1 nên nhập thêm sách gì?",
              "Sách tồn thấp ở Kho HCM Chinh và đề xuất nhập", "Nên nhập thêm sách gì?"):
        r = p.call("/ai/assistant", u, {"message": q})
        b = r["body"] if isinstance(r["body"], dict) else {}
        low = (b.get("data") or {}).get("get_warehouse_low_stock_items") or {}
        res.append({"user": u, "q": q, "tools": [(t["name"], t.get("arguments")) for t in b.get("tools_used") or []],
                    "table_titles": [i.get("title") for i in low.get("items") or []],
                    "cards": [(c.get("title"), c.get("source"), c.get("action")) for c in b.get("recommendations") or []],
                    "answer": b.get("answer"), "data_keys": sorted((b.get("data") or {}).keys()),
                    "plan": {k: (b.get("plan") or {}).get(k) for k in ("capabilities", "answer_mode", "requested_analysis")}})
        x = res[-1]
        print(u, q, "| tools", [t[0] for t in x["tools"]], "| plan", x["plan"])
        print("   table:", x["table_titles"][:8])
        print("   cards:", [c[0] for c in x["cards"]])
        print("   answer:", (x["answer"] or "")[:200].replace("\n", " "), flush=True)
json.dump(res, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
