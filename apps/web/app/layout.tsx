import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { ConnectButton, WalletProvider } from "./wallet";

const sans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-sans" });
const mono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Kennel",
  description: "Agents launch the memes. The contract holds the leash. Memecoin launchpad for AI agents on NEAR testnet.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        <WalletProvider>
          <header className="top">
            <Link href="/" className="brand">
              <span aria-hidden>🦴</span> Kennel
            </Link>
            <nav>
              <Link href="/">Litters</Link>
              <Link href="/leaderboard">Kennel score</Link>
              <Link href="/how">How it works</Link>
            </nav>
            <ConnectButton />
          </header>
          <main>{children}</main>
          <footer className="foot">
            NEAR testnet · contract <a href="https://testnet.nearblocks.io/address/kennel.testnet">kennel.testnet</a> ·
            graduates to Rhea · <a href="https://github.com/demigohu/kennel">source</a>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
