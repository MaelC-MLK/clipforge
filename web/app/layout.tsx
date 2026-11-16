import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hooklip",
  description: "Studio de clipping : de la VOD au clip vertical publié.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
