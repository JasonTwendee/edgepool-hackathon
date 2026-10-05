import { useEffect, useRef, useState } from 'react';
import { Bell } from '@phosphor-icons/react';
import type { OnChainTransactionEvent } from '../types/onchain';
import { formatUsd, timeAgo } from '../lib/format';

export interface AppNotification {
  id: string;
  event: OnChainTransactionEvent;
  receivedAt: number;
  read: boolean;
}

interface Props {
  notifications: AppNotification[];
  onSelectWallet: (address: string) => void;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
}

export function NotificationsBell({ notifications, onSelectWallet, onMarkAllRead, onMarkRead }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) onMarkAllRead();
        }}
        title="Notifications"
        className="relative p-2 rounded-lg hover:bg-[rgba(233,233,237,0.07)] text-[#9397AB] hover:text-[#E9E9ED] transition-colors"
      >
        <Bell size={16} className="" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#49E6D7] text-[#0D0F18] text-[10px] font-extrabold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[85vw] rounded-[14px] border border-[#3F424D] bg-[#232532] shadow-2xl shadow-black/60 overflow-hidden z-50">
          <div className="px-4 py-2.5 border-b border-[#3F424D]/80 flex items-center justify-between">
            <span className="text-xs font-bold text-[#E9E9ED]">Live trade alerts</span>
            <span className="text-[11px] text-[#75798C]">{notifications.length} recent</span>
          </div>
          <ul className="max-h-[380px] overflow-y-auto divide-y divide-[#3F424D]/60">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => {
                    onMarkRead(n.id);
                    onSelectWallet(n.event.wallet);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 hover:bg-[rgba(233,233,237,0.07)] transition-colors flex items-center gap-2.5 ${
                    n.read ? 'opacity-70' : ''
                  }`}
                >
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[#49E6D7] shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#E9E9ED]">
                      <span className={`font-extrabold ${n.event.action === 'SELL' ? 'text-[#F28881]' : 'text-[#73DEA4]'}`}>
                        {n.event.action} {n.event.symbol}
                      </span>{' '}
                      <span className="font-bold">{formatUsd(n.event.amountUsd)}</span>
                    </div>
                    <div className="text-[11px] text-[#75798C] truncate">
                      {n.event.walletName ?? n.event.wallet} · {timeAgo(n.event.blockTime, n.receivedAt / 1000)}
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-[#75798C]">
                No alerts yet — new swaps will appear here live
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
