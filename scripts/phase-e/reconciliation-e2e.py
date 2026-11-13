"""Phase E live E2E: AI action -> unknown outcome -> RECONCILE_REQUIRED -> admin
reconciliation, through the real gateway, ai-service, inventory-service and
PostgreSQL of the local docker stack. Nothing is mocked: the unknown outcome
is produced by stopping inventory-service while the confirmed action runs.

    python scripts/phase-e/reconciliation-e2e.py --password <demo password>

Needs: the docker compose stack up (gateway on :3000), docker CLI on PATH,
demo users manager01 (WAREHOUSE_MANAGER), hung (ADMIN), librarian01,
customer01. Prints PASS/FAIL per step and exits non-zero on any FAIL.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time

import httpx

STEPS: list[tuple[str, bool, str]] = []


def step(name: str, ok: bool, detail: str = "") -> bool:
    STEPS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} - {name}{' :: ' + detail if detail else ''}", flush=True)
    return ok


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", *args], check=True, capture_output=True)


def wait_healthy(container: str, seconds: int = 120) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        status = subprocess.run(["docker", "inspect", "-f", "{{.State.Health.Status}}", container],
                                capture_output=True, text=True).stdout.strip()
        if status == "healthy":
            return
        time.sleep(3)
    raise RuntimeError(f"{container} not healthy")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default="http://localhost:3000")
    parser.add_argument("--password", required=True)
    parser.add_argument("--stop-before-reconcile", action="store_true",
                        help="leave the action in RECONCILE_REQUIRED (to resolve it through the UI)")
    args = parser.parse_args()
    g = args.gateway
    client = httpx.Client(timeout=120)

    def login(user):
        return client.post(f"{g}/auth/login", json={"identifier": user, "password": args.password}).json()["token"]

    tokens = {u: login(u) for u in ("manager01", "hung", "librarian01", "customer01")}

    def call(method, path, user, **kw):
        return client.request(method, f"{g}{path}", headers={"Authorization": f"Bearer {tokens[user]}"}, **kw)

    # 1. staff drafts an action through the AI chat (real planner, real LLM)
    action = None
    for message in ("Tạo đề xuất nhập sách cho các đầu sách sắp hết hàng",
                    "Lập đề xuất nhập thêm sách đang thiếu trong kho"):
        body = call("POST", "/ai/chat", "manager01", json={"message": message, "conversation_history": []}).json()
        action = body.get("pending_action")
        if action:
            break
    if not step("1. staff creates an action via AI chat", bool(action), json.dumps(action, ensure_ascii=False)[:160]):
        return 1
    action_id = action["id"]

    # 2-4. confirm while the target service is down -> outcome unknown -> RECONCILE_REQUIRED
    compose("stop", "inventory-service")
    try:
        confirm = call("POST", "/ai/actions/confirm", "manager01", json={"action_id": action_id, "confirm": True})
    finally:
        compose("start", "inventory-service")
        wait_healthy("smartbook-system-inventory-service-1")
    step("2. action confirmed by its creator", confirm.status_code in (200, 502), f"HTTP {confirm.status_code}")
    detail = call("GET", f"/ai/assistant/actions/{action_id}", "manager01").json()["action"]
    step("3-4. executor could not learn the outcome -> RECONCILE_REQUIRED",
         detail["status"] == "RECONCILE_REQUIRED", f"status={detail['status']} error={str(detail.get('error_message'))[:120]}")

    # retry is not executed again
    again = call("POST", "/ai/actions/confirm", "manager01", json={"action_id": action_id, "confirm": True})
    step("4b. a RECONCILE_REQUIRED action is not executed again", again.status_code == 409, f"HTTP {again.status_code}")

    # 5. customer cannot see it
    cust = call("GET", f"/ai/assistant/actions/{action_id}", "customer01")
    step("5. customer cannot read the action", cust.status_code == 403, f"HTTP {cust.status_code}")

    # 6. librarian cannot reconcile
    lib = call("POST", "/ai/actions/reconcile", "librarian01",
               json={"action_id": action_id, "outcome": "EXECUTED", "note": "librarian tries to resolve", "evidence_reference": "X"})
    step("6. librarian cannot reconcile", lib.status_code == 403, f"HTTP {lib.status_code}")

    # 7. admin sees the queue (filtered)
    queue = call("GET", "/ai/assistant/actions", "hung",
                 params={"status": "RECONCILE_REQUIRED", "mine": "false", "type": action["type"]}).json()
    step("7. admin lists the reconciliation queue", any(i["id"] == action_id for i in queue["items"]),
         f"total={queue.get('total')}")

    # 8. admin reads the detail and checks the target service for evidence
    admin_detail = call("GET", f"/ai/assistant/actions/{action_id}", "hung").json()
    events = [a["event_type"] for a in admin_detail["audit_logs"]]
    step("8. admin reads detail + audit trail", "RECONCILE_REQUIRED" in events, f"events={events}")
    prs = call("GET", "/api/purchase-requests", "hung", params={"limit": 50}).json()
    pr_rows = prs.get("data") if isinstance(prs, dict) else prs
    pr_rows = pr_rows if isinstance(pr_rows, list) else (pr_rows or {}).get("items", [])
    recent = [p for p in pr_rows if action_id in json.dumps(p, ensure_ascii=False)]
    evidence = (recent[0].get("request_number") or recent[0].get("id")) if recent else None
    outcome = "EXECUTED" if evidence else "FAILED"
    note = (f"Đã kiểm tra danh sách đề xuất nhập: tìm thấy {evidence} gắn với {action_id}" if evidence
            else f"Đã kiểm tra danh sách đề xuất nhập: không có đề xuất nào gắn với {action_id}")

    if args.stop_before_reconcile:
        print(json.dumps({"action_id": action_id, "left_in": "RECONCILE_REQUIRED", "evidence_found": evidence,
                          "steps": len(STEPS), "failed": len([x for x in STEPS if not x[1]])}, ensure_ascii=False))
        return 1 if any(not x[1] for x in STEPS) else 0

    # validation: note and evidence are required
    bad = call("POST", "/ai/actions/reconcile", "hung", json={"action_id": action_id, "outcome": "EXECUTED", "note": "  "})
    step("9a. empty note is refused", bad.status_code == 400, f"HTTP {bad.status_code}")

    # 9. admin records the verified outcome
    ok = call("POST", "/ai/actions/reconcile", "hung",
              json={"action_id": action_id, "outcome": outcome, "note": note, "evidence_reference": evidence})
    step(f"9. admin reconciles as {outcome} (evidence: {evidence or 'none found'})", ok.status_code == 200,
         f"HTTP {ok.status_code} {ok.text[:120]}")

    # 10. audit log
    after = call("GET", f"/ai/assistant/actions/{action_id}", "hung").json()
    rec = [a for a in after["audit_logs"] if a["event_type"] == "RECONCILED"]
    step("10. audit log has one RECONCILED row with actor, before/after, note",
         len(rec) == 1 and rec[0]["old_status"] == "RECONCILE_REQUIRED" and rec[0]["new_status"] == outcome
         and rec[0]["metadata"].get("reconciliation_note") == note and "ADMIN" in (rec[0]["actor_roles"] or []),
         json.dumps(rec, ensure_ascii=False)[:220])

    # 11. no second reconciliation
    twice = call("POST", "/ai/actions/reconcile", "hung",
                 json={"action_id": action_id, "outcome": "FAILED", "note": "second attempt should fail"})
    step("11. second reconciliation is refused", twice.status_code == 409, f"HTTP {twice.status_code}")

    # 12. a fresh read (page refresh) shows the persisted state
    refreshed = call("GET", f"/ai/assistant/actions/{action_id}", "hung").json()["action"]
    step("12. state persists across reads", refreshed["status"] == outcome, f"status={refreshed['status']}")

    failed = [s for s in STEPS if not s[1]]
    print(json.dumps({"action_id": action_id, "steps": len(STEPS), "failed": len(failed)}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
