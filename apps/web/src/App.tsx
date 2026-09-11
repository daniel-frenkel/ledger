import React, { useEffect } from 'react';
import { NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { SessionProvider, useSession } from '@/auth/session';
import { ensurePersistence } from '@/storage';
import { recordUsage } from '@/usage';
import { startSyncListeners, syncNow } from '@/sync';
import { P, Screen } from '@/ui';
import SignIn from '@/screens/SignIn';
import Open from '@/screens/Open';
import Predict from '@/screens/Predict';
import Resolve from '@/screens/Resolve';
import Ledger from '@/screens/Ledger';
import Settings from '@/screens/Settings';
import Join from '@/screens/Join';

function Tabs() {
  return (
    <>
      <Outlet />
      <nav className="tabs">
        <NavLink to="/" end>
          <span className="glyph" aria-hidden="true">
            ○
          </span>
          Open
        </NavLink>
        <NavLink to="/ledger">
          <span className="glyph" aria-hidden="true">
            ▤
          </span>
          Ledger
        </NavLink>
        <NavLink to="/settings">
          <span className="glyph" aria-hidden="true">
            ⚙
          </span>
          Settings
        </NavLink>
      </nav>
    </>
  );
}

function Gate() {
  const { session, loading } = useSession();
  const location = useLocation();

  useEffect(() => {
    if (!session) return;
    void syncNow();
    const stop = startSyncListeners();
    return stop;
  }, [session]);

  if (loading)
    return (
      <Screen>
        <P muted>Loading…</P>
      </Screen>
    );

  if (!session) {
    return (
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        {/*
          /join renders signed-out rather than redirecting: the invite token is
          in the URL fragment, and a redirect drops it. The screen reads the
          fragment into memory on mount, then shows sign-in itself.
        */}
        <Route path="/join" element={<Join />} />
        <Route path="*" element={<Navigate to="/sign-in" replace />} />
      </Routes>
    );
  }

  if (location.pathname === '/sign-in') return <Navigate to="/" replace />;

  return (
    <Routes>
      <Route element={<Tabs />}>
        <Route path="/" element={<Open />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="/predict" element={<Predict />} />
      <Route path="/resolve/:id" element={<Resolve />} />
      <Route path="/join" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    // Asked once, ever; the answer is recorded in meta.
    void ensurePersistence();
    void recordUsage('app_open');
  }, []);

  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
