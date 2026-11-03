/**
 * Auth calls for the NeoBank API.
 *
 * The functions unwrap the API's `{ data, success }` envelope and keep the
 * Bearer token in sync, so a form only has to handle `AuthResult` or
 * `ApiClientError`.
 */

import { api, tokenStore, type ApiSuccess } from "./api";

export type UserRole = "OWNER" | "ADMIN" | "EMPLOYEE" | "OPERATIONS";

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResult {
  user: UserProfile;
  token: string;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const { data } = await api.post<ApiSuccess<AuthResult>>(
      "/auth/register",
      input,
    );

    tokenStore.set(data.data.token);

    return data.data;
  },

  async login(input: LoginInput): Promise<AuthResult> {
    const { data } = await api.post<ApiSuccess<AuthResult>>(
      "/auth/login",
      input,
    );

    tokenStore.set(data.data.token);

    return data.data;
  },

  async profile(): Promise<UserProfile> {
    const { data } =
      await api.get<ApiSuccess<{ user: UserProfile }>>("/auth/profile");

    return data.data.user;
  },

  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } finally {
      /* Clear locally even if the server call failed: the UI must log out. */
      tokenStore.clear();
    }
  },
};
