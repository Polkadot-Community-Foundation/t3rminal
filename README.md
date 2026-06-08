> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept.
> This open source code is provided for research, experimentation, and developer
> education only. This code has not been audited, is actively experimental, and
> may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

# T3RMINAL

_Experimental proof-of-concept code developed and published by Parity Technologies._

A static Next.js app published to a `.dot` domain, backed by a pallet-revive
contract on an Asset Hub-style chain, with metadata stored on the Polkadot
Bulletin chain.

## Develop

```sh
npm install
npm run dev          # next dev
npm run build        # static export to out/
npm test             # vitest
npm run test:e2e     # playwright
```

Copy [.env.example](.env.example) to `.env.local` and fill in the values before
running against a live chain.

## Deploy

`npm run deploy` is an interactive command that generates or imports a wallet,
deploys a fresh `T3rminalBulletinIndex` contract (PAPI / pallet-revive), builds
the static export, and publishes it to a `.dot` domain.

```sh
npm run deploy
```

Contract-only (non-interactive), useful for CI or re-deploys:

```sh
DEPLOYER_SEED="<deployer mnemonic>" npm run deploy:contract -- --env <env-name>
```

Anyone may fork this repository and run these steps to deploy their own
independent instance. Parity does not operate, host, or endorse any downstream
deployment.

## License

Licensed under [GPL-3.0](LICENSE). Solidity contracts under `contracts/` are
licensed under MIT (see their SPDX headers).

## Security

This is a reference proof-of-concept, **not a hardened production build**. Before
deploying it for any real use case, you are responsible for:

- Reviewing the code yourself.
- Checking that dependencies are up to date and free of known vulnerabilities.
- Securing your own fork or deployment environment (keys, secrets, network
  configuration).
- Tracking the latest tagged release / commits for security fixes — older
  releases are not backported (exceptions might apply).

For Parity's security disclosure process and Bug Bounty program, see
[parity.io/bug-bounty](https://parity.io/bug-bounty).
