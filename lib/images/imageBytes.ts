/**
 * 이미지 바이트 판별. 확장자나 공급자가 붙인 media_type 을 믿지 않고 파일 머리로 판단한다.
 * 가로·세로는 실제 파일에서 읽는다. 읽지 못하면 null 이다 (추정값을 만들지 않는다).
 */

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export const EXT_BY_MEDIA: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export const MEDIA_BY_EXT: Record<string, ImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function sniffMediaType(b: Uint8Array): ImageMediaType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return null;
}

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const type = sniffMediaType(b);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (type === "image/png") {
      // IHDR: 8바이트 시그니처 + 4 길이 + 4 "IHDR" 뒤에 width, height (big endian)
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        // SOF0..SOF15 (DHT C4, JPG C8, DAC CC 제외)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        }
        const len = view.getUint16(i + 2);
        i += 2 + len;
      }
      return null;
    }
    if (type === "image/webp") {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === "VP8X") {
        const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
        const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
        return { width: w, height: h };
      }
      if (chunk === "VP8 ") {
        return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function toDataUrl(bytes: Uint8Array, mediaType: ImageMediaType): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}
