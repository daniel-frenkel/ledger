'use client';

/**
 * Inviting a client.
 *
 * The token is shown once, here, in the response that created it — the server
 * keeps only its SHA-256 and cannot show it again. So the screen is built
 * around that: the whole link is assembled for copying, it is marked as
 * one-time, and closing the panel loses it for good.
 *
 * The link puts the token in a fragment, `#<token>`, which browsers never send
 * to a server. That is what keeps it out of access logs, referrer headers and
 * proxies on the way to the client — and it is why the link must be sent
 * whole, not rebuilt.
 */
import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, WEB_URL, api, useClinicianSession } from '@/lib/api';
import { inviteUrl } from '@/lib/invite-url';
import { SignIn } from '@/app/sign-in';

interface Invite {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export default function InvitesPage() {
  const { session, loading } = useClinicianSession();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInvites(await api<Invite[]>('/v1/invites'));
    } catch {
      setInvites([]);
    }
  }, []);

  useEffect(() => {
    if (session) void refresh();
  }, [session, refresh]);

  const create = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    try {
      const out = await api<{ id: string; token: string }>('/v1/invites', { method: 'POST', body: '{}' });
      setFresh({ id: out.id, url: inviteUrl(WEB_URL, out.token) });
      await refresh();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not create an invitation.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/v1/invites/${id}`, { method: 'DELETE' });
      if (fresh?.id === id) setFresh(null);
      await refresh();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Could not revoke that invitation.');
    }
  };

  if (loading) return <main><p className="meta">Checking your session…</p></main>;
  if (!session) return <SignIn what="invite a client" />;

  return (
    <main>
      <h1>Invite a client</h1>
      <p className="standfirst">
        Send the client a link to CourageLoop. They choose what to share when they accept, and can change it or end the link at any
        time — from their side, not yours.
      </p>

      {fresh ? (
        <div className="callout warning">
          <span className="c-title">Copy this now — it is shown once</span>
          <p>
            The server keeps only a hash of this link and cannot show it again. If you lose it, revoke the invitation
            and make another.
          </p>
          <p className="tokenbox">
            <code>{fresh.url}</code>
          </p>
          <div className="actions">
            <button
              className="btn"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.url).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button className="btn ghost" type="button" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
          <p className="meta">
            Send it the way you would send anything else about this client. The part after the # never reaches a
            server log, so send the whole link rather than retyping it.
          </p>
        </div>
      ) : null}

      {problem ? <p className="warn">{problem}</p> : null}

      <p className="actions">
        <button className="btn" type="button" onClick={() => void create()} disabled={busy}>
          {busy ? 'Creating…' : 'Create an invitation'}
        </button>
      </p>

      <h2>Waiting to be accepted</h2>
      {invites === null ? (
        <p className="meta">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="meta">None. An invitation expires seven days after it is made.</p>
      ) : (
        <ul className="reflist">
          {invites.map((i) => (
            <li key={i.id}>
              <span className="refname">
                <code>{i.id.slice(0, 8)}</code> · expires {new Date(i.expiresAt).toLocaleDateString()}
              </span>
              <button className="btn ghost small" type="button" onClick={() => void revoke(i.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="foot">
        Once a client accepts, they appear in <Link href="/formulate">Formulate</Link>.
      </p>
    </main>
  );
}
