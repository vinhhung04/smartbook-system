"""Re-derive permission_status for every rights_audit row from the stored
source-page evidence (license name + license template categories) with the
current classifier, then apply the annotator's documented overrides
(rights/rights_overrides.csv). The value computed from the source page is kept
in `permission_status_source_page`; nothing is deleted.
"""
from __future__ import annotations

import collect
from common import DATASET_DIR
from dataset_loader import read_csv, write_csv


def main() -> None:
    path = DATASET_DIR / "rights" / "rights_audit.csv"
    rows = read_csv(path)
    overrides = {r["asset_id"]: r for r in read_csv(DATASET_DIR / "rights" / "rights_overrides.csv")}
    for row in rows:
        ext = {"LicenseShortName": {"value": row["license_name"]}, "Restrictions": {"value": ""}}
        cats = [c.strip() for c in row.get("license_evidence_categories", "").split(";") if c.strip()]
        derived = collect.classify_rights(ext, cats)
        row["permission_status_source_page"] = derived["permission_status"]
        row["permission_status"] = derived["permission_status"]
        row["redistribution_status"] = derived["redistribution_status"]
        row["rights_jurisdiction"] = derived["rights_jurisdiction"]
        row["review_note"] = ""
        if row["asset_id"] in overrides:
            o = overrides[row["asset_id"]]
            row["permission_status"] = o["permission_status"]
            row["redistribution_status"] = "NOT_FOR_PUBLIC_DISTRIBUTION_PENDING_REVIEW"
            row["review_note"] = o["reason"]
    write_csv(path, rows)
    import collections
    print(collections.Counter(r["permission_status"] for r in rows))


if __name__ == "__main__":
    main()
