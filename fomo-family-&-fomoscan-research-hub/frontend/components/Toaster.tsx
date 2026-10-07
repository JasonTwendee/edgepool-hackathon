'use client';

import { useEffect, useState } from 'react';

type Toast = { id: number; text: string };

let nextId = 1;
const listeners = new Set<(t: Toast) => void>();

/** Fire-and-forget toast (design: bottom-center, #032D2A bg, auto-hide 2.8s). */
export function toast(text: string): void {
  const t = { id: nextId++, text };
  listeners.forEach((cb) => {
    try {
      cb(t);
    } catch {
      // never break the caller
    }
  });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (t: Toast) => {
      setItems((prev) => [...prev.slice(-2), t]);
      setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      }, 2800);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] space-y-2 w-full px-4" style={{ maxWidth: 480 }}>
      {items.map((t) => (
        <div
          key={t.id}
          className="ep-fade text-center text-sm font-medium px-4 py-2.5 rounded-xl"
          style={{ background: 'var(--ep-aqua-deep, #032D2A)', color: 'var(--ep-aqua-100, #BBF6EE)', boxShadow: '0 0 0 1px var(--ep-aqua, #49E6D7)' }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
