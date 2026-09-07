import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { wipeAll } from '@/db';

interface SessionState {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>({ session: null, loading: true, signOut: async () => {} });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    await wipeAll(); // the local database holds plaintext entries; it leaves with the account
    setSession(null);
  };

  return <Ctx.Provider value={{ session, loading, signOut }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
