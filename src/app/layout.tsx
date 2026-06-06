import type { Metadata } from "next";
import { Geist, Space_Mono, Rethink_Sans, Space_Grotesk } from "next/font/google";
import "../styles/index.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const rethinkSans = Rethink_Sans({
  variable: "--font-rethink-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://utxopia.com",
);

export const metadata: Metadata = {
  metadataBase,
  title: "UTXOpia | Private Bitcoin and Token Transfers",
  description: "Shield Bitcoin and supported chain assets with zero-knowledge proofs. Private transfers, stealth addresses, and auditable commitments across Solana and Sui.",
  icons: {
    icon: [
      { url: "/brand/logo-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/logo-192.png", sizes: "192x192", type: "image/png" },
      { url: "/brand/logo-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "UTXOpia | Private Bitcoin and Token Transfers",
    description: "Shielded transfers for Bitcoin and supported assets across Solana and Sui.",
    images: [{ url: "/brand/banner.png", width: 1200, height: 630, alt: "UTXOpia" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "UTXOpia",
    description: "Private Bitcoin and token transfers across Solana and Sui.",
    images: ["/brand/banner.png"],
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${spaceMono.variable} ${rethinkSans.variable} ${spaceGrotesk.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
