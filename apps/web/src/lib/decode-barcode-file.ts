// Decodes the EAN-13 barcode in a still photo (the back cover) with the same
// html5-qrcode engine BarcodeScanModal uses, loaded only when needed. The
// result is sent with the OCR scan as an independent, deterministic reading:
// the server checks it is an ISBN (978/979 + checksum) before using it, so a
// retail 893... code can never become the ISBN. Any failure just means "no barcode".
let sequence = 0;

export async function decodeBarcodeFromFile(file: File): Promise<string | null> {
  const elementId = `ocr-barcode-decoder-${++sequence}`;
  const host = document.createElement('div');
  host.id = elementId;
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
  document.body.appendChild(host);
  try {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
    const scanner = new Html5Qrcode(elementId, {
      formatsToSupport: [Html5QrcodeSupportedFormats.EAN_13],
      verbose: false,
    });
    try {
      const result = await scanner.scanFileV2(file, false);
      const digits = result.decodedText.replace(/\D/g, '');
      return digits.length === 13 ? digits : null;
    } finally {
      scanner.clear();
    }
  } catch {
    return null;
  } finally {
    host.remove();
  }
}
