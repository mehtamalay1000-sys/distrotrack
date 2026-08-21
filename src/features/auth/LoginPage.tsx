import { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import {
  Truck,
  ArrowLeft,
  Loader2,
  Delete,
  Building2,
  KeyRound,
  Compass,
} from 'lucide-react';
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

  useEffect(() => {
    if (step === 'pin') {
      setTimeout(() => pinInputRef.current?.focus(), 100);
    }
  }, [step]);

  if (session) return <Navigate to="/" replace />;

  const handleQuickRoleSelect = async (role: UserRole) => {
    setShow3DIntro(false);
    handleRoleSelect(role);
  };

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
        setSelectedUser(fetchedUsers[0]);
        setStep('pin');
      } else if (fetchedUsers.length === 0) {
        setError(`No ${role === 'owner' ? 'admin' : 'salesman'} accounts found.`);
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
    setPin((prev) => prev.slice(0, -1));
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (step !== 'pin' || loading) return;
    if (/^\d$/.test(e.key)) {
      handlePinDigit(e.key);
    } else if (e.key === 'Backspace') {
      handlePinBackspace();
    }
  };

  if (show3DIntro) {
    return (
      <ThreeHeroAnimation
        onEnter={() => setShow3DIntro(false)}
        onQuickRoleSelect={handleQuickRoleSelect}
      />
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-[#f8faff] via-[#f1f5f9] to-[#ffffff] flex flex-col justify-between p-4 sm:p-6 text-slate-800 antialiased font-sans"
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Top Header */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-extrabold shadow-md shadow-blue-500/20 text-sm">
            D
          </div>
          <span className="font-extrabold text-slate-900 text-sm tracking-tight">DistroTrack ERP</span>
        </div>

        <button
          onClick={() => setShow3DIntro(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:border-blue-300 shadow-xs hover:shadow-sm transition-all cursor-pointer"
        >
          <Compass className="h-3.5 w-3.5 text-blue-600" />
          <span>3D Operations View</span>
        </button>
      </header>

      {/* Main Login Card */}
      <main className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-white/95 backdrop-blur-md rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/50 overflow-hidden">
          {/* Card Header */}
          <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold shadow-xs">
                {selectedRole === 'owner' ? (
                  <Building2 className="h-5 w-5" />
                ) : selectedRole === 'worker' ? (
                  <Truck className="h-5 w-5" />
                ) : (
                  <KeyRound className="h-5 w-5" />
                )}
              </div>
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {step === 'role'
                    ? 'Select Portal Role'
                    : step === 'user'
                    ? `Select ${selectedRole === 'owner' ? 'Admin' : 'Salesman'}`
                    : `Enter Security PIN`}
                </h2>
                <p className="text-xs text-slate-500">
                  {step === 'role'
                    ? 'Choose your role to access the workspace'
                    : step === 'user'
                    ? 'Select your verified personnel profile'
                    : `Signing in as ${selectedUser?.name}`}
                </p>
              </div>
            </div>

            {step !== 'role' && (
              <button
                onClick={handleBack}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                title="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="p-6">
            {/* ── STEP 1: ROLE SELECTION ──────────────────────────────── */}
            {step === 'role' && (
              <div className="space-y-3">
                <button
                  onClick={() => handleRoleSelect('owner')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-2xl border-2 border-slate-200/90 hover:border-blue-500 hover:bg-blue-50/40 transition-all text-left flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 text-amber-400 flex items-center justify-center shadow-md shadow-slate-900/10">
                      <Building2 className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        Distributor Admin / Owner
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        SAP import, routes, reports & settlements
                      </div>
                    </div>
                  </div>
                  <div className="h-7 w-7 rounded-full bg-slate-100 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-400 transition-colors">
                    →
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('worker')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-2xl border-2 border-slate-200/90 hover:border-blue-500 hover:bg-blue-50/40 transition-all text-left flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                      <Truck className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                        Delivery Salesman
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Daily route drops, cash & UPI collections
                      </div>
                    </div>
                  </div>
                  <div className="h-7 w-7 rounded-full bg-slate-100 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-400 transition-colors">
                    →
                  </div>
                </button>

                {loadingUsers && (
                  <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span>Loading personnel accounts…</span>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: USER SELECT ─────────────────────────────────── */}
            {step === 'user' && (
              <div className="space-y-2.5">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleUserSelect(u)}
                    className="w-full p-3.5 rounded-2xl border border-slate-200/90 hover:border-blue-500 hover:bg-blue-50/50 transition-all text-left flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{u.name}</div>
                        <div className="text-xs text-slate-400 font-mono">{u.phone || 'Sales personnel'}</div>
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-blue-600">Select →</span>
                  </button>
                ))}

                {users.length === 0 && !loadingUsers && (
                  <div className="text-center py-6 text-xs text-slate-400">
                    No accounts found for this role.
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: TACTILE PIN PAD ─────────────────────────────── */}
            {step === 'pin' && (
              <div className="space-y-5">
                {/* 4-Digit Indicator */}
                <div className="flex items-center justify-center gap-3 py-2">
                  {[0, 1, 2, 3].map((idx) => {
                    const isFilled = pin.length > idx;
                    return (
                      <div
                        key={idx}
                        className={`h-4 w-4 rounded-full transition-all duration-200 ${
                          isFilled
                            ? 'bg-blue-600 scale-110 shadow-sm shadow-blue-500/40 ring-4 ring-blue-100'
                            : 'bg-slate-200'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs text-center font-semibold animate-shake">
                    {error}
                  </div>
                )}

                {/* Numeric Keypad */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[280px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handlePinDigit(digit)}
                      disabled={loading}
                      className="h-14 rounded-2xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 active:scale-95 text-slate-800 text-lg font-bold border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={loading}
                    className="h-14 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-400 text-xs font-semibold border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    disabled={loading}
                    className="h-14 rounded-2xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 active:scale-95 text-slate-800 text-lg font-bold border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    disabled={loading || pin.length === 0}
                    className="h-14 rounded-2xl bg-slate-50 hover:bg-red-50 hover:text-red-600 active:scale-95 text-slate-500 border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center"
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                </div>

                {loading && (
                  <div className="flex items-center justify-center gap-2 text-xs text-blue-600 font-semibold py-1">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying credentials…</span>
                  </div>
                )}

                <div className="text-center text-[11px] text-slate-400 font-medium">
                  Default PIN: <strong className="text-slate-600">1234</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-2 text-xs text-slate-400">
        DistroTrack 10 • Enterprise Distribution Cloud
      </footer>
    </div>
  );
}
