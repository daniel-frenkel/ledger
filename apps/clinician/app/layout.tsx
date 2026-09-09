/**
 * The clinician shell.
 *
 * Light theme only — `color-scheme: light` lives in globals.css and there are
 * no dark tokens anywhere. Fonts are the three from the reference file, loaded
 * through next/font/google with real fallback stacks; nothing else is fetched.
 *
 * When sign-in lands, it wraps <Shell> — the Library and Formulate carry no
 * client data, import nothing from the API client, and do not need a session in
 * this pass, so the change is a wrapper around {children}, not a rewrite.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import './globals.css';

const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-newsreader',
  fallback: ['Georgia', 'serif'],
});

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-plex-sans',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-plex-mono',
  fallback: ['ui-monospace', 'Menlo', 'monospace'],
});

export const metadata = {
  title: 'Ledger — clinician',
  description: 'The Library and the floor locator. Reference material; no client data.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <div className="shell">
          <header className="top">
            <p className="wm">
              <Link href="/library">
                Ledger<span>.</span>
              </Link>
            </p>
            <p className="crumb">Clinician — reference</p>
          </header>
          <nav className="tabs">
            <Link href="/library">Library</Link>
            <Link href="/library/model">The model</Link>
            <Link href="/library/floors">Floors</Link>
            <Link href="/library/modalities">Modalities</Link>
            <Link href="/library/protocols">Protocols</Link>
            <Link href="/formulate">Formulate</Link>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
