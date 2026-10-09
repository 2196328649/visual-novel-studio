/** Adaptive foregrounds have a 108-unit canvas, a 72-unit mask and a 66-unit safe circle. */
export function androidIconLayout(scale = 1) {
  const canvas = 432, mask = 288, safeDiameter = 264;
  const content = Math.floor(safeDiameter / Math.SQRT2 * Math.max(.1, Math.min(2, scale)));
  return { canvas, mask, safeDiameter, inset: Math.ceil((canvas - content) / 2) };
}
