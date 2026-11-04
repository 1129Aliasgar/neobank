/**
 * Axios client for the NeoBank API.
 *
 * - `baseURL` comes from `NEXT_PUBLIC_API_URL` (see `.env.example`).
 * - `withCredentials` is on so the backend's httpOnly cookie works.
 * - A Bearer token is also attached when one is stored. Cookies are unreliable
 *   when the frontend and API are on different sites (Netlify vs Render), so
 *   the token returned by login/register is the practical fallback.
 * - Every request carries an `x-request-id`; the API echoes it and its logs use
 *   the same value, which makes a bug report traceable.
 */

import axios, { type AxiosError, type AxiosInstance } from "axios";

const TOKEN_KEY = "neobank.auth.token";

export interface ApiSuccess<T> {
  data: T;
  success: true;
}

export interface ApiFailure {
  message: string;
  success: false;
  statusCode?: number;
}

/** Normalised error thrown by every API helper. */
export class ApiClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }

  /** 401 means the token is missing, expired or blacklisted. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/**
 * Bearer token storage.
 *
 * localStorage is used because the API and the site are different origins in
 * production and third-party cookies are blocked by some browsers. It is a
 * deliberate trade-off for the trial: a production build would prefer the
 * httpOnly cookie plus a refresh-token rotation scheme.
 */
export const tokenStore = {
  get(): string | null {
    if (typeof window === "undefined") {
      return null;
    }

    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },

  set(token: string): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* Private mode / storage disabled: cookie auth still works. */
    }
  },

  clear(): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

function newRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  return uuid ? uuid.slice(0, 8) : Math.random().toString(16).slice(2, 10);
}

export const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1",
  withCredentials: true,
  timeout: 15_000,
  headers: {
    Accept: "application/json",
    /*
     * Free ngrok domains answer browser GETs with an HTML warning page unless
     * this header is present. Without it, login (POST) works but every dashboard
     * GET comes back as `text/plain` and cannot be parsed as JSON. The header is
     * harmless on a real API host, so it stays in the shared client rather than
     * being conditioned on the base URL.
     */
    "ngrok-skip-browser-warning": "true",
  },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();

  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  config.headers.set("x-request-id", newRequestId());

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiFailure>) => {
    const status = error.response?.status ?? 0;

    const message =
      error.response?.data?.message ??
      (status === 0
        ? "Cannot reach the NeoBank API. Check your connection and try again."
        : error.message) ??
      "Request failed";

    return Promise.reject(new ApiClientError(message, status));
  },
);
