import { TxParseService } from './src/common/chain/tx-parse.service.js';

const W = 'WALLET';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const M = 'MintAAA';

function tx(opts: { usdcPre: number; usdcPost: number; mintPre: number; mintPost: number; solDelta: number }) {
  return {
    meta: {
      err: null,
      fee: 5000,
      logMessages: ['Program log: Instruction: Swap'],
      preBalances: [1_000_000_000],
      postBalances: [1_000_000_000 + Math.round(opts.solDelta * 1e9)],
      preTokenBalances: [
        { owner: W, mint: USDC, uiTokenAmount: { uiAmount: opts.usdcPre } },
        { owner: W, mint: M, uiTokenAmount: { uiAmount: opts.mintPre } },
      ],
      postTokenBalances: [
        { owner: W, mint: USDC, uiTokenAmount: { uiAmount: opts.usdcPost } },
        { owner: W, mint: M, uiTokenAmount: { uiAmount: opts.mintPost } },
      ],
    },
    transaction: { message: { accountKeys: [{ pubkey: W }] } },
  };
}

const stub = (payload: unknown) => ({ getTransaction: async () => payload }) as never;
const prices = { bulkPrices: async () => ({}) } as never;

async function main() {
  const svc = new TxParseService(prices);
  const buy = await svc.parse('s1', W, stub(tx({ usdcPre: 100, usdcPost: 95, mintPre: 0, mintPost: 1000, solDelta: 0 })));
  const sell = await svc.parse('s2', W, stub(tx({ usdcPre: 100, usdcPost: 105, mintPre: 1000, mintPost: 0, solDelta: 0 })));
  console.log('stub TT BUY :', buy?.action, buy?.tokenMint, buy?.amountUsd);
  console.log('stub TT SELL:', sell?.action, sell?.tokenMint, sell?.amountUsd);
  if (buy?.action !== 'BUY' || buy.amountUsd !== 5) throw new Error('BUY failed');
  if (sell?.action !== 'SELL' || sell.amountUsd !== 5) throw new Error('SELL failed');

  // Real RPC path (no stub): must not throw like web3.js did.
  const real = await svc.parse(
    '3QsfLrh41pJt23JFYNH3FJF2nUnCzDXDmC4KW3jZXPK2EwTYn7wShMHGhjJhDg5d6J6dLbLr1TYcH6fG9wizWRBf',
    '4ugDhHJ8XDXAeABmrNmGffFaLbJb9BkPyiFGVSV9ocwo',
  );
  console.log('real parse  :', real ? `${real.action} ${real.tokenMint?.slice(0, 6)} $${real.amountUsd ?? '?'}` : 'null');
  if (!real) throw new Error('real parse returned null');
  console.log('ALL GREEN');
}

void main();
