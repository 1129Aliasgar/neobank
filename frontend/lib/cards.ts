import { api, type ApiSuccess } from "./api";

export interface CardView {
  id: string;
  provider: string;
  status: string;
  type: string;
  currency: string;
  last4: string | null;
  brand: string | null;
  expMonth: number | null;
  expYear: number | null;
  spendingLimitMinor: string | null;
  spendingLimitInterval: string | null;
  cardholderStatus: string | null;
  employee: { id: string; email: string; username: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeOption {
  id: string;
  email: string;
  username: string;
}

export interface CardTransactionView {
  id: string;
  providerTransactionId: string;
  kind: string;
  amountMinor: string;
  currency: string;
  occurredAt: string;
}

export interface CardAuthorization {
  id: string;
  providerAuthorizationId: string;
  amountMinor: string;
  capturedMinor: string;
  currency: string;
  status: string;
  merchantName: string | null;
  merchantMcc: string | null;
  providerCreatedAt: string | null;
  createdAt: string;
  transactions: CardTransactionView[];
}

export interface SandboxEventResult {
  outcome: string;
  eventId: string;
  transactionToken: string;
  amountMinor?: string;
  simulated: true;
}

export const cardsApi = {
  async list() {
    const { data } = await api.get<ApiSuccess<{ cards: CardView[] }>>("/cards");
    return data.data.cards;
  },

  async mine() {
    const { data } = await api.get<
      ApiSuccess<{ cards: CardView[]; authorizations: CardAuthorization[] }>
    >("/cards/mine");
    return data.data;
  },

  async get(id: string) {
    const { data } = await api.get<ApiSuccess<{ card: CardView }>>(
      `/cards/${id}`,
    );
    return data.data.card;
  },

  async employees() {
    const { data } = await api.get<ApiSuccess<{ employees: EmployeeOption[] }>>(
      "/cards/eligible-employees",
    );
    return data.data.employees;
  },

  async issue(input: {
    userId: string;
    spendingLimitMinor?: string;
    spendingLimitInterval?: string;
  }) {
    const { data } = await api.post<ApiSuccess<{ card: CardView }>>(
      "/cards",
      input,
    );
    return data.data.card;
  },

  async freeze(id: string) {
    const { data } = await api.post<ApiSuccess<{ card: CardView }>>(
      `/cards/${id}/freeze`,
    );
    return data.data.card;
  },

  async unfreeze(id: string) {
    const { data } = await api.post<ApiSuccess<{ card: CardView }>>(
      `/cards/${id}/unfreeze`,
    );
    return data.data.card;
  },

  async cancel(id: string) {
    const { data } = await api.post<ApiSuccess<{ card: CardView }>>(
      `/cards/${id}/cancel`,
    );
    return data.data.card;
  },

  async authorizations(id: string) {
    const { data } = await api.get<
      ApiSuccess<{ authorizations: CardAuthorization[] }>
    >(`/cards/${id}/authorizations`);
    return data.data.authorizations;
  },

  /** Operator-only Sandbox driver: Lithic simulate + signed webhook. */
  async simulateAuthorize(
    id: string,
    input: { amountMinor: string; descriptor?: string },
  ) {
    const { data } = await api.post<ApiSuccess<SandboxEventResult>>(
      `/cards/${id}/simulate/authorize`,
      input,
    );
    return data.data;
  },

  async simulateClear(
    id: string,
    input: { transactionToken: string; amountMinor: string },
  ) {
    const { data } = await api.post<ApiSuccess<SandboxEventResult>>(
      `/cards/${id}/simulate/clear`,
      input,
    );
    return data.data;
  },

  async simulateVoid(id: string, input: { transactionToken: string }) {
    const { data } = await api.post<ApiSuccess<SandboxEventResult>>(
      `/cards/${id}/simulate/void`,
      input,
    );
    return data.data;
  },
};
