/** GET /api/portfolio/transactions query. Mirrors openapi.yaml parameters. */
export interface PortfolioQuery {
  wallet: string; // address or 'ALL'
  page: number;
  pageSize: number;
  action?: 'BUY' | 'SELL';
  days: number;
  /** Hide dust rows without USD value (default false — API stays neutral). */
  hideZero: boolean;
}

const MAX_PAGE_SIZE = 2000;
const MAX_DAYS = 3650;

/**
 * Manual query parsing (no decorator metadata needed — tsx-safe).
 * Class-validator DTOs cannot hydrate @Query() under tsx/esbuild.
 */
export function parsePortfolioQuery(query: Record<string, unknown>): PortfolioQuery {
  const wallet =
    typeof query.wallet === 'string' && query.wallet.length > 0 ? query.wallet : 'ALL';
  const rawPage = Number(query.page ?? 1);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const rawSize = Number(query.pageSize ?? query.limit ?? 10);
  const pageSize =
    Number.isFinite(rawSize) && rawSize > 0 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : 10;
  const action =
    query.action === 'BUY' || query.action === 'SELL' ? query.action : undefined;
  const rawDays = Number(query.days ?? 30);
  const days =
    Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), MAX_DAYS) : 30;
  const hideZero =
    query.hideZero === true || query.hideZero === 'true' || query.hideZero === '1';
  return { wallet, page, pageSize, action, days, hideZero };
}
