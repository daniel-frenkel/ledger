/**
 * Server component: reads the agreement from disk, hands it to the client.
 *
 * The document is read at build time so the version string the page offers and
 * the one the API accepts come from the same file.
 */
import React from 'react';
import { baa } from '@/lib/baa';
import { SetupClient } from './setup-client';

export const metadata = { title: 'Set up · Ledger' };

export default function SetupPage() {
  const { version, draft, body } = baa();
  return <SetupClient version={version} draft={draft} body={body} />;
}
