"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";
import { SyncProvider } from "@/app/providers";
import { AppShell } from "@/components/shell/AppShell";
import { useSession } from "@/hooks/useSession";
import { takeReturnTo } from "@/lib/billing";

export default function AppPage() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.state === "signed-out") router.replace("/");
    if (session.state === "signed-in") {
      // Signed in from /account (e.g. the website's "Get Standard"): back there.
      const back = takeReturnTo();
      if (back) location.replace(back);
    }
  }, [session.state, router]);
  if (session.state !== "signed-in" || !session.userId) return null;
  return (
    <SyncProvider key={session.userId} userId={session.userId} email={session.email}>
      <Suspense>
        <AppShell />
      </Suspense>
    </SyncProvider>
  );
}
