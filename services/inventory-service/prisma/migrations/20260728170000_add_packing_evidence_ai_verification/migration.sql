-- AlterTable
ALTER TABLE "packing_camera_evidence" ADD COLUMN     "ai_verification_result" JSONB,
ADD COLUMN     "ai_verification_status" VARCHAR(20);

