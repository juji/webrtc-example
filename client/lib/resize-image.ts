import imageCompression from "browser-image-compression";

const MAX_DIMENSION_PX = 1920;

export async function resizeImage(file: File): Promise<File> {
  return imageCompression(file, { maxWidthOrHeight: MAX_DIMENSION_PX, useWebWorker: true });
}
