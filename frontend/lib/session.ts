"use client";

/**
 * Session + onboarding reads shared by every guarded page.
 *
 * The guard is deliberately client-side and backed by the API response, not by
 * a cached flag: the token may have expired, a role may have changed, or a
 * webhook may have moved the business on since the page was rendered.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, tokenStore } from "./api";
import { authApi } from "./auth";
import { businessApi, type CurrentBusiness } from "./business";

interface CurrentBusinessState {
  data: CurrentBusiness | null;
  loading: boolean;
  error: string | null;
  reload: (options?: { silent?: boolean }) => Promise<CurrentBusiness | null>;
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

export function useCurrentBusiness(): CurrentBusinessState {
  const router = useRouter();
  const [data, setData] = useState<CurrentBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * One read, no loading toggle. Kept separate so the initial effect can await
   * it before touching state, which avoids a synchronous setState in the
   * effect body (React Compiler flags that as a cascading render).
   */
  const load = useCallback(async (): Promise<CurrentBusiness | null> => {
    if (!tokenStore.get()) {
      router.replace("/login");
      return null;
    }

    try {
      const current = await businessApi.getCurrent();
      setData(current);
      setError(null);

      return current;
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.isUnauthorized) {
        tokenStore.clear();
        router.replace("/login");
        return null;
      }

      setError(messageOf(caught));

      return null;
    }
  }, [router]);

  useEffect(() => {
    let active = true;

    void (async () => {
      await load();

      if (active) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [load]);

  const reload = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const current = await load();

      if (!options?.silent) {
        setLoading(false);
      }

      return current;
    },
    [load],
  );

  return { data, loading, error, reload };
}

/** Sign out and return to the login screen. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();

  return async () => {
    try {
      await authApi.logout();
    } finally {
      router.replace("/login");
    }
  };
}
