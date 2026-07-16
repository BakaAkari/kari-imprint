export type LocalPreview = {
  bitmap: ImageBitmap;
};

/**
 * Build a bounded browser-side proxy while keeping the original File untouched.
 * The first decode constrains width; portrait images are constrained by height
 * in a second bounded bitmap operation. No full-resolution canvas is created.
 */
export async function createLocalPreview(file: File, maxEdge: number): Promise<LocalPreview> {
  if (maxEdge <= 0) throw new Error('Invalid preview max edge');

  let bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: maxEdge,
    resizeQuality: 'high',
  });

  if (bitmap.height > maxEdge) {
    const portraitBitmap = await createImageBitmap(bitmap, {
      resizeHeight: maxEdge,
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = portraitBitmap;
  }

  return { bitmap };
}
