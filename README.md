# The Gold Reserve ($RESERVE) on Sui

A gold-miner skill game token launching on [vicefun.com](https://vicefun.com) (Sui mainnet).

**Status: scoping.** No contracts are written or deployed yet. Nothing here is live.

## How it works

- **Gold-backed vault.** The token's trading-fee share is routed into an accumulator that buys **XAUm** (Matrixdock tokenized gold) and deposits it in an on-chain vault.
- **Redeemable.** Any holder can redeem `$RESERVE` for their pro-rata share of the vault's XAUm (minus a small fee that stays in the vault, with daily caps and an opening gate).
- **Stake to build.** Players **stake (lock)** `$RESERVE` to place Gold Mines and Vault Shafts on a 16×16 grid in timed rounds. Stakes are returned in full after the round. A fee-funded rewards pot pays out by score, so placement skill decides who earns.

## Docs

- [Contract scope (v0.3)](docs/SCOPE.md)
- [Mine tab mockup](docs/mine-tab-mockup.jpg)

## Related

- Vice launchpad views needed for redemption: [aidaonsui-collab/the-arena#84](https://github.com/aidaonsui-collab/the-arena/pull/84)

## Site

The landing page (`index.html`, `scope.html`) is a static site with no build step, deployed on Vercel.
`scope.html` is pre-rendered from `docs/SCOPE.md` with `node scripts/render-scope.mjs` (needs `npm i marked`).

## Playable demo (`/play/`)

`play/` is a no-build, vanilla JS demo of the Mine tab (plus Vault, Leaderboard and Wallet tabs). Everything is simulated in the browser and saved in `localStorage`: no wallet, no chain, no real tokens. Rules follow `docs/SCOPE.md` §8 (v0.3, stake-to-build + redeemable vault). A 24h round is compressed to 4 minutes at 1×, with 10×/60× speed and an "End round" fast-forward.
