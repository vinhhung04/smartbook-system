// The only amounts a wallet can be topped up with (online or at the counter), so balances
// stay in round thousands. Same list as WALLET_TOPUP_AMOUNTS_VND in borrow-service, which
// stays the source of truth and refuses any other amount.
export const WALLET_TOPUP_AMOUNTS = [10000, 20000, 50000, 100000, 200000] as const;
