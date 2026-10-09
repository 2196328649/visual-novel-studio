/** Display-only classification; it never parses or changes the script. */
export function textLineColor(line: string): { kind: 'heading' | 'command' | 'speaker' | 'comment' | 'plain'; speaker?: string; hue?: number } {
  if (/^\s*(?:\/\/|;)/.test(line)) return { kind: 'comment' };
  if (/^\s*#/.test(line)) return { kind: 'heading' };
  if (/^\s*[@／/]/.test(line)) return { kind: 'command' };
  const speaker = line.match(/^\s*([^:：]{1,80})[:：]/)?.[1].replace(/【[^】]*】/g, '').trim();
  if (!speaker) return { kind: 'plain' };
  let hash = 2166136261;
  for (const char of speaker.normalize('NFC')) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
  return { kind: 'speaker', speaker, hue: (hash >>> 0) % 360 };
}
