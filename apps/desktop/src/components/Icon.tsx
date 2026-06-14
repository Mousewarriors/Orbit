import type { IconSource } from '@orbit/shared-types';

/** Stable colour from a string, for letter-avatar fallbacks. */
function tintFor(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
}

const BUILTIN_GLYPH: Record<string, string> = {
  globe: '🌐',
  'refresh-cw': '⟳',
  power: '⏻',
  calculator: '🧮',
  search: '🔍',
  clipboard: '📋',
  layout: '▦',
};

export function Icon({
  source,
  label,
}: {
  source: IconSource | undefined;
  label: string;
}): JSX.Element {
  if (!source) {
    const text = label.slice(0, 1).toUpperCase();
    return (
      <span className="orbit-icon" style={{ background: tintFor(label) }}>
        {text}
      </span>
    );
  }
  switch (source.kind) {
    case 'emoji':
      return <span className="orbit-icon orbit-icon-plain">{source.glyph}</span>;
    case 'letter':
      return (
        <span className="orbit-icon" style={{ background: source.tint ?? tintFor(source.text) }}>
          {source.text.slice(0, 1).toUpperCase()}
        </span>
      );
    case 'builtin':
      return (
        <span className="orbit-icon orbit-icon-plain" aria-hidden>
          {BUILTIN_GLYPH[source.name] ?? '●'}
        </span>
      );
    case 'file':
    case 'url':
      return <img className="orbit-icon orbit-icon-img" src={source.kind === 'url' ? source.url : source.path} alt="" />;
    default:
      return <span className="orbit-icon orbit-icon-plain">●</span>;
  }
}
