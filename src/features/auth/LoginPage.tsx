import { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import { Shield, Truck, ArrowLeft, User, Loader2, Delete, Sparkles } from 'lucide-react';
import type { UserRole } from '@/lib/database.types';
import { ThreeHeroAnimation } from './ThreeHeroAnimation';

type LoginStep = 'role' | 'user' | 'pin';

interface SelectableUser {
  id: string;
  name: string;
  phone: string | null;
}

export function LoginPage() {
  const { session, signInWithPin, getAvailableWorkers, getAvailableAdmins } = useAuth();
  const navigate = useNavigate();

  const [show3DIntro, setShow3DIntro] = useState(true);
  const [step, setStep] = useState<LoginStep>('role');
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<SelectableUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const pinInputRef = useRef<HTMLInputElement>(null);

  // Focus PIN input on step change
  useEffect(() => {
    if (step === 'pin') {
      setTimeout(() => pinInputRef.current?.focus(), 100);
    }
  }, [step]);

  if (session) return <Navigate to="/" replace />;

  if (show3DIntro) {
    return <ThreeHeroAnimation onEnter={() => setShow3DIntro(false)} />;
  }

  const handleRoleSelect = async (role: UserRole) => {
    setSelectedRole(role);
    setError('');
    setLoadingUsers(true);

    try {
      const fetchedUsers = role === 'owner'
        ? await getAvailableAdmins()
        : await getAvailableWorkers();

      setUsers(fetchedUsers);

      if (fetchedUsers.length === 1) {
        // Auto-select if only one user
        setSelectedUser(fetchedUsers[0]);
        setStep('pin');
      } else if (fetchedUsers.length === 0) {
        setError(`No ${role === 'owner' ? 'admin' : 'salesman'} accounts found. Please contact your administrator.`);
        setStep('user');
      } else {
        setStep('user');
      }
    } catch {
      setError('Failed to load users. Please try again.');
      setStep('user');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleUserSelect = (user: SelectableUser) => {
    setSelectedUser(user);
    setPin('');
    setError('');
    setStep('pin');
  };

  const handlePinDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length === 4) {
      submitPin(newPin);
    }
  };

  const handlePinBackspace = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const submitPin = async (pinValue: string) => {
    if (!selectedUser || !selectedRole) return;
    setLoading(true);
    setError('');

    const result = await signInWithPin(selectedUser.id, pinValue, selectedRole);

    if (result.error) {
      setError(result.error);
      setPin('');
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  const handleBack = () => {
    setError('');
    if (step === 'pin') {
      setPin('');
      if (users.length === 1) {
        setStep('role');
        setSelectedRole(null);
        setSelectedUser(null);
      } else {
        setStep('user');
        setSelectedUser(null);
      }
    } else if (step === 'user') {
      setStep('role');
      setSelectedRole(null);
      setSelectedUser(null);
      setUsers([]);
    }
  };

  // Handle physical keyboard input for PIN
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (step !== 'pin' || loading) return;
    if (/^\d$/.test(e.key)) {
      handlePinDigit(e.key);
    } else if (e.key === 'Backspace') {
      handlePinBackspace();
    }
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-surface-50 via-primary-50/30 to-surface-100 dark:from-surface-950 dark:via-primary-950/20 dark:to-surface-900 flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8 relative">
          <button
            onClick={() => setShow3DIntro(true)}
            className="absolute right-0 top-0 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-full flex items-center gap-1 hover:scale-105 transition-transform shadow-xs"
          >
            <Sparkles className="h-3 w-3 text-blue-500 animate-spin" />
            3D Intro
          </button>

          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 mb-4 p-2 shadow-lg">
            <img src="/distrotrack_logo.png" alt="DistroTrack Logo" className="h-full w-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white tracking-tight">DistroTrack</h1>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">Distribution Management System</p>
        </div>

        {/* Main Card */}
        <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-xl shadow-surface-900/5 dark:shadow-black/20 overflow-hidden">

          {/* Back button header (visible on step 2 & 3) */}
          {step !== 'role' && (
            <div className="px-5 pt-4 pb-0">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-sm text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            </div>
          )}

          <div className="p-6">
            {/* ── Step 1: Role Selection ──────────────────────────── */}
            {step === 'role' && (
              <div className="space-y-4">
                <div className="text-center mb-2">
                  <h2 className="text-base font-semibold text-surface-900 dark:text-white">Welcome Back</h2>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Choose your role to continue</p>
                </div>

                <button
                  onClick={() => handleRoleSelect('owner')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-xl border-2 border-surface-200 dark:border-surface-700 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-950/30 transition-all duration-200 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/40 transition-shadow">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold text-surface-900 dark:text-white text-sm">Admin / Owner</div>
                      <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Full access to all features</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('worker')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-xl border-2 border-surface-200 dark:border-surface-700 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-950/30 transition-all duration-200 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:shadow-blue-500/40 transition-shadow">
                      <Truck className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <div className="font-semibold text-surface-900 dark:text-white text-sm">Salesman</div>
                      <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Routes, sales, target progress & collections</div>
                    </div>
                  </div>
                </button>

                {loadingUsers && (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-surface-500 dark:text-surface-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading accounts…
                  </div>
                )}
              </div>
            )}

            {/* ── Step 2: User Selection ─────────────────────────── */}
            {step === 'user' && (
              <div className="space-y-3">
                <div className="text-center mb-2">
                  <h2 className="text-base font-semibold text-surface-900 dark:text-white">
                    Select {selectedRole === 'owner' ? 'Admin' : 'Salesman'}
                  </h2>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">Choose your account</p>
                </div>

                {users.length > 0 ? (
                  <div className="space-y-2">
                    {users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleUserSelect(user)}
                        className="w-full p-3.5 rounded-xl border border-surface-200 dark:border-surface-700 hover:border-primary-400 dark:hover:border-primary-500 hover:bg-primary-50/50 dark:hover:bg-primary-950/30 transition-all duration-200 text-left flex items-center gap-3"
                      >
                        <div className="h-10 w-10 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center">
                          <User className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-surface-900 dark:text-white truncate">{user.name}</div>
                          {user.phone && (
                            <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{user.phone}</div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <User className="h-10 w-10 mx-auto text-surface-300 dark:text-surface-600 mb-2" />
                    <p className="text-sm text-surface-500 dark:text-surface-400">No accounts found</p>
                  </div>
                )}
              </div>
            )}

            {/* ── Step 3: PIN Entry ──────────────────────────────── */}
            {step === 'pin' && selectedUser && (
              <div className="space-y-5">
                {/* Selected user info */}
                <div className="text-center">
                  <div className="h-14 w-14 rounded-full bg-primary-100 dark:bg-primary-900/50 flex items-center justify-center mx-auto mb-3">
                    <span className="text-xl font-bold text-primary-600 dark:text-primary-400">
                      {selectedUser.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <h2 className="text-base font-semibold text-surface-900 dark:text-white">{selectedUser.name}</h2>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">Enter your 4-digit PIN</p>
                </div>

                {/* PIN dots */}
                <div className="flex items-center justify-center gap-3">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`h-4 w-4 rounded-full transition-all duration-200 ${
                        i < pin.length
                          ? 'bg-primary-600 dark:bg-primary-400 scale-110 shadow-md shadow-primary-500/30'
                          : 'bg-surface-200 dark:bg-surface-700'
                      }`}
                    />
                  ))}
                </div>

                {/* Hidden input for physical keyboard */}
                <input
                  ref={pinInputRef}
                  type="text"
                  inputMode="numeric"
                  className="sr-only"
                  autoFocus
                  value={pin}
                  onChange={() => {}}
                />

                {/* Error */}
                {error && (
                  <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 text-center">
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
                  </div>
                )}

                {/* Numeric keypad */}
                <div className="grid grid-cols-3 gap-2 max-w-[240px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) => {
                    if (key === '') return <div key="empty" />;
                    if (key === 'del') {
                      return (
                        <button
                          key="del"
                          onClick={handlePinBackspace}
                          disabled={loading || pin.length === 0}
                          className="h-14 rounded-xl flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors disabled:opacity-30"
                        >
                          <Delete className="h-5 w-5" />
                        </button>
                      );
                    }
                    return (
                      <button
                        key={key}
                        onClick={() => handlePinDigit(key)}
                        disabled={loading || pin.length >= 4}
                        className="h-14 rounded-xl text-lg font-semibold text-surface-900 dark:text-white hover:bg-surface-100 dark:hover:bg-surface-700 active:bg-primary-100 dark:active:bg-primary-900/50 active:text-primary-700 dark:active:text-primary-300 transition-colors disabled:opacity-30 select-none"
                      >
                        {key}
                      </button>
                    );
                  })}
                </div>

                {loading && (
                  <div className="flex items-center justify-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying PIN…
                  </div>
                )}
              </div>
            )}

            {/* Global error for step 1 and 2 */}
            {error && step !== 'pin' && (
              <div className="mt-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2 text-center">
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-surface-400 dark:text-surface-600 mt-6">
          DistroTrack v10 • Distribution Management
        </p>
      </div>
    </div>
  );
}
