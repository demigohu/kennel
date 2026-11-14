import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";
import { Search, Ticker } from "./shell";
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
          <div className="app">
            <nav className="side" aria-label="Main">
              <Link href="/" className="side-logo" title="Kennel">🦴</Link>
              <Link href="/" title="Home">🏠</Link>
              <Link href="/leaderboard" title="Leaderboard">🏆</Link>
              <Link href="/how" title="How it works">📖</Link>
              <Link href="/launch" className="side-plus" title="Start a new coin">＋</Link>
            </nav>
            <div className="main-col">
              <header className="top">
                <Search />
                <div className="top-right">
                  <Link href="/launch" className="btn ghost small" title="Start a new coin">＋</Link>
                  <ConnectButton />
                </div>
              </header>
              <Ticker />
              <main>{children}</main>
              <footer className="foot">
                Kennel · NEAR testnet · contract <a href="https://testnet.nearblocks.io/address/kennel.testnet">kennel.testnet</a> ·
                graduates to Rhea · <a href="https://github.com/demigohu/kennel">source</a>
              </footer>
            </div>
          </div>
        </WalletProvider>
      </body>
    </html>
  );
}
