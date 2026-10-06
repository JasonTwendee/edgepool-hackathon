'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { OnChainTransactionEvent, TrackedWallet } from '../../types/onchain';
import {
  clearSession,
  getAuthMe,
  getHoldings,
  getPnlOverview,
  getStoredToken,
  getWalletPnl,
  listWallets,
  logout as logoutRequest,
  updateWalletCopy,
  type SwapAction,
  type WalletHoldings,
  type WalletPnl,
} from '../../lib/api';
import type { FundSession } from '../../types/fund';
import { AdminPanel } from '../../components/AdminPanel';
import { LoginModal } from '../../components/LoginModal';
import { DemoBanner } from '../../components/DemoBanner';
import { useOnchainStream } from '../../hooks/useOnchainStream';
import { usePortfolio } from '../../hooks/usePortfolio';
import { timeAgo } from '../../lib/format';
import { NotificationsBell, type AppNotification } from '../../components/NotificationsBell';
import { rangeDays, TraderProfile, type RangeKey } from '../../components/TraderProfile';
import type { SwapsTab } from '../../components/SwapsTable';
import { FomoHeader } from '../../components/FomoHeader';
import { FomoLeftSidebar } from '../../components/FomoLeftSidebar';
import { FomoRightPanel } from '../../components/FomoRightPanel';
import { FomoBottomTicker } from '../../components/FomoBottomTicker';

const PAGE_SIZE = 25;

function tabToAction(tab: SwapsTab): SwapAction | undefined {
  return tab === 'all' ? undefined : tab === 'buys' ? 'BUY' : 'SELL';
}

export default function HomePage() {
  const [wallets, setWallets] = useState<TrackedWallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [walletsError, setWalletsError] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('30d');
  const [swapsTab, setSwapsTab] = useState<SwapsTab>('all');
  const [swapsPage, setSwapsPage] = useState(1);
  const [showZero, setShowZero] = useState(false);
  const [liveSwaps, setLiveSwaps] = useState<OnChainTransactionEvent[]>([]);
  const [followBusy, setFollowBusy] = useState(false);
  const [pnl, setPnl] = useState<WalletPnl | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlMap, setPnlMap] = useState<Record<string, WalletPnl>>({});
  const [holdings, setHoldings] = useState<WalletHoldings | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showRight, setShowRight] = useState(true);
  const [showTicker, setShowTicker] = useState(true);
  // Admin console (ADMIN only) toggled from the header avatar menu.
  const [showFund, setShowFund] = useState(false);
  const [session, setSession] = useState<FundSession | null>(null);
  // Gate is strict: no session = no app. Checked flag avoids flashing the
  // modal while a stored token is being validated against BE.
  const [sessionChecked, setSessionChecked] = useState(false);

  // Restore fund session (token in localStorage; validated against BE).
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setSessionChecked(true);
      return;
    }
    getAuthMe(token)
      .then((res) => setSession({ token, user: res.data, expiresAt: '' }))
      .catch(() => setSession(null))
      .finally(() => setSessionChecked(true));
  }, []);

  async function handleLogout() {
    try {
      await logoutRequest(session?.token);
    } catch {
      // BE logout is best-effort; always clear the local copy.
    }
    clearSession();
    setSession(null);
    setShowFund(false);
  }

  const days = rangeDays(range);
  const action = tabToAction(swapsTab);

  const refreshWallets = useCallback(async () => {
    try {
      const res = await listWallets();
      setWallets(res.data);
      setWalletsError(null);
      setSelectedAddress((prev) => {
        if (prev && res.data.some((w) => w.address === prev)) return prev;
        // Default to the top ACTIVE trader (dropped/inactive wallets keep history
        // but never become the landing view).
        const top = [...res.data].sort((a, b) => {
          const aa = (a.isActive ?? true) ? 0 : 1;
          const bb = (b.isActive ?? true) ? 0 : 1;
          if (aa !== bb) return aa - bb;
          return (b.totalPnlUsd ?? 0) - (a.totalPnlUsd ?? 0);
        })[0];
        return top ? top.address : null;
      });
    } catch (e) {
      setWalletsError((e as Error).message);
    } finally {
      setWalletsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshWallets();
  }, [refreshWallets, session]);

  const refreshPnlOverview = useCallback(async () => {
    try {
      const res = await getPnlOverview(120);
      const map: Record<string, WalletPnl> = {};
      for (const p of res.data) map[p.wallet] = p;
      setPnlMap(map);
    } catch {
      // overview is best-effort; sidebar falls back to seed values
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshPnlOverview();
    const timer = setInterval(() => void refreshPnlOverview(), 60000);
    return () => clearInterval(timer);
  }, [refreshPnlOverview, session]);

  const portfolio = usePortfolio({
    walletAddress: selectedAddress ?? 'ALL',
    page: swapsPage,
    pageSize: PAGE_SIZE,
    action,
    days,
    hideZero: !showZero,
    enabled: !!session,
  });

  // Chart fallback dataset (flow mode only): full range for the wallet.
  // Disabled whenever realized pairs exist — the chart then uses pnl.series
  // directly (zero extra fetch, full-range exact).
  const needFlow = !pnl || pnl.pairs === 0;
  const chartLedger = usePortfolio({
    walletAddress: selectedAddress ?? 'ALL',
    page: 1,
    pageSize: 1000,
    action,
    days,
    pollMs: 60000,
    enabled: !!session && needFlow,
    hideZero: !showZero,
  });

  // Non-urgent view changes (tab/page/range) run in a transition so the UI
  // never freezes while the next dataset parses + renders.
  const [viewPending, startViewTransition] = useTransition();

  // Throttled ledger refetch when live swaps arrive (SSE can burst).
  const lastAutoRefresh = useRef(0);
  const refreshLedger = portfolio.refresh;
  const refreshChart = chartLedger.refresh;
  const selectedRef = useRef(selectedAddress);
  selectedRef.current = selectedAddress;
  const maybeRefreshLedger = useCallback(() => {
    const now = Date.now();
    if (now - lastAutoRefresh.current < 5000) return;
    lastAutoRefresh.current = now;
    void refreshLedger();
    void refreshChart();
    // PnL overview intentionally excluded: it recomputes FIFO over the full
    // ledger per wallet and would jank the UI on every live event.
    // The 60s overview poll below picks it up.
    const addr = selectedRef.current;
    if (addr) {
      getHoldings(addr)
        .then((res) => setHoldings(res.data))
        .catch(() => undefined);
    }
  }, [refreshLedger, refreshChart, refreshPnlOverview]);

  useEffect(() => {
    setLiveSwaps([]);
    setSwapsPage(1);
    setPnl(null);
    if (!session) return;
    if (!selectedAddress) return;
    setPnlLoading(true);
    getWalletPnl(selectedAddress, days)
      .then((res) => setPnl(res.data))
      .catch(() => setPnl(null))
      .finally(() => setPnlLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddress, days, session]);

  useEffect(() => {
    setHoldings(null);
    if (!session) return;
    if (!selectedAddress) return;
    setHoldingsLoading(true);
    getHoldings(selectedAddress)
      .then((res) => setHoldings(res.data))
      .catch(() => setHoldings(null))
      .finally(() => setHoldingsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddress, session]);

  // App boot timestamp: live notifications/ledger prepends only apply to
  // transactions newer than this (older stream arrivals are backfill).
  const bootAt = useRef(Date.now());

  const handleLiveEvent = useCallback(
    (event: OnChainTransactionEvent) => {
      // Only fresh activity counts as "live": backfilled history arriving
      // through the stream must not spam notifications or the ledger.
      if (event.blockTime * 1000 < bootAt.current) return;      setNotifications((prev) =>
        prev.some((n) => n.id === event.signature)
          ? prev
          : [{ id: event.signature, event, receivedAt: Date.now(), read: false }, ...prev].slice(0, 30),
      );
      if (
        selectedAddress &&
        event.wallet === selectedAddress &&
        swapsPage === 1 &&
        (swapsTab === 'all' ||
          (swapsTab === 'buys' && event.action === 'BUY') ||
          (swapsTab === 'sells' && event.action === 'SELL'))
      ) {
        setLiveSwaps((prev) =>
          prev.some((s) => s.signature === event.signature)
            ? prev
            : [event, ...prev].slice(0, PAGE_SIZE),
        );
        maybeRefreshLedger();
      }
    },
    [selectedAddress, swapsPage, swapsTab, maybeRefreshLedger],
  );

  const markNotificationRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const { connected: liveConnected } = useOnchainStream(handleLiveEvent, !!session);

  const lastSyncSec = portfolio.updatedAt ? Math.floor(portfolio.updatedAt / 1000) : null;
  const syncLabel = liveConnected
    ? 'Live'
    : lastSyncSec
      ? `Synced ${timeAgo(lastSyncSec)} ago`
      : 'Connecting…';
  const syncOk = liveConnected || lastSyncSec !== null;

  const swaps = useMemo(() => {
    const seen = new Set<string>();
    const merged: OnChainTransactionEvent[] = [];
    for (const s of [...liveSwaps, ...portfolio.data]) {
      if (s.action !== 'BUY' && s.action !== 'SELL') continue;
      if (!seen.has(s.signature)) {
        seen.add(s.signature);
        merged.push(s);
      }
      if (merged.length >= PAGE_SIZE) break;
    }
    return merged;
  }, [liveSwaps, portfolio.data]);

  const chartSwaps = useMemo(() => {
    const seen = new Set<string>();
    const merged: OnChainTransactionEvent[] = [];
    for (const s of [...liveSwaps, ...chartLedger.data]) {
      if (s.action !== 'BUY' && s.action !== 'SELL') continue;
      if (!seen.has(s.signature)) {
        seen.add(s.signature);
        merged.push(s);
      }
    }
    return merged;
  }, [liveSwaps, chartLedger.data]);

  const selectedWallet = wallets.find((w) => w.address === selectedAddress) ?? null;
  const isAdmin = session?.user.role === 'ADMIN';

  function handleTabChange(tab: SwapsTab) {
    startViewTransition(() => {
      setSwapsTab(tab);
      setSwapsPage(1);
      setLiveSwaps([]);
    });
  }

  function handleRangeChange(r: RangeKey) {
    startViewTransition(() => {
      setRange(r);
      setSwapsPage(1);
      setLiveSwaps([]);
    });
  }

  function handlePageChange(p: number) {
    startViewTransition(() => {
      setSwapsPage(p);
    });
  }

  function handleToggleShowZero() {
    startViewTransition(() => {
      setShowZero((v) => !v);
      setSwapsPage(1);
      setLiveSwaps([]);
    });
  }

  async function handleToggleFollow() {
    if (!selectedWallet) return;
    setFollowBusy(true);
    try {
      await updateWalletCopy(selectedWallet.address, {
        isCopyEnabled: !selectedWallet.isCopyEnabled,
      });
      await refreshWallets();
    } catch (e) {
      setWalletsError((e as Error).message);
    } finally {
      setFollowBusy(false);
    }
  }

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden w-screen bg-[#161826] text-[#E9E9ED] flex flex-col">
      <FomoHeader
        wallets={wallets}
        pnlMap={pnlMap}
        onSelectWallet={setSelectedAddress}
        cryptoValueUsd={holdings?.totalValueUsd ?? null}
        liveConnected={liveConnected}
        session={session}
        isAdmin={isAdmin}
        showAdmin={showFund}
        onToggleAdmin={() => setShowFund((v) => !v)}
        onLogout={() => void handleLogout()}
        bell={
          <NotificationsBell
            notifications={notifications}
            onSelectWallet={setSelectedAddress}
            onMarkAllRead={markAllNotificationsRead}
            onMarkRead={markNotificationRead}
          />
        }
      />

      <DemoBanner />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        <FomoLeftSidebar
          wallets={wallets}
          pnlMap={pnlMap}
          selectedAddress={selectedAddress}
          onSelect={setSelectedAddress}
          loading={walletsLoading}
          isAdmin={isAdmin}
          showRight={showRight}
          showTicker={showTicker}
          onToggleRight={() => setShowRight((v) => !v)}
          onToggleTicker={() => setShowTicker((v) => !v)}
        />

        <main className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto scrollbar-thin">
          <div className="p-5 space-y-4 max-w-7xl w-full mx-auto">
            {isAdmin && showFund && <AdminPanel session={session} />}
            {walletsError && (
              <div className="text-xs text-[#F28881] bg-[rgba(242,136,129,0.08)] border border-[#F28881]/30 rounded-lg px-3 py-2">
                {walletsError}
              </div>
            )}
            {portfolio.error && (
              <div className="text-xs text-[#F28881] bg-[rgba(242,136,129,0.08)] border border-[#F28881]/30 rounded-lg px-3 py-2">
                {portfolio.error}{' '}
                <button onClick={() => void portfolio.refresh()} className="underline font-bold">
                  Retry
                </button>
              </div>
            )}
            {!walletsLoading && !selectedWallet ? (
              <div className="text-sm text-[#75798C] py-16 text-center">
                No wallets tracked yet — add one from the sidebar.
              </div>
            ) : selectedWallet ? (
              <TraderProfile
                wallet={selectedWallet}
                swaps={chartSwaps}
                tableSwaps={swaps}
                pnl={pnl}
                pnlLoading={pnlLoading}
                holdings={holdings}
                holdingsLoading={holdingsLoading}
                range={range}
                onRangeChange={handleRangeChange}
                swapsTotal={portfolio.total}
                swapsPage={swapsPage}
                swapsTotalPages={portfolio.totalPages}
                swapsTab={swapsTab}
                swapsLoading={portfolio.loading || viewPending}
                onSwapsTabChange={handleTabChange}
                onSwapsPageChange={handlePageChange}
                showZero={showZero}
                onToggleShowZero={handleToggleShowZero}
                liveConnected={liveConnected}
                lastSyncSec={lastSyncSec}
                followBusy={followBusy}
                onToggleFollow={() => void handleToggleFollow()}
                isAdmin={isAdmin}
              />
            ) : (
              <div className="text-sm text-[#75798C] py-16 text-center">
                {syncOk ? syncLabel : 'Loading…'}
              </div>
            )}
          </div>
        </main>

        {showRight && (
          <FomoRightPanel wallet={selectedWallet} holdings={holdings} lastSwap={swaps[0] ?? null} isAdmin={isAdmin} session={session} />
        )}
      </div>

      {showTicker && <FomoBottomTicker liveConnected={liveConnected} />}

      {sessionChecked && !session && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0D0F18]/90 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-md py-6">
            <div className="text-center mb-4">
              <div className="font-display text-xl font-bold text-[#E9E9ED]">
                edgepool
              </div>
            </div>
            <LoginModal session={session} onSession={setSession} />
          </div>
        </div>
      )}
    </div>
  );
}
