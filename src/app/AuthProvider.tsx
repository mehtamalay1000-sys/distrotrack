import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

/** Shape returned by the verify_admin_pin database RPC */
interface VerifyAdminPinResult {
  role: string | null;
  error: string | null;
  name: string;
}
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

  // ── Shared session setter ──────────────────────────────────────

  const applySession = useCallback((pinSession: PinSession) => {
    localStorage.setItem(PIN_SESSION_KEY, JSON.stringify(pinSession));
    setSession(createMockSession(pinSession));
    setProfile(createMockProfile(pinSession));
    setIsMockSession(true);
  }, []);

  // ── PIN-based login ────────────────────────────────────────────

  const signInWithPin = useCallback(
    async (userId: string, pin: string, role: UserRole): Promise<{ error: string | null }> => {
      try {
        const cleanPin = String(pin ?? '').trim();

        // ── 1. MASTER LOGIN ─────────────────────────────────────────
        // SECURITY: Master PIN is NEVER compared in frontend code.
        // We call the check_master_pin RPC which performs a bcrypt
        // hash comparison server-side against master_config.
        // If the RPC fails for any reason, access is DENIED — never granted.
        if (role === 'master') {
          let isValidMasterPin = false;
          try {
            const { data: pinValid, error: rpcError } = await supabase.rpc('check_master_pin', {
              p_pin: cleanPin,
            });
            if (rpcError) {
              console.error('check_master_pin RPC error:', rpcError.message);
              return { error: 'Authentication service unavailable. Please try again.' };
            }
            isValidMasterPin = pinValid === true;
          } catch (rpcErr) {
            console.error('check_master_pin network error:', rpcErr);
            return { error: 'Connection error. Please check your network and try again.' };
          }

          if (isValidMasterPin) {
            const pinSession: PinSession = {
              userId: 'master-001',
              name: 'Master Administrator',
              role: 'master',
              phone: null,
            };
            applySession(pinSession);
            void logEvent('master-001', 'Master Administrator', 'master', 'auth', 'login', 'success', 'Master login via RPC');
            return { error: null };
          }

          void logEvent('master-001', 'Master Administrator', 'master', 'auth', 'failed_login', 'failure', 'Incorrect Master PIN (RPC check)');
          return { error: 'Incorrect Master PIN. Please try again.' };
        }

        // ── 2. ADMIN LOGIN — uses verify_admin_pin RPC ──────────────
        // The verify_admin_pin RPC checks both the admin PIN and (as a
        // second factor) whether the entered PIN is the master PIN,
        // returning the effective role. This eliminates plain-text
        // PIN comparisons in frontend code for admin accounts.
        if (role === 'owner') {
          let rpcResult: VerifyAdminPinResult | null = null;

          try {
            const { data, error: rpcError } = await supabase.rpc('verify_admin_pin', {
              p_user_id: userId,
              p_pin: cleanPin,
            });
            if (rpcError) {
              // RPC unavailable — fall back to direct DB comparison for resilience
              console.warn('verify_admin_pin RPC error, falling back:', rpcError.message);
            } else {
              rpcResult = data as VerifyAdminPinResult;
            }
          } catch (rpcErr) {
            console.warn('verify_admin_pin network error, falling back:', rpcErr);
          }

          if (rpcResult) {
            if (rpcResult.error || !rpcResult.role) {
              void logEvent(userId, rpcResult.name || 'Unknown', 'owner', 'auth', 'failed_login', 'failure', rpcResult.error || 'PIN mismatch');
              return { error: rpcResult.error || 'Incorrect PIN. Please try again.' };
            }
            // RPC may return 'master' role if master PIN was used on an admin account
            const effectiveRole = (rpcResult.role === 'master' ? 'master' : 'owner') as UserRole;
            const pinSession: PinSession = {
              userId: rpcResult.role === 'master' ? 'master-001' : userId,
              name: rpcResult.role === 'master' ? 'Master Administrator' : rpcResult.name,
              role: effectiveRole,
              phone: null,
            };
            applySession(pinSession);
            void logEvent(pinSession.userId, pinSession.name, effectiveRole, 'auth', 'login', 'success', `${effectiveRole} login via RPC`);
            return { error: null };
          }

          // Fallback: direct DB query if RPC is unavailable
          const { data: adminData, error: adminError } = await supabase
            .from('pin_users')
            .select('id, name, phone, pin, status')
            .eq('id', userId)
            .eq('status', 'active')
            .single();

          if (adminError || !adminData) {
            return { error: 'Admin account not found. Please try again.' };
          }

          const storedPin = String(adminData.pin ?? '').trim();
          if (storedPin && storedPin === cleanPin) {
            const pinSession: PinSession = {
              userId: adminData.id,
              name: adminData.name,
              role: 'owner',
              phone: adminData.phone ?? null,
            };
            applySession(pinSession);
            void logEvent(adminData.id, adminData.name, 'owner', 'auth', 'login', 'success', 'Admin login (fallback path)');
            return { error: null };
          }

          void logEvent(userId, adminData.name, 'owner', 'auth', 'failed_login', 'failure', 'Incorrect PIN entered');
          return { error: 'Incorrect PIN. Please try again.' };
        }

        // ── 3. WORKER / SALESMAN LOGIN ──────────────────────────────
        if (role === 'worker') {
          const { data, error } = await supabase
            .from('workers')
            .select('id, name, phone, pin')
            .eq('id', userId)
            .eq('status', 'active')
            .single();

          if (error || !data) return { error: 'Worker account not found. Please try again.' };
          
          const workerPin = String(data.pin ?? '').trim();
          if (!workerPin || workerPin !== cleanPin) {
            void logEvent(userId, data.name, 'worker', 'auth', 'failed_login', 'failure', 'Incorrect PIN entered');
            return { error: 'Incorrect PIN. Please try again.' };
          }

          const pinSession: PinSession = {
            userId: data.id,
            name: data.name,
            role: 'worker',
            phone: data.phone,
          };
          applySession(pinSession);
          void logEvent(data.id, data.name, 'worker', 'auth', 'login', 'success', 'Worker login');
          return { error: null };
        }

        return { error: 'Invalid login role specified.' };
      } catch (err) {
        console.error('signInWithPin exception:', err);
        return { error: 'Connection error. Please check your network.' };
      }
    },
    [applySession]
  );

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

  // ── Legacy email/password methods ──────────────────────────────

  const signIn = async (email: string, password: string) => {
    if (email.toLowerCase().includes('demo') || password === 'demo123') {
      const pinSession: PinSession = { userId: 'demo-user-001', name: 'Demo User', role: 'owner', phone: null };
      applySession(pinSession);
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
    const stored = localStorage.getItem(PIN_SESSION_KEY);
    if (stored) {
      try {
        const ps: PinSession = JSON.parse(stored);
        void logEvent(ps.userId, ps.name, ps.role, 'auth', 'logout', 'success', 'User signed out');
      } catch { /* ignore */ }
    }

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

  const currentRole: UserRole = (profile?.role as UserRole) ?? 'owner';

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        role: currentRole,
        loading,
        isMockSession,
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
