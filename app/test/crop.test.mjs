import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_IMAGE_BYTES, OUTPUT_SIZE, WORKING_SIZE,
  clampZoom, initialCrop, normalizeCrop, cropRect, panCrop, resizeDimensions,
} from '../src/crop.mjs';

function approximately(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('observed constants and finite zoom range', () => {
  assert.equal(MAX_IMAGE_BYTES, 25 * 1024 * 1024);
  assert.equal(OUTPUT_SIZE, 256);
  assert.equal(WORKING_SIZE, 1024);
  for (const input of [NaN, Infinity, -Infinity, undefined, null, '3', -20, 0]) {
    assert.equal(clampZoom(input), 1);
  }
  assert.equal(clampZoom(2.5), 2.5);
  assert.equal(clampZoom(99), 5);
});

test('landscape and portrait initialize to centered inscribed squares', () => {
  assert.deepEqual(initialCrop(1200, 800), { zoom: 1, centerX: 600, centerY: 400 });
  assert.deepEqual(cropRect(1200, 800, initialCrop(1200, 800)),
    { x: 200, y: 0, width: 800, height: 800 });
  assert.deepEqual(cropRect(800, 1200, initialCrop(800, 1200)),
    { x: 0, y: 200, width: 800, height: 800 });
});

test('zoom and center clamp at both edges without changing the supplied object', () => {
  const source = { zoom: 99, centerX: -400, centerY: 5000 };
  const before = { ...source };
  assert.deepEqual(normalizeCrop(1200, 800, source),
    { zoom: 5, centerX: 80, centerY: 720 });
  assert.deepEqual(cropRect(1200, 800, source),
    { x: 0, y: 640, width: 160, height: 160 });
  assert.deepEqual(source, before);
  assert.deepEqual(normalizeCrop(1200, 800, { centerX: NaN, centerY: Infinity }),
    initialCrop(1200, 800));
});

test('screen panning accounts for viewport scale and zoom, and stops at borders', () => {
  const state = { zoom: 2, centerX: 500, centerY: 400 };
  assert.deepEqual(panCrop(1000, 800, state, 30, -60, 300),
    { zoom: 2, centerX: 460, centerY: 480 });
  assert.deepEqual(panCrop(1000, 800, state, 1e6, -1e6, 300),
    { zoom: 2, centerX: 200, centerY: 600 });
  assert.deepEqual(panCrop(1000, 800, state, 0, 0, 300), state);
});

test('working dimensions preserve orientation and round without upscaling', () => {
  assert.deepEqual(resizeDimensions(4000, 3000), { width: 1024, height: 768 });
  assert.deepEqual(resizeDimensions(3000, 4000), { width: 768, height: 1024 });
  assert.deepEqual(resizeDimensions(333, 222), { width: 333, height: 222 });
  assert.deepEqual(resizeDimensions(100000, 1), { width: 1024, height: 1 });
});

test('invalid dimensions and invalid drag inputs fail explicitly', () => {
  for (const bad of [0, -1, NaN, Infinity, undefined, '100']) {
    for (const pair of [[bad, 100], [100, bad]]) {
      for (const fn of [initialCrop, resizeDimensions, normalizeCrop, cropRect]) {
        assert.throws(() => fn(...pair), RangeError);
      }
    }
  }
  for (const args of [[NaN, 0, 300], [0, Infinity, 300], [0, 0, 0], [0, 0, -1]]) {
    assert.throws(() => panCrop(100, 100, initialCrop(100, 100), ...args), RangeError);
  }
});

test('5000 seeded cases match an independent rectangle formulation and stay in bounds', () => {
  let seed = 0x6a726f6b;
  const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  for (let i = 0; i < 5000; i++) {
    const width = 1 + Math.floor(random() * 16000);
    const height = 1 + Math.floor(random() * 16000);
    const zoom = random() * 12 - 3;
    const state = {
      zoom,
      centerX: (random() * 3 - 1) * width,
      centerY: (random() * 3 - 1) * height,
    };
    // The reference limits the rectangle origin rather than clamping its center.
    const effectiveZoom = zoom < 1 ? 1 : zoom > 5 ? 5 : zoom;
    const side = (width < height ? width : height) / effectiveZoom;
    const expectedX = Math.min(width - side, Math.max(0, state.centerX - side / 2));
    const expectedY = Math.min(height - side, Math.max(0, state.centerY - side / 2));
    const result = cropRect(width, height, state);
    approximately(result.x, expectedX);
    approximately(result.y, expectedY);
    approximately(result.width, side);
    approximately(result.height, side);
    assert.ok(result.x >= -1e-8 && result.y >= -1e-8);
    assert.ok(result.x + side <= width + 1e-8 && result.y + side <= height + 1e-8);
    const normalized = normalizeCrop(width, height, state);
    assert.deepEqual(normalizeCrop(width, height, normalized), normalized);
    const working = resizeDimensions(width, height);
    assert.ok(working.width >= 1 && working.height >= 1);
    assert.ok(working.width <= 1024 && working.height <= 1024);
  }
});
