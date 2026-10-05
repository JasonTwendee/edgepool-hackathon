# Shadow momentum report — 2026-10-02T06:16:57Z

Sampled 25 priced BUY signals (tokenMint present, 30d ledger).
Rule tested: entry counts if price reaches +10% above signal fill within 30 min.

- Hit rate +10%/30m: **52.0%** (13/25)
- Median minutes to +10%: 0.9
- Median max adverse excursion: -14.13%
- Signals touching −10% first/in-window: 18/25

Reading: hits come fast (0.9 min median) but adverse excursion (median −14%)
usually exceeds the −10% pullback line first — i.e. waiting for +10% momentum
buys after the dip as often as it rides continuations. Supports Solution v2:
immediate entry on qualify + TP ladder from our own fill, pullback as optional
second leg — not a momentum gate. Re-run with +6%/15min variant to confirm.
