/**
 * The clinician shell.
 *
 * Light theme only — `color-scheme: light` lives in globals.css and there are
 * no dark tokens anywhere. Fonts are the three from the reference file, loaded
 * through next/font/google with real fallback stacks; nothing else is fetched.
 *
 * ClinicianSession wraps {children}. It is a client component holding the
 * Supabase session; the Library pages inside it stay server components and
 * stay prerendered, because they never ask for it.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import './globals.css';
import { ClinicianSession } from '@/lib/api';

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
            <Link href="/invites">Invite</Link>
            <Link href="/stack">Stack</Link>
          </nav>
          <ClinicianSession>{children}</ClinicianSession>
        </div>
      </body>
    </html>
  );
}
