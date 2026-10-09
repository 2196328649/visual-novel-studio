import { chapterSource } from './chapter';

const ripple = chapterSource.shaders.ripple;
/** Value-noise layers and diagonal UV displacement from the original Ripple DXBC. */
export const chapterRippleShader = `
float vn_ripple_hash(vec2 p) {
    return fract(sin(dot(p, vec2(${ripple.hash[0]}, ${ripple.hash[1]}))) * ${ripple.hash[2]});
}
float vn_ripple_noise(vec2 uv) {
    vec2 p = floor(uv), f = fract(uv);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vn_ripple_hash(p), vn_ripple_hash(p + vec2(1.0, 0.0)), f.x),
               mix(vn_ripple_hash(p + vec2(0.0, 1.0)), vn_ripple_hash(p + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 vn_ripple_uv(vec2 uv, float time, float strength, float speed) {
    vec2 p = vec2(uv.x, 1.0 - uv.y) + time * speed;
    float n = ${ripple.noiseScales.map((scale, index) => `vn_ripple_noise(p * ${scale}) * ${ripple.noiseWeights[index]}`).join(' + ')};
    float offset = (n * 2.0 - 1.0) * strength;
    return clamp(uv + vec2(offset, -offset), 0.0, 1.0);
}`;

export function chapterRippleOffset(u: number, v: number, seconds: number, strength = ripple.strength, speed = ripple.speed) {
  const fract = (value: number) => value - Math.floor(value);
  const hash = (x: number, y: number) => fract(Math.sin(x * ripple.hash[0] + y * ripple.hash[1]) * ripple.hash[2]);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = fract(x), fy = fract(y);
    return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx * fx * (3 - 2 * fx)), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx * fx * (3 - 2 * fx)), fy * fy * (3 - 2 * fy));
  };
  const n = ripple.noiseScales.reduce((sum, scale, index) => sum + noise((u + seconds * speed) * scale, (1 - v + seconds * speed) * scale) * ripple.noiseWeights[index], 0);
  return (n * 2 - 1) * strength;
}
