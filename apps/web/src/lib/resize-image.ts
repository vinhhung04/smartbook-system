// Gateway caps request bodies at 8MB (GATEWAY_MAX_REQUEST_BYTES); an original
// phone photo can exceed that on its own. Resizing client-side also keeps
// OCR/CLIP inference fast regardless of the source camera's resolution.
// Shared by customer/scan-cover.tsx and the staff cover-search modal.
const MAX_DIMENSION_PX = 1024;
const JPEG_QUALITY = 0.8;

export function resizeImageFile(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được file ảnh'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Không đọc được file ảnh'));
      image.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh'));
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Không nén được ảnh'));
              return;
            }
            resolve(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
          },
          'image/jpeg',
          JPEG_QUALITY,
        );
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
