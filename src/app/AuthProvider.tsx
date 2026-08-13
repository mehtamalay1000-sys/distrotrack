import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, UserRole, Worker, PinUser } from '@/lib/database.types';

// Session persistence key
const PIN_SESSION_KEY = 'distrotrack_pin_session';

interface PinSession {
  userId: string;
  name: string;
  role: UserRole;
  phone: string | null;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  loading: boolean;
  isMockSession: boolean;
  // Legacy methods (kept for compatibility)
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  // PIN-based auth
  signInWithPin: (userId: string, pin: string, role: UserRole) => Promise<{ error: string | null }>;
  getAvailableWorkers: () => Promise<Pick<Worker, 'id' | 'name' | 'phone'>[]>;
  getAvailableAdmins: () => Promise<Pick<PinUser, 'id' | 'name' | 'phone'>[]>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function createMockUser(pinSession: PinSession): User {
  return {
    id: pinSession.userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${pinSession.name.toLowerCase().replace(/\s+/g, '.')}@distrotrack.local`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: { full_name: pinSession.name },
    identities: [],
    factors: [],
  };
}

function createMockProfile(pinSession: PinSession): Profile {
  return {
    id: pinSession.userId,
    email: `${pinSession.name.toLowerCase().replace(/\s+/g, '.')}@distrotrack.local`,
    full_name: pinSession.name,
    role: pinSession.role,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function createMockSession(pinSession: PinSession): Session {
  const user = createMockUser(pinSession);
  return {
    access_token: `pin-session-${pinSession.userId}`,
    refresh_token: `pin-refresh-${pinSession.userId}`,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user,
  } as unknown as Session;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMockSession, setIsMockSession] = useState(false);

  // Restore PIN session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(PIN_SESSION_KEY);
    if (stored) {
      try {
        const pinSession: PinSession = JSON.parse(stored);
        setSession(createMockSession(pinSession));
        setProfile(createMockProfile(pinSession));
        setIsMockSession(true);
      } catch {
        localStorage.removeItem(PIN_SESSION_KEY);
      }
    }
    setLoading(false);
  }, []);

  // ── PIN-based login ────────────────────────────────────────────

  const signInWithPin = useCallback(async (userId: string, pin: string, role: UserRole): Promise<{ error: string | null }> => {
    try {
      if (role === 'owner') {
        // Validate against pin_users table
        const { data, error } = await supabase
          .from('pin_users')
          .select('id, name, phone, pin, role')
          .eq('id', userId)
          .eq('status', 'active')
          .single();

        if (error || !data) {
          return { error: 'User not found. Please try again.' };
        }
        if (data.pin !== pin) {
          return { error: 'Incorrect PIN. Please try again.' };
        }

        const pinSession: PinSession = { userId: data.id, name: data.name, role: 'owner', phone: data.phone };
        localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(pinSession));
        setSession(createMockSession(pinSession));
        setProfile(createMockProfile(pinSession));
        setIsMockSession(true);
        return { error: null };

      } else {
        // Validate against workers table
        const { data, error } = await supabase
          .from('workers')
          .select('id, name, phone, pin')
          .eq('id', userId)
          .eq('status', 'active')
          .single();

        if (error || !data) {
          return { error: 'Worker not found. Please try again.' };
        }
        if (data.pin !== pin) {
          return { error: 'Incorrect PIN. Please try again.' };
        }

        const pinSession: PinSession = { userId: data.id, name: data.name, role: 'worker', phone: data.phone };
        localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(pinSession));
        setSession(createMockSession(pinSession));
        setProfile(createMockProfile(pinSession));
        setIsMockSession(true);
        return { error: null };
      }
    } catch {
      return { error: 'Connection error. Please check your network.' };
    }
  }, []);

  // ── Fetch available users ──────────────────────────────────────

  const getAvailableWorkers = useCallback(async (): Promise<Pick<Worker, 'id' | 'name' | 'phone'>[]> => {
    try {
      const { data } = await supabase
        .from('workers')
        .select('id, name, phone')
        .eq('status', 'active')
        .order('name');

      const seen = new Set<string>();
      const uniqueWorkers: Pick<Worker, 'id' | 'name' | 'phone'>[] = [];
      for (const w of (data || [])) {
        const key = w.name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueWorkers.push(w as Pick<Worker, 'id' | 'name' | 'phone'>);
        }
      }
      return uniqueWorkers;
    } catch {
      return [];
    }
  }, []);

  const getAvailableAdmins = useCallback(async (): Promise<Pick<PinUser, 'id' | 'name' | 'phone'>[]> => {
    try {
      const { data } = await supabase
        .from('pin_users')
        .select('id, name, phone')
        .eq('status', 'active')
        .eq('role', 'owner')
        .order('name');

      const seen = new Set<string>();
      const uniqueAdmins: Pick<PinUser, 'id' | 'name' | 'phone'>[] = [];
      for (const a of (data || [])) {
        const key = a.name.toLowerCase().trim();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueAdmins.push(a as Pick<PinUser, 'id' | 'name' | 'phone'>);
        }
      }
      return uniqueAdmins;
    } catch {
      return [];
    }
  }, []);

  // ── Legacy email/password methods (kept for backward compat) ───

  const signIn = async (email: string, password: string) => {
    // Demo login shortcut
    if (email.toLowerCase().includes('demo') || password === 'demo123') {
      const pinSession: PinSession = { userId: 'demo-user-001', name: 'Demo User', role: 'owner', phone: null };
      localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(pinSession));
      setSession(createMockSession(pinSession));
      setProfile(createMockProfile(pinSession));
      setIsMockSession(true);
      return { error: null };
    }
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Connection error.' };
    }
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    try {
      const { error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } },
      });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Connection error.' };
    }
  };

  // ── Sign out ───────────────────────────────────────────────────

  const signOut = async () => {
    localStorage.removeItem(PIN_SESSION_KEY);
    setIsMockSession(false);
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setSession(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: (profile?.role as UserRole) ?? 'owner',
        loading,
        isMockSession,
        signIn,
        signUp,
        signInWithPin,
        getAvailableWorkers,
        getAvailableAdmins,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
