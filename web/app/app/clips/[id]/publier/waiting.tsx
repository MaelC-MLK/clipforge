"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Affiché tant que le clip est en rendu : relit la page jusqu'à ce qu'il soit prêt. */
export function Waiting() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router]);
  return (
    <p role="status" className="card text-sm text-violet-200">
      Préparation de la vidéo… Le formulaire de publication s&apos;affiche dès qu&apos;elle est prête.
    </p>
  );
}
