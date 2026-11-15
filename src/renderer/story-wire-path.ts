export interface StoryWireBounds { x: number; y: number; width: number; height: number }
/** Route backwards and self links above their endpoint cards using smooth cubic segments. */
export function storyReturnWirePath(sx: number, sy: number, tx: number, ty: number, source: StoryWireBounds, target: StoryWireBounds, lane = 0): [string, number, number] {
  const top = Math.min(source.y, target.y) - 42 - lane * 20;
  const right = Math.max(sx, source.x + source.width) + 36 + lane * 8;
  const left = Math.min(tx, target.x) - 36 - lane * 8;
  const radius = 16;
  const parts = [
    `M${sx},${sy}`,
    `C${sx + 18},${sy} ${right},${sy} ${right},${sy - radius}`,
    `C${right},${sy - radius} ${right},${top + radius} ${right},${top + radius}`,
    `C${right},${top + 5} ${right - 5},${top} ${right - radius},${top}`,
    `C${right - radius},${top} ${left + radius},${top} ${left + radius},${top}`,
    `C${left + 5},${top} ${left},${top + 5} ${left},${top + radius}`,
    `C${left},${top + radius} ${left},${ty - radius} ${left},${ty - radius}`,
    `C${left},${ty} ${tx - 18},${ty} ${tx},${ty}`,
  ];
  return [parts.join(' '), (left + right) / 2, top];
}
