import os
import random
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402

import collect  # noqa: E402
import dataset_validator  # noqa: E402
import perturb  # noqa: E402


class IsbnTests(unittest.TestCase):
    def test_checksum(self):
        self.assertTrue(dataset_validator.isbn13_valid("978-0-306-40615-7"))
        self.assertFalse(dataset_validator.isbn13_valid("9780306406158"))
        self.assertFalse(dataset_validator.isbn13_valid("12345"))


class PerturbTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new("RGB", (200, 300), (120, 60, 30))

    def test_every_transform_runs_and_is_seed_deterministic(self):
        for name in perturb.TRANSFORMS:
            seed = perturb._seed("G-X", name)
            a, pa = perturb.apply(self.image, name, random.Random(seed))
            b, pb = perturb.apply(self.image, name, random.Random(seed))
            self.assertEqual(pa, pb, name)
            if not isinstance(a, bytes):
                self.assertEqual(a.tobytes(), b.tobytes(), name)

    def test_seed_differs_per_asset(self):
        self.assertNotEqual(perturb._seed("G-A", "occlusion"), perturb._seed("G-B", "occlusion"))


class RightsClassificationTests(unittest.TestCase):
    def ext(self, short):
        return {"LicenseShortName": {"value": short}}

    def test_cc_by_sa_is_open_license(self):
        r = collect.classify_rights(self.ext("CC BY-SA 4.0"), [])
        self.assertEqual(r["permission_status"], "VERIFIED_OPEN_LICENSE")

    def test_us_plus_life70_is_public_domain(self):
        r = collect.classify_rights(self.ext("Public domain"), ["Category:PD-US-expired", "Category:PD-old-70"])
        self.assertEqual(r["permission_status"], "VERIFIED_PUBLIC_DOMAIN")

    def test_single_jurisdiction_claim_is_source_claim_only(self):
        r = collect.classify_rights(self.ext("Public domain"), ["Category:PD-Vietnam"])
        self.assertEqual(r["permission_status"], "SOURCE_CLAIM_ONLY")
        self.assertIn("Vietnam", r["rights_jurisdiction"])

    def test_magic_bytes(self):
        self.assertEqual(collect._sniff(b"\xff\xd8\xff\xe0rest"), "image/jpeg")
        self.assertIsNone(collect._sniff(b"<html>"))


if __name__ == "__main__":
    unittest.main()
