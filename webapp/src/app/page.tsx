"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SignIn } from "@/components/SignIn";
import { useSession } from "@/hooks/useSession";

export default function Home() {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.state === "signed-in") router.replace("/app/");
  }, [session.state, router]);
  return session.state === "signed-out" ? <SignIn /> : null;
}
