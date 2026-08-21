import { useState, useEffect, useRef } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/app/AuthProvider';
import {
  Truck,
  ArrowLeft,
  Loader2,
  Delete,
  Building2,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  Sparkles,
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

  const handleRoleSelect = async (role: UserRole) => {
    setSelectedRole(role);
    setError('');
    setLoadingUsers(true);

    try {
      const fetchedUsers =
        role === 'owner' ? await getAvailableAdmins() : await getAvailableWorkers();

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
    return <ThreeHeroAnimation onEnter={() => setShow3DIntro(false)} />;
  }

  return (
    <div
      className="min-h-screen flex bg-gradient-to-br from-[#f8faff] via-[#f1f5f9] to-[#e8eef6] text-slate-800 antialiased"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      style={{ fontFamily: "'Inter', 'system-ui', sans-serif" }}
    >
      {/* ── Left Brand Panel (Light & Premium Luxury) ─────────────────────── */}
      <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-gradient-to-br from-white/90 via-slate-50/80 to-blue-50/50 border-r border-slate-200/80 flex-col justify-between p-12 text-slate-800 backdrop-blur-md">
        {/* Subtle grid pattern background */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

        {/* Ambient atmospheric soft glows */}
        <div className="absolute top-10 right-10 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-96 h-96 bg-indigo-200/25 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Badge */}
        <div className="relative z-10 flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200 shadow-xs text-xs font-semibold text-slate-700">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Sangamner Operations</span>
          </div>

          <button
            onClick={() => setShow3DIntro(true)}
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
          >
            ← View Overview
          </button>
        </div>

        {/* Center Hero — Sanghavi Traders prominent identity */}
        <div className="relative z-10 space-y-6 max-w-lg my-auto py-8">
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-blue-50 border border-blue-100 text-xs font-bold tracking-wider uppercase text-blue-700 mb-3">
              <Sparkles className="h-3 w-3" />
              Official FMCG Distributor
            </span>
            <h1 className="text-4xl sm:text-5xl xl:text-6xl font-black text-slate-900 tracking-tight leading-[1.06] mb-3">
              Sanghavi Traders
            </h1>
            <p className="text-sm sm:text-base text-slate-500 font-normal leading-relaxed">
              Wholesale distribution powerhouse managing end-to-end retail supply chains, route dispatches, and daily settlements.
            </p>
          </div>

          {/* Core distribution pillars */}
          <div className="flex flex-wrap gap-2 pt-1">
            {['Route Planning & Dispatch', 'Live Retail Delivery', 'SAP Picklist Sync', 'Settlements'].map((f) => (
              <span
                key={f}
                className="inline-flex items-center px-3 py-1.5 rounded-xl bg-white border border-slate-200/90 text-xs font-semibold text-slate-700 shadow-xs"
              >
                {f}
              </span>
            ))}
          </div>

          {/* Software Powered Pill */}
          <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 shadow-xs">
            <div className="h-5 w-5 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-[10px] font-black">
              D
            </div>
            <span>Powered by <strong className="text-slate-800">DistroTrack 10</strong> Enterprise DMS</span>
          </div>
        </div>

        {/* Bottom Regional & Security Line */}
        <div className="relative z-10 flex items-center justify-between text-xs text-slate-500 border-t border-slate-200/80 pt-6">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-blue-600" />
            <span>Sangamner & Surrounding Territories</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>Secure Enterprise Portal</span>
          </div>
        </div>
      </div>

      {/* ── Right Login Form ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Mobile header */}
        <div className="lg:hidden flex flex-col items-center gap-1 mb-8 text-center">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-md mb-2">
            S
          </div>
          <h2 className="text-2xl font-black text-slate-900">Sanghavi Traders</h2>
          <p className="text-xs text-slate-400">DistroTrack Distribution Portal</p>
        </div>

        {/* Login Card */}
        <div className="w-full max-w-md">
          {/* Step Header */}
          <div className="mb-6">
            {step !== 'role' && (
              <button
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-700 mb-4 transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
            )}
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {step === 'role'
                ? 'Sign In'
                : step === 'user'
                ? `Select ${selectedRole === 'owner' ? 'Admin' : 'Salesman'}`
                : 'Security PIN'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              {step === 'role'
                ? 'Choose your authorized portal profile to continue'
                : step === 'user'
                ? 'Select your verified personnel account'
                : `Authenticating verified session for ${selectedUser?.name}`}
            </p>
          </div>

          {/* Card Body */}
          <div className="bg-white rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/50 p-6 sm:p-7">
            {/* ── STEP 1: ROLE SELECTION ────────────────────────── */}
            {step === 'role' && (
              <div className="space-y-3.5">
                <button
                  onClick={() => handleRoleSelect('owner')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-2xl border-2 border-slate-200/90 hover:border-blue-600 hover:bg-blue-50/40 transition-all text-left flex items-center gap-4 cursor-pointer disabled:opacity-50"
                >
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 text-amber-400 flex items-center justify-center flex-shrink-0 shadow-md group-hover:scale-105 transition-transform">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      Distributor Admin / Owner
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                      SAP imports, routes, analytics & reconciliations
                    </div>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-slate-100 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-400 transition-colors">
                    →
                  </div>
                </button>

                <button
                  onClick={() => handleRoleSelect('worker')}
                  disabled={loadingUsers}
                  className="w-full group p-4 rounded-2xl border-2 border-slate-200/90 hover:border-blue-600 hover:bg-blue-50/40 transition-all text-left flex items-center gap-4 cursor-pointer disabled:opacity-50"
                >
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
                    <Truck className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                      Delivery Salesman
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-snug">
                      Daily drops, retail deliveries & cash/UPI collections
                    </div>
                  </div>
                  <div className="h-8 w-8 rounded-full bg-slate-100 group-hover:bg-blue-600 group-hover:text-white flex items-center justify-center text-slate-400 transition-colors">
                    →
                  </div>
                </button>

                {loadingUsers && (
                  <div className="flex items-center justify-center gap-2 py-3 text-xs text-slate-500 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span>Loading authorized accounts…</span>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 2: USER SELECT ──────────────────────────── */}
            {step === 'user' && (
              <div className="space-y-2.5">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleUserSelect(u)}
                    className="w-full p-3.5 rounded-2xl border border-slate-200 hover:border-blue-600 hover:bg-blue-50/50 transition-all text-left flex items-center gap-3.5 cursor-pointer"
                  >
                    <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">{u.name}</div>
                      {u.phone && (
                        <div className="text-xs text-slate-400 font-mono mt-0.5">{u.phone}</div>
                      )}
                    </div>
                    <span className="text-xs font-bold text-blue-600">Select →</span>
                  </button>
                ))}

                {users.length === 0 && !loadingUsers && (
                  <div className="text-center py-8 text-sm text-slate-400">
                    No active accounts found for this role.
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: PIN INPUT ────────────────────────────── */}
            {step === 'pin' && (
              <div className="space-y-5">
                {/* User badge */}
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                  <div className="h-9 w-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
                    {selectedUser?.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">{selectedUser?.name}</div>
                    <div className="text-xs text-slate-500 font-medium">
                      {selectedRole === 'owner' ? 'Administrator' : 'Salesman'}
                    </div>
                  </div>
                </div>

                {/* PIN dots */}
                <div className="flex items-center justify-center gap-4 py-3">
                  {[0, 1, 2, 3].map((idx) => {
                    const isFilled = pin.length > idx;
                    return (
                      <div
                        key={idx}
                        className={`h-3.5 w-3.5 rounded-full transition-all duration-200 ${
                          isFilled
                            ? 'bg-blue-600 scale-110 shadow-md shadow-blue-500/30 ring-4 ring-blue-100'
                            : 'bg-slate-200'
                        }`}
                      />
                    );
                  })}
                </div>

                {/* Error */}
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs text-center font-medium">
                    {error}
                  </div>
                )}

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handlePinDigit(digit)}
                      disabled={loading}
                      className="h-13 rounded-2xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 active:scale-95 text-slate-800 text-lg font-bold border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                    >
                      {digit}
                    </button>
                  ))}
                  <div />
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    disabled={loading}
                    className="h-13 rounded-2xl bg-slate-50 hover:bg-blue-50 hover:text-blue-700 active:scale-95 text-slate-800 text-lg font-bold border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center shadow-xs"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    disabled={loading || pin.length === 0}
                    className="h-13 rounded-2xl bg-slate-50 hover:bg-red-50 hover:text-red-500 active:scale-95 text-slate-400 border border-slate-200/80 transition-all cursor-pointer flex items-center justify-center disabled:opacity-30"
                  >
                    <Delete className="h-5 w-5" />
                  </button>
                </div>

                {loading && (
                  <div className="flex items-center justify-center gap-2 text-xs text-blue-600 font-medium py-1">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Verifying security credentials…</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer note */}
          <div className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400 mt-6">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            <span>Authorized Enterprise Access • Sanghavi Traders</span>
          </div>
        </div>
      </div>
    </div>
  );
}
