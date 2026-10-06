-- Public branch page metadata. Nullable and additive: existing warehouses keep
-- working unchanged and simply show no phone/hours until staff fill them in.
ALTER TABLE "warehouses"
    ADD COLUMN "phone" VARCHAR(30),
    ADD COLUMN "email" VARCHAR(255),
    ADD COLUMN "opening_hours" VARCHAR(255),
    ADD COLUMN "description" TEXT;
