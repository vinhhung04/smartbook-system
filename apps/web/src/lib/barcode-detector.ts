/**
 * Pluggable barcode/QR detection from a live <video> frame, used by the Packing
 * camera panel's auto-scan mode. Currently backed by the native BarcodeDetector
 * Web API (Chrome/Edge). Swap the implementation inside this function to plug in
 * a different recognition engine (AI model, zxing, ...) later — callers never change.
 */

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

interface NativeBarcodeDetectorCtor {
  new (options: { formats: string[] }): NativeBarcodeDetector;
}

const SUPPORTED_FORMATS = ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"];

let cachedDetector: NativeBarcodeDetector | null = null;

function getDetectorCtor(): NativeBarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorCtor }).BarcodeDetector || null;
}

export function isBarcodeDetectionSupported(): boolean {
  return getDetectorCtor() !== null;
}

export async function detectBarcodeFromVideoFrame(video: HTMLVideoElement): Promise<string | null> {
  const Ctor = getDetectorCtor();
  if (!Ctor || video.readyState < 2) return null;

  try {
    if (!cachedDetector) {
      cachedDetector = new Ctor({ formats: SUPPORTED_FORMATS });
    }
    const results = await cachedDetector.detect(video);
    return results[0]?.rawValue || null;
  } catch {
    return null;
  }
}
