import { useState } from 'react';

/**
 * Wallet avatar: real image when available, otherwise the Edgepool initial
 * pattern (violet-tinted basin + light violet letter, Inter Tight).
 */
export function WalletAvatar({
  label,
  avatarUrl,
  size = 'md',
}: {
  label: string;
  avatarUrl?: string;
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
      className={`shrink-0 rounded-full bg-[#2B2741] flex items-center justify-center font-display font-medium text-[#D2CEFD] ${dims}`}
    >
      {(label || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}
