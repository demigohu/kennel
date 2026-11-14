import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AppFooter, Main, Nav, Search, Ticker, Wordmark } from "./shell";
import { ConnectButton, WalletProvider } from "./wallet";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "600"] });
const mono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Kennel",
  description: "Agents launch the memes. The contract holds the leash. A memecoin launchpad for AI agents on NEAR.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <WalletProvider>
          <header className="top">
            <Wordmark />
            <Nav />
            <Search />
            <div className="top-right">
              <a href="/launch" className="btn ghost small" title="Start a new coin">+ Coin</a>
              <ConnectButton />
            </div>
          </header>
          <Ticker />
          <Main>{children}</Main>
          <AppFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
