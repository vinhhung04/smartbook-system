"""Phase E live E2E: reader -> AI chat -> reservation draft -> confirm ->
borrow-service -> reservation -> retries -> no duplicate. Real gateway,
ai-service, borrow-service, inventory-service and PostgreSQL.

    python scripts/phase-e/reservation-idempotency-e2e.py --password <demo password>

The reservation it creates is cancelled at the end (as staff), leaving the
reader's data as it was apart from the cancelled row and its audit entries.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import uuid

import httpx

STEPS: list[tuple[str, bool, str]] = []


def step(name, ok, detail=""):
    STEPS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} - {name}{' :: ' + detail if detail else ''}", flush=True)
    return ok


def wait_healthy(container, seconds=150):
    deadline = time.time() + seconds
    while time.time() < deadline:
        out = subprocess.run(["docker", "inspect", "-f", "{{.State.Health.Status}}", container],
                             capture_output=True, text=True).stdout.strip()
        if out == "healthy":
            return
        time.sleep(3)
    raise RuntimeError(f"{container} not healthy")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway", default="http://localhost:3000")
    parser.add_argument("--password", required=True)
    parser.add_argument("--reader", default="customer01")
    args = parser.parse_args()
    g, client = args.gateway, httpx.Client(timeout=120)
    tokens = {u: client.post(f"{g}/auth/login", json={"identifier": u, "password": args.password}).json()["token"]
              for u in (args.reader, "hung", "librarian01")}

    def call(method, path, user, headers=None, **kw):
        return client.request(method, f"{g}{path}",
                              headers={"Authorization": f"Bearer {tokens[user]}", **(headers or {})}, **kw)

    def my_reservations():
        rows = call("GET", "/borrow/my/reservations", args.reader).json()
        rows = rows.get("data") if isinstance(rows, dict) else rows
        return rows if isinstance(rows, list) else (rows or {}).get("items", [])

    # a borrowable book with stock that the reader has no live reservation for
    books = call("GET", "/api/books", "hung").json()
    books = books.get("data") if isinstance(books, dict) else books
    held = {r.get("variant_id") for r in my_reservations() if r.get("status") in ("PENDING", "CONFIRMED", "READY_FOR_PICKUP")}
    candidates = [b for b in books if b.get("variant_id") and b.get("variant_id") not in held
                  and int(b.get("available_quantity") or b.get("quantity") or 0) >= 2]
    # 1. chat -> draft (the planner must resolve the book to a variant + warehouse)
    action, title, payload = None, None, {}
    for book in candidates[:3]:
        title = book["title"]
        for phrase in ("Đặt giúp tôi cuốn", "Giữ giúp tôi cuốn"):
            body = call("POST", "/ai/chat", args.reader,
                        json={"message": f"{phrase} {title}", "conversation_history": []}).json()
            got = body.get("pending_action")
            if got and got["type"] == "CREATE_RESERVATION_DRAFT" and (got.get("payload") or {}).get("variant_id")                     and (got.get("payload") or {}).get("warehouse_id"):
                action, payload = got, got["payload"]
                break
        if action:
            break
    if not step("1. reader asks the AI to reserve a book -> draft with variant + warehouse", bool(action),
                f"title={title!r} action={json.dumps(action, ensure_ascii=False)[:160]}"):
        return 1
    action_id = action["id"]
    def reservation_total():  # the list is paginated (20 per page): count from meta.total
        return call("GET", "/borrow/my/reservations", args.reader).json()["meta"]["total"]

    before = reservation_total()

    # 2. confirm -> borrow-service creates the reservation
    confirm = call("POST", "/ai/actions/confirm", args.reader, json={"action_id": action_id, "confirm": True}).json()
    reservation = ((confirm.get("result") or {}).get("reservation") or {}).get("data") or {}
    step("2. confirm creates exactly one real reservation", confirm.get("status") == "EXECUTED" and bool(reservation.get("id")),
         f"status={confirm.get('status')} reservation={reservation.get('reservation_number')}")
    rid = reservation.get("id")

    # 3. retry of the confirm: idempotent replay, executor not run again
    again = call("POST", "/ai/actions/confirm", args.reader, json={"action_id": action_id, "confirm": True}).json()
    step("3. confirming again replays the stored result", again.get("status") == "EXECUTED"
         and (((again.get("result") or {}).get("reservation") or {}).get("data") or {}).get("id") == rid)

    # 4. the executor's own retry after a lost response: same Idempotency-Key straight to borrow-service
    key = f"ai-reservation-{action_id}"
    body = {"variant_id": payload["variant_id"], "warehouse_id": payload["warehouse_id"], "quantity": 1, "source_channel": "WEB"}
    retry = call("POST", "/borrow/my/reservations", args.reader, headers={"Idempotency-Key": key}, json=body)
    step("4. retry with the same key returns the same reservation (200, idempotent)",
         retry.status_code == 200 and retry.json().get("idempotent") is True and retry.json()["data"]["id"] == rid,
         f"HTTP {retry.status_code}")

    # 5. concurrent retries with the same key
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        futures = [pool.submit(call, "POST", "/borrow/my/reservations", args.reader,
                               {"Idempotency-Key": key}, json=body) for _ in range(4)]
        answers = [f.result() for f in futures]
    step("5. four concurrent retries -> all the same reservation", all(a.status_code == 200 and a.json()["data"]["id"] == rid
                                                                         for a in answers),
         str([a.status_code for a in answers]))

    # 6. same key, different payload -> conflict
    other = {**body, "quantity": 2}
    conflict = call("POST", "/borrow/my/reservations", args.reader, headers={"Idempotency-Key": key}, json=other)
    step("6. same key with a different payload -> 409 IDEMPOTENCY_KEY_REUSED",
         conflict.status_code == 409 and conflict.json().get("code") == "IDEMPOTENCY_KEY_REUSED", f"HTTP {conflict.status_code}")

    # 7. same key from another user (a librarian at the desk, same customer and book) -> not a replay;
    #    the business rule then refuses it as a second live reservation for that book
    desk = {**body, "customer_id": reservation.get("customer_id"), "source_channel": "COUNTER"}
    other_user = call("POST", "/borrow/reservations", "librarian01", headers={"Idempotency-Key": key}, json=desk)
    step("7. another user's request with the same key never receives the reader's reservation",
         other_user.status_code == 409 and other_user.json().get("data", {}).get("id") != rid,
         f"HTTP {other_user.status_code} {other_user.text[:100]}")

    # 8. a different key for the same book is refused by the business rule (one live reservation per book)
    fresh = call("POST", "/borrow/my/reservations", args.reader, headers={"Idempotency-Key": str(uuid.uuid4())}, json=body)
    step("8. a new key for the same book is a duplicate (409), not a second reservation", fresh.status_code == 409,
         f"HTTP {fresh.status_code}")

    # 9. retry after borrow-service restarts
    subprocess.run(["docker", "compose", "restart", "borrow-service"], check=True, capture_output=True)
    wait_healthy("smartbook-system-borrow-service-1")
    after_restart = call("POST", "/borrow/my/reservations", args.reader, headers={"Idempotency-Key": key}, json=body)
    step("9. retry after a borrow-service restart still replays", after_restart.status_code == 200
         and after_restart.json()["data"]["id"] == rid, f"HTTP {after_restart.status_code}")

    count = reservation_total()
    step("10. no duplicate: the reader has exactly one more reservation than before", count == before + 1,
         f"before={before} after={count}")

    # cleanup
    cancel = call("PATCH", f"/borrow/reservations/{rid}/cancel", "hung", headers={"Idempotency-Key": str(uuid.uuid4())})
    print(f"cleanup: cancel reservation {reservation.get('reservation_number')} -> HTTP {cancel.status_code}")
    failed = [s for s in STEPS if not s[1]]
    print(json.dumps({"action_id": action_id, "reservation_id": rid, "steps": len(STEPS), "failed": len(failed)}))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
