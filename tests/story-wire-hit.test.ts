import assert from 'node:assert/strict';
import test from 'node:test';
import { nearestRenderedWire, storyWireAtPointer, type RenderedWireCandidate } from '../src/renderer/story-wire-hit';
import { storyReturnWirePath } from '../src/renderer/story-wire-path';

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const wire = (id: string, path: string, transform = identity): RenderedWireCandidate => ({ id, path, transform });
const upper = 'M0,0 C120,0 120,60 240,60';
const lower = 'M0,8 C120,8 120,60 240,60';

test('parallel group outputs can both be selected even when the other transparent hit area is above them', () => {
  const candidates = [wire('lower', lower), wire('upper', upper)];
  assert.equal(nearestRenderedWire({ x: 120, y: 30 }, candidates, 'lower'), 'upper');
  assert.equal(nearestRenderedWire({ x: 120, y: 34 }, candidates, 'upper'), 'lower');
  assert.equal(nearestRenderedWire({ x: 120, y: 30 }, [...candidates].reverse(), 'lower'), 'upper');
});

test('hit distance follows actual screen transforms at zoomed-out and zoomed-in viewports', () => {
  for (const scale of [.1, .27, 1, 1.6]) {
    const transform = { a: scale, b: 0, c: 0, d: scale, e: -1300, f: 640 };
    const candidates = [wire('lower', lower, transform), wire('upper', upper, transform)];
    assert.equal(nearestRenderedWire({ x: -1300 + 120 * scale, y: 640 + 30 * scale }, candidates, 'lower'), 'upper');
    assert.equal(nearestRenderedWire({ x: -1300 + 120 * scale, y: 640 + 34 * scale }, candidates, 'upper'), 'lower');
  }
  const rotated = { a: 0, b: .5, c: -.5, d: 0, e: 800, f: 200 };
  assert.equal(nearestRenderedWire({ x: 785, y: 260 }, [wire('lower', lower, rotated), wire('upper', upper, rotated)], 'lower'), 'upper');
});

test('curved lines are selected by their drawn curve, not their bounding box or endpoint chord', () => {
  const arch = wire('arch', 'M0,0 C0,100 100,100 100,0');
  const horizontal = wire('horizontal', 'M0,50 C30,50 70,50 100,50');
  assert.equal(nearestRenderedWire({ x: 50, y: 75 }, [horizontal, arch], 'horizontal'), 'arch');
  assert.equal(nearestRenderedWire({ x: 50, y: 50 }, [arch, horizontal], 'arch'), 'horizontal');
});

test('return routes use all cubic segments after the initial move', () => {
  const [path, x, y] = storyReturnWirePath(280, 100, 20, 80, { x: 40, y: 40, width: 240, height: 120 }, { x: 20, y: 30, width: 200, height: 100 }, 1);
  const nearby = wire('nearby', `M${x - 100},${y + 3} C${x - 30},${y + 3} ${x + 30},${y + 3} ${x + 100},${y + 3}`);
  assert.equal(nearestRenderedWire({ x, y }, [nearby, wire('return', path)], 'nearby'), 'return');
});

test('zero-length segments, closed loops and collinear overshoots remain valid geometry', () => {
  assert.equal(nearestRenderedWire({ x: 10, y: 20 }, [wire('nearby', 'M0,22 C7,22 13,22 20,22'), wire('point', 'M10,20 C10,20 10,20 10,20')], 'nearby'), 'point');
  assert.equal(nearestRenderedWire({ x: 0, y: 75 }, [wire('nearby', 'M-100,70 C-50,70 50,70 100,70'), wire('loop', 'M0,0 C100,100 -100,100 0,0')], 'nearby'), 'loop');
  assert.equal(nearestRenderedWire({ x: 150, y: 0 }, [wire('nearby', 'M0,2 C60,2 120,2 180,2'), wire('overshoot', 'M0,0 C200,0 200,0 0,0')], 'nearby'), 'overshoot');
});

test('crossings and visually indistinguishable overlaps keep the native hit predictably', () => {
  const crossed = [wire('rising', 'M0,0 C30,30 70,70 100,100'), wire('falling', 'M0,100 C30,70 70,30 100,0')];
  assert.equal(nearestRenderedWire({ x: 50, y: 50 }, crossed, 'rising'), 'rising');
  assert.equal(nearestRenderedWire({ x: 50, y: 50 }, crossed, 'falling'), 'falling');
  const almostSame = [wire('front', 'M0,0.1 C30,0.1 70,0.1 100,0.1'), wire('back', 'M0,0 C30,0 70,0 100,0')];
  assert.equal(nearestRenderedWire({ x: 50, y: 0 }, almostSame, 'front'), 'front');
});

test('invalid, unsupported or excessive geometry falls back without changing selection', () => {
  const native = wire('native', lower), candidate = wire('candidate', upper), point = { x: 120, y: 30 };
  assert.equal(nearestRenderedWire(point, [native, wire('invalid', 'MNaN,0 C1,0 2,0 3,0')], 'native'), 'native');
  assert.equal(nearestRenderedWire(point, [native, wire('unsupported', 'M0,0 A1,1 0 0 0 10,10')], 'native'), 'native');
  assert.equal(nearestRenderedWire(point, [native, { ...candidate, transform: { ...identity, a: Infinity } }], 'native'), 'native');
  assert.equal(nearestRenderedWire({ x: NaN, y: 30 }, [native, candidate], 'native'), 'native');
  assert.equal(nearestRenderedWire(point, [candidate], 'native'), 'native');
  assert.equal(nearestRenderedWire(point, [native, ...Array.from({ length: 64 }, (_, i) => wire('candidate' + i, upper))], 'native'), 'native');
  assert.equal(nearestRenderedWire(point, [native, wire('many-segments', 'M0,0 ' + 'C1,0 2,0 3,0 '.repeat(64))], 'native'), 'native');
});

test('integer click coordinates can omit the original event target from the live hit list', t => {
  // A minimal document boundary models the browser's 28 px transparent strokes.
  // The native target was chosen at a fractional pointer coordinate, while click
  // exposes its integer coordinate. No saved pointer position is given to the resolver.
  class EdgeElement extends EventTarget {
    selectable = true;
    excluded = false;
    constructor(readonly id: string, readonly x: number) { super(); }
    closest(selector: string) {
      if (selector.includes(',')) return this.excluded ? this : null;
      return selector === '.react-flow__edge' || selector === '.react-flow__edge.selectable' && this.selectable ? this : null;
    }
    getAttribute(name: string) { return name === 'data-id' ? this.id : null; }
    querySelector() {
      return { getAttribute: () => `M${this.x},0 C${this.x},330 ${this.x},670 ${this.x},1000`, getScreenCTM: () => identity };
    }
  }
  const originalElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { configurable: true, value: EdgeElement });
  t.after(() => { if (originalElement) Object.defineProperty(globalThis, 'Element', originalElement); else Reflect.deleteProperty(globalThis, 'Element'); });
  const native = new EdgeElement('native', 234.2), intended = new EdgeElement('intended', 220.8);
  const document = { elementsFromPoint: (x: number) => [native, intended].filter(edge => Math.abs(x - edge.x) <= 14) };
  const root = { contains: (element: unknown) => element === native || element === intended, ownerDocument: document } as unknown as HTMLElement;
  assert.deepEqual(document.elementsFromPoint(220.8).map(edge => edge.id), ['native', 'intended']);
  assert.deepEqual(document.elementsFromPoint(220).map(edge => edge.id), ['intended']);
  const event = { clientX: 220, clientY: 448, target: native };
  assert.equal(storyWireAtPointer(root, event, 'native'), 'intended');

  // Only the actual selectable event edge from this canvas may supplement hits.
  assert.equal(storyWireAtPointer(root, event, 'different-id'), 'different-id');
  const otherRoot = { ...root, contains: (element: unknown) => element === intended } as unknown as HTMLElement;
  assert.equal(storyWireAtPointer(otherRoot, event, 'native'), 'native');
  native.selectable = false;
  assert.equal(storyWireAtPointer(root, event, 'native'), 'native');
  native.selectable = true; native.excluded = true;
  assert.equal(storyWireAtPointer(root, event, 'native'), 'native');
});
