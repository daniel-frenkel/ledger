import type { ReactNode } from 'react';
export const metadata = { title: 'Ledger — clinician', description: 'Placeholder' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: '0 20px', lineHeight: 1.5 }}>{children}</body>
    </html>
  );
}
