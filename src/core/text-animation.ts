import { textEasings, textOrders, type TextAnimation, type TextPresentationStyle } from './model';

type Named = Exclude<TextPresentationStyle['entrance'], 'none' | undefined>;

export const textEasingNames: Record<typeof textEasings[number], string> = { linear: '匀速', easeOut: '先快后慢', easeIn: '先慢后快', easeInOut: '缓入缓出', back: '回弹', bounce: '弹跳', elastic: '弹簧' };
export const textOrderNames: Record<typeof textOrders[number], string> = { forward: '从左到右', reverse: '从右到左', center: '从中间向两边', edges: '从两边向中间', random: '随机' };

/** The state a character animates from (entrance) or to (exit). Unset fields mean "as displayed". */
export type FullTextAnimation = Required<TextAnimation>;
const plain: FullTextAnimation = { x: 0, y: 0, scale: 1, flip: false, rotation: 0, opacity: 0, easing: 'linear', order: 'forward' };

/** Every named effect is just these settings, so authors can start from one and adjust it. */
export const entranceAnimations: Record<Named, TextAnimation> = { fade: {}, zoom: { scale: 0 }, slam: { scale: 2.5 }, flip: { flip: true }, drop: { y: -36, easing: 'easeOut' }, rise: { y: 36, easing: 'easeOut' } };
export const exitAnimations: Record<Named, TextAnimation> = { fade: {}, zoom: { scale: 0 }, slam: { scale: 2.5 }, flip: { flip: true }, drop: { y: 36, easing: 'easeIn' }, rise: { y: -36, easing: 'easeIn' } };

export const fullAnimation = (table: Record<Named, TextAnimation>, name: Named, own?: TextAnimation): FullTextAnimation => {
  const result = { ...plain, ...table[name] };
  for (const [key, value] of Object.entries(own ?? {})) if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  return result;
};

const number = (value: number) => String(+value.toFixed(4));
/** The form the game's shader reads: x, y, scaleX, scaleY, radians, opacity, seconds, easing, order. */
export function animationSpec(animation: FullTextAnimation, seconds: number) {
  return [animation.x, animation.y, animation.scale * (animation.flip ? -1 : 1), animation.scale, animation.rotation * Math.PI / 180, animation.opacity, seconds, textEasings.indexOf(animation.easing), textOrders.indexOf(animation.order)].map(number).join(',');
}

/** Progress 0..1 to eased progress; back and elastic overshoot past 1 on purpose. Mirrors the game's shader. */
export function applyEasing(easing: FullTextAnimation['easing'], t: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  switch (easing) {
    case 'easeOut': return 1 - (1 - t) ** 2;
    case 'easeIn': return t * t;
    case 'easeInOut': return t < .5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
    case 'back': return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    case 'bounce': {
      const n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) { const u = t - 1.5 / d; return n * u * u + .75; }
      if (t < 2.5 / d) { const u = t - 2.25 / d; return n * u * u + .9375; }
      const u = t - 2.625 / d; return n * u * u + .984375;
    }
    case 'elastic': return t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - .75) * 2 * Math.PI / 3) + 1;
    default: return t;
  }
}

/** Where a character falls in the sequence, 0..1, from its place in the line. */
export function orderPosition(order: FullTextAnimation['order'], place: number, index: number) {
  switch (order) {
    case 'reverse': return 1 - place;
    case 'center': return Math.abs(2 * place - 1);
    case 'edges': return 1 - Math.abs(2 * place - 1);
    case 'random': {
      // Integer intermediates stay below 2^24, so JavaScript, Python and the
      // game's single-precision shader choose exactly the same sequence.
      const value = (Math.floor(index) % 4093 * 109 + 37) % 4093;
      return (value * value + 17) % 4093 / 4093;
    }
    default: return place;
  }
}

/** A character `amount` of the way from its animated state (0) to normal (1). */
export function animationFrame(animation: FullTextAnimation, amount: number, scale: number) {
  const left = 1 - amount, parts: string[] = [];
  const dx = animation.x * left * scale, dy = animation.y * left * scale;
  if (dx || dy) parts.push(`translate(${dx}px, ${dy}px)`);
  if (animation.rotation) parts.push(`rotate(${animation.rotation * left}deg)`);
  const sx = animation.scale * (animation.flip ? -1 : 1) * left + amount, sy = animation.scale * left + amount;
  if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`);
  return { opacity: Math.max(0, Math.min(1, animation.opacity * left + amount)), transform: parts.join(' ') || undefined };
}
