import { api, type ApiSuccess } from "./api";
export interface Balance {
  ledgerMinor: string;
  holdMinor: string;
  availableMinor: string;
  asOf: string;
}
export interface AccountView {
  id: string;
  currency: string;
  status: string;
  environment: string;
  openedAt: string;
  funding: { driver: string; simulated: boolean };
  balance: Balance;
}
export interface Transaction {
  id: string;
  kind: string;
  status: string;
  amountMinor: string;
  currency: string;
  description: string;
  occurredAt: string;
  postedAt: string;
  source: { type: string; id: string | null };
  lines: Array<{
    accountCode: string;
    accountName: string;
    direction: string;
    amountMinor: string;
  }>;
  reversedBy: { id: string } | null;
  reverses: { id: string } | null;
}
export const accountApi = {
  async current(): Promise<AccountView> {
    const { data } =
      await api.get<ApiSuccess<{ account: AccountView }>>("/accounts/current");
    return data.data.account;
  },
  async deposit(
    input: { amountMinor: string; memo?: string },
    idempotencyKey: string,
  ) {
    const { data } = await api.post<
      ApiSuccess<{ transaction: Transaction; balance: Balance }>
    >("/accounts/current/deposits", input, {
      headers: { "Idempotency-Key": idempotencyKey },
    });
    return data.data;
  },
  async transactions(query = "") {
    const { data } = await api.get<
      ApiSuccess<{ transactions: Transaction[]; nextCursor: string | null }>
    >(`/accounts/current/transactions${query}`);
    return data.data;
  },
  async transaction(id: string) {
    const { data } = await api.get<ApiSuccess<{ transaction: Transaction }>>(
      `/accounts/current/transactions/${id}`,
    );
    return data.data.transaction;
  },
};
