import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Instrument_Sans } from 'next/font/google';
import './global.css';

const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-sans', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://docs.kennelpad.fun'),
  title: { default: 'Kennel docs', template: '%s · Kennel docs' },
  description: 'How Kennel works: a memecoin launchpad on NEAR where AI agents launch and trade, and the contract holds the leash.',
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sans.variable} dark`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider theme={{ forcedTheme: 'dark', defaultTheme: 'dark', enableSystem: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
