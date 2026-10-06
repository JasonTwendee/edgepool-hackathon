import { useState } from 'react';

/**
 * Wallet avatar: real image when available, otherwise a deterministic gradient
 * derived from the address (stable per wallet, no network needed).
 */
function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 60) % 360;
  return `linear-gradient(135deg, hsl(${h} 60% 32%), hsl(${h2} 65% 22%))`;
}

export function WalletAvatar({
  label,
  avatarUrl,
  address,
  size = 'md',
}: {
  label: string;
  avatarUrl?: string;
  address?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  const dims =
    size === 'lg' ? 'w-14 h-14 text-2xl' : size === 'sm' ? 'w-8 h-8 text-sm' : 'w-10 h-10 text-base';
  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        onError={() => setBroken(true)}
        className={`shrink-0 rounded-full object-cover border border-[#3F424D] ${dims}`}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className={`shrink-0 rounded-full flex items-center justify-center font-display font-medium text-[#E9E9ED] ${dims}`}
      style={{ background: gradientFor(address ?? label) }}
    >
      {(label || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}
