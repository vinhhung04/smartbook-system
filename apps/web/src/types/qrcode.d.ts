declare module 'qrcode' {
  interface QRCodeToCanvasOptions {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
    color?: {
      dark?: string;
      light?: string;
    };
  }

  function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRCodeToCanvasOptions,
  ): Promise<void>;

  const QRCode: {
    toCanvas: typeof toCanvas;
  };

  export default QRCode;
}
