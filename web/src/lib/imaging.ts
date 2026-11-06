import "server-only";
import sharp from "sharp";
import type { Box } from "./types";

/** Single-channel 0/255 mask at the photo's size. */
export async function normalizeMask(mask: Buffer, width: number, height: number) {
  return sharp(mask)
    .resize(width, height, { fit: "fill" })
    .flatten({ background: "#000" })
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer();
}

/** Tight bounding box of white pixels and the fraction of the image they cover. */
export async function maskStats(mask: Buffer): Promise<{ bbox: Box; coverage: number } | null> {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let x0 = width, y0 = height, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > 127) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (count === 0) return null;
  return {
    bbox: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height },
    coverage: count / (width * height),
  };
}

/**
 * Object on transparent background, cropped to a padded square — the input
 * image-to-3D models expect.
 */
export async function makeCutout(photo: Buffer, mask: Buffer, bbox: Box, size = 1024) {
  const { width, height } = await sharp(photo).metadata();
  const W = width!, H = height!;
  const cut = await sharp(photo)
    .removeAlpha()
    .joinChannel(await sharp(mask).greyscale().toBuffer())
    .png()
    .toBuffer();

  const bw = (bbox.x1 - bbox.x0) * W;
  const bh = (bbox.y1 - bbox.y0) * H;
  const side = Math.ceil(Math.max(bw, bh) * 1.15);
  const cx = ((bbox.x0 + bbox.x1) / 2) * W;
  const cy = ((bbox.y0 + bbox.y1) / 2) * H;
  const left = Math.round(cx - side / 2);
  const top = Math.round(cy - side / 2);

  // Pad first so the square crop can extend past the photo edges. Separate
  // pipelines because sharp runs extract before extend within one pipeline.
  const pad = side;
  const padded = await sharp(cut)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp(padded)
    .extract({ left: left + pad, top: top + pad, width: side, height: side })
    .resize(size, size)
    .png()
    .toBuffer();
}

/** Grow the mask by roughly `px` so inpainting also covers edges and contact shadow. */
export async function dilateMask(mask: Buffer, px: number) {
  return sharp(mask).greyscale().blur(Math.max(0.3, px / 2)).threshold(8).png().toBuffer();
}

/** Grow the mask downward too, where the contact shadow usually is. */
export async function shadowMask(mask: Buffer, bbox: Box, width: number, height: number) {
  const grown = await dilateMask(mask, Math.round(Math.max(width, height) * 0.02));
  const bw = (bbox.x1 - bbox.x0) * width;
  const bh = (bbox.y1 - bbox.y0) * height;
  // Ellipse under the object's base.
  const ellipse = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="${((bbox.x0 + bbox.x1) / 2) * width}" cy="${bbox.y1 * height}"
        rx="${bw * 0.62}" ry="${Math.max(bh * 0.12, 8)}" fill="#fff"/>
    </svg>`,
  );
  return sharp(grown)
    .composite([{ input: ellipse, blend: "lighten" }])
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer();
}

/** Paste the inpainted pixels back only inside the mask so the rest of the photo stays byte-identical. */
export async function compositeInside(photo: Buffer, filled: Buffer, mask: Buffer) {
  const { width, height } = await sharp(photo).metadata();
  const soft = await sharp(mask).greyscale().blur(3).toBuffer();
  const filledMasked = await sharp(filled)
    .resize(width!, height!, { fit: "fill" })
    .removeAlpha()
    .joinChannel(await sharp(soft).resize(width!, height!).toBuffer())
    .png()
    .toBuffer();
  return sharp(photo).composite([{ input: filledMasked }]).png().toBuffer();
}
