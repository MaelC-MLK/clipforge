"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Relit la page toutes les 3 secondes, le temps que la vidéo soit récupérée. */
export function Refresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
