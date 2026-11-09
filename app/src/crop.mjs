/** Independent implementation of the observed avatar crop geometry. */
export const MAX_IMAGE_BYTES = 26_214_400;
export const OUTPUT_SIZE = 256;
export const WORKING_SIZE = 1024;

function requireDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Image dimensions must be positive finite numbers.');
  }
}

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.max(1, Math.min(5, zoom));
}

export function initialCrop(width, height) {
  requireDimensions(width, height);
  return { zoom: 1, centerX: width / 2, centerY: height / 2 };
}

export function normalizeCrop(width, height, crop = {}) {
  requireDimensions(width, height);
  const zoom = clampZoom(crop?.zoom);
  const halfSide = Math.min(width, height) / zoom / 2;
  const centerX = Number.isFinite(crop?.centerX) ? crop.centerX : width / 2;
  const centerY = Number.isFinite(crop?.centerY) ? crop.centerY : height / 2;
  return {
    zoom,
    centerX: Math.max(halfSide, Math.min(width - halfSide, centerX)),
    centerY: Math.max(halfSide, Math.min(height - halfSide, centerY)),
  };
}

export function cropRect(width, height, crop) {
  const state = normalizeCrop(width, height, crop);
  const side = Math.min(width, height) / state.zoom;
  return {
    x: state.centerX - side / 2,
    y: state.centerY - side / 2,
    width: side,
    height: side,
  };
}

/** Dragging the image right moves the selected source center left. */
export function panCrop(width, height, crop, dx, dy, viewportSize) {
  const state = normalizeCrop(width, height, crop);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(viewportSize) || viewportSize <= 0) {
    throw new RangeError('Drag offsets must be finite and the viewport must be positive.');
  }
  const sourceUnitsPerPixel = Math.min(width, height) / state.zoom / viewportSize;
  return normalizeCrop(width, height, {
    zoom: state.zoom,
    centerX: state.centerX - dx * sourceUnitsPerPixel,
    centerY: state.centerY - dy * sourceUnitsPerPixel,
  });
}

/** Bound decoding/canvas work without enlarging already-small images. */
export function resizeDimensions(width, height) {
  requireDimensions(width, height);
  const scale = Math.min(1, WORKING_SIZE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
