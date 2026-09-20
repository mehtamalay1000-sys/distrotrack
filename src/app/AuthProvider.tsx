import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/app/queryClient';
import type { Profile, UserRole, Worker, PinUser } from '@/lib/database.types';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: UserRole;
  loading: boolean;
  isMockSession: boolean;
  isMaster: boolean;
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

/**
 * Fire-and-forget audit event logger.
 * NEVER pass passwords, tokens, PINs, or any secret as `detail`.
 */
async function logEvent(
  userId: string | null,
  userName: string | null,
  role: string | null,
  module: string,
  action: string,
  status: 'success' | 'failure' | 'warning' = 'success',
  detail?: string
) {
  try {
    await supabase.rpc('log_system_event', {
      p_user_id: userId ?? '',
      p_user_name: userName ?? '',
      p_role: role ?? '',
      p_module: module,
      p_action: action,
      p_status: status,
      p_detail: detail ?? null,
    });
  } catch {
    // Audit failures are always silently swallowed — never surface to UI
  }
}

/**
 * Resolves the server-trusted Profile associated with the authenticated Supabase user.
 * Fails closed if the profile does not exist or database query fails.
 */
async function fetchProfileForUser(user: User): Promise<Profile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !data) {
      console.error('Failed to resolve server-trusted profile for authenticated identity:', error?.message);
      return null;
    }
    return data as Profile;
  } catch (err) {
    console.error('Exception resolving profile:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore authentic Supabase session on mount and subscribe to auth state changes
  useEffect(() => {
    let mounted = true;
    // Guard: prevent onAuthStateChange from double-resolving the initial SIGNED_IN
    // event that Supabase fires when restoring a persisted session (same session
    // that getSession() already resolved). Without this, both paths call
    // fetchProfileForUser concurrently, causing two renders and visual flicker.
    let sessionInitialized = false;

    // 1. Restore authentic Supabase session
    supabase.auth
      .getSession()
      .then(async ({ data: { session: existingSession } }) => {
        if (!mounted) return;
        if (existingSession?.user) {
          const prof = await fetchProfileForUser(existingSession.user);
          if (mounted) {
            if (prof) {
              setSession(existingSession);
              setProfile(prof);
            } else {
              // Fail closed: authenticated user without valid profile is signed out
              await supabase.auth.signOut();
              setSession(null);
              setProfile(null);
            }
          }
        } else {
          setSession(null);
          setProfile(null);
        }
        if (mounted) {
          sessionInitialized = true;
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error restoring session:', err);
        if (mounted) {
          sessionInitialized = true;
          setSession(null);
          setProfile(null);
          setLoading(false);
        }
      });

    // 2. Subscribe to auth state transitions
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT' || !newSession?.user) {
        // Clear ALL React Query cache on sign-out to prevent previous user's
        // business data from leaking to the next user/role that logs in.
        queryClient.clear();
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        // Skip the initial SIGNED_IN that Supabase fires when restoring a
        // persisted session — getSession() above has already handled it.
        // Only process SIGNED_IN events that occur AFTER initialization
        // (e.g., explicit login calls that set session via signInWithPin).
        if (event === 'SIGNED_IN' && !sessionInitialized) {
          return;
        }
        const prof = await fetchProfileForUser(newSession.user);
        if (mounted) {
          if (prof) {
            setSession(newSession);
            setProfile(prof);
          } else {
            await supabase.auth.signOut();
            setSession(null);
            setProfile(null);
          }
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ── PIN-based login ────────────────────────────────────────────

  const signInWithPin = useCallback(
    async (userId: string, pin: string, role: UserRole): Promise<{ error: string | null }> => {
      try {
        const cleanPin = String(pin ?? '').trim();
        if (!cleanPin) {
          return { error: 'Please enter your PIN.' };
        }

        // ── 1. MASTER LOGIN ─────────────────────────────────────────
        // Authenticates against GoTrue with Master credentials
        if (role === 'master') {
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: 'master@distrotrack.local',
            password: cleanPin,
          });

          if (authError || !authData.session || !authData.user) {
            void logEvent('master-001', 'Master Administrator', 'master', 'auth', 'failed_login', 'failure', 'Incorrect Master PIN');
            return { error: 'Incorrect Master PIN. Please try again.' };
          }

          const prof = await fetchProfileForUser(authData.user);
          if (!prof || prof.role !== 'master') {
            await supabase.auth.signOut();
            return { error: 'Master profile authorization failed. Contact system administrator.' };
          }

          setSession(authData.session);
          setProfile(prof);
          void logEvent(authData.user.id, prof.full_name, 'master', 'auth', 'login', 'success', 'Master authenticated via Supabase Auth');
          return { error: null };
        }

        // ── 2. ADMIN LOGIN ──────────────────────────────────────────
        // Authenticates against GoTrue with Admin credentials.
        // Also checks Master PIN if Master oversight is invoked on the Admin screen.
        if (role === 'owner') {
          const adminEmail = `admin.${userId}@distrotrack.local`;
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: adminEmail,
            password: cleanPin,
          });

          if (!authError && authData.session && authData.user) {
            const prof = await fetchProfileForUser(authData.user);
            if (!prof || prof.role !== 'owner') {
              await supabase.auth.signOut();
              return { error: 'Admin profile authorization failed.' };
            }
            setSession(authData.session);
            setProfile(prof);
            void logEvent(authData.user.id, prof.full_name, 'owner', 'auth', 'login', 'success', 'Admin authenticated via Supabase Auth');
            return { error: null };
          }

          // If Admin PIN didn't match, check if Master PIN was used on Admin screen
          const { data: masterData, error: masterError } = await supabase.auth.signInWithPassword({
            email: 'master@distrotrack.local',
            password: cleanPin,
          });

          if (!masterError && masterData.session && masterData.user) {
            const prof = await fetchProfileForUser(masterData.user);
            if (!prof || prof.role !== 'master') {
              await supabase.auth.signOut();
              return { error: 'Master profile authorization failed.' };
            }
            setSession(masterData.session);
            setProfile(prof);
            void logEvent(masterData.user.id, prof.full_name, 'master', 'auth', 'login', 'success', 'Master authenticated via Admin screen');
            return { error: null };
          }

          void logEvent(userId, 'Unknown Admin', 'owner', 'auth', 'failed_login', 'failure', 'Incorrect Admin PIN');
          return { error: 'Incorrect PIN. Please try again.' };
        }

        // ── 3. WORKER / SALESMAN LOGIN ──────────────────────────────
        // Server-side authentication via GoTrue. Plaintext PIN is NEVER queried by browser.
        if (role === 'worker') {
          const workerEmail = `worker.${userId}@distrotrack.local`;
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: workerEmail,
            password: cleanPin,
          });

          if (authError || !authData.session || !authData.user) {
            void logEvent(userId, 'Unknown Worker', 'worker', 'auth', 'failed_login', 'failure', 'Incorrect Worker PIN');
            return { error: 'Incorrect PIN. Please try again.' };
          }

          const prof = await fetchProfileForUser(authData.user);
          if (!prof || prof.role !== 'worker') {
            await supabase.auth.signOut();
            return { error: 'Worker profile authorization failed.' };
          }

          setSession(authData.session);
          setProfile(prof);
          void logEvent(authData.user.id, prof.full_name, 'worker', 'auth', 'login', 'success', 'Worker authenticated via Supabase Auth');
          return { error: null };
        }

        return { error: 'Invalid login role specified.' };
      } catch (err) {
        console.error('signInWithPin exception:', err);
        return { error: 'Connection error. Please check your network.' };
      }
    },
    []
  );

  // ── Fetch available users (public metadata only — NO credentials) ─

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

  // ── Legacy email/password methods ──────────────────────────────

  const signIn = async (email: string, password: string) => {
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
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      return { error: error?.message ?? null };
    } catch {
      return { error: 'Connection error.' };
    }
  };

  // ── Sign out ───────────────────────────────────────────────────

  const signOut = async () => {
    if (session?.user && profile) {
      void logEvent(session.user.id, profile.full_name, profile.role, 'auth', 'logout', 'success', 'User signed out');
    }

    // Clear ALL React Query cache before signing out so the next user/role
    // cannot see cached business data from the previous session.
    queryClient.clear();

    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error during signOut:', err);
    }
    setSession(null);
    setProfile(null);
  };

  const currentRole: UserRole = (profile?.role as UserRole) ?? 'owner';

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: currentRole,
        loading,
        isMockSession: false,
        isMaster: currentRole === 'master',
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
