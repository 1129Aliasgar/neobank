"use client";

/**
 * The dashboard's one session read.
 *
 * `useCurrentBusiness()` already gives the authoritative organisation + role.
 * The shell additionally needs the signed-in person (username, email, joined
 * date) for the profile panel, which lives on `/auth/me`. Fetching it once in
 * the layout means a navigation between dashboard pages never repeats either
 * call.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, tokenStore } from "./api";
import { authApi, type UserProfile } from "./auth";
import type { CurrentBusiness } from "./business";

interface DashboardSessionValue {
  /** Organisation profile, role and onboarding state from `/businesses/current`. */
  current: CurrentBusiness;
  /** Null while `/auth/me` is in flight. */
  user: UserProfile | null;
  identityError: string | null;
}

const DashboardSessionContext = createContext<DashboardSessionValue | null>(
  null,
);

function messageOf(caught: unknown): string {
  return caught instanceof Error
    ? caught.message
    : "Could not load your profile.";
}

export function DashboardSessionProvider({
  current,
  children,
}: {
  current: CurrentBusiness;
  children: ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const session = await authApi.session();

        if (!active) {
          return;
        }

        setUser(session.user);
        setIdentityError(null);
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.isUnauthorized) {
          tokenStore.clear();
          router.replace("/login");
          return;
        }

        if (active) {
          setIdentityError(messageOf(caught));
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  return (
    <DashboardSessionContext.Provider
      value={{ current, user, identityError }}
    >
      {children}
    </DashboardSessionContext.Provider>
  );
}

export function useDashboardSession(): DashboardSessionValue {
  const value = useContext(DashboardSessionContext);

  if (!value) {
    throw new Error(
      "useDashboardSession must be used inside the dashboard layout",
    );
  }

  return value;
}
