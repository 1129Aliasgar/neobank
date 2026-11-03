"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, tokenStore } from "@/lib/api";
import { authApi } from "@/lib/auth";

/**
 * The end of Module 1, and deliberately nothing more.
 *
 * There is no chrome here by design: accounts, balances, cards and approvals
 * belong to later modules. The only job of this page is to prove the onboarding
 * pipeline produced an authenticated, approved business.
 */
export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!tokenStore.get()) {
      router.replace("/login");
      return;
    }

    let active = true;

    void (async () => {
      try {
        await authApi.session();

        if (active) {
          setReady(true);
        }
      } catch (caught) {
        if (caught instanceof ApiClientError && caught.isUnauthorized) {
          tokenStore.clear();
        }

        router.replace("/login");
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (!ready) {
    return null;
  }

  return (
    <main className="flex min-h-svh items-center justify-center">
      <h1 className="font-heading text-6xl font-light tracking-[-0.02em] text-ink">
        Dashboard
      </h1>
    </main>
  );
}
