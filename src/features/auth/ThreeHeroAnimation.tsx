import { useState, useEffect } from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Truck,
  Warehouse,
  ClipboardList,
  Store,
  Wallet,
  BarChart3,
  Sparkles,
  Zap,
  Activity,
  Building2,
  Compass,
  ArrowUpRight,
} from 'lucide-react';
import { ThreeHeroCanvas, ROUTE_NODES } from './components/ThreeHeroCanvas';

interface ThreeHeroAnimationProps {
  onEnter: () => void;
  onQuickRoleSelect?: (role: 'owner' | 'worker') => void;
}

export function ThreeHeroAnimation({ onEnter, onQuickRoleSelect }: ThreeHeroAnimationProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [isHoveringCanvas, setIsHoveringCanvas] = useState(false);

  // Auto cycle active step every 7s if not hovering
  useEffect(() => {
    if (isHoveringCanvas) return;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % ROUTE_NODES.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [isHoveringCanvas]);

  const workflowSteps = [
    {
      step: 0,
      title: 'Master FMCG Depot',
      subtitle: 'Centralized Stock & Pallet Hub',
      icon: Warehouse,
      desc: 'Real-time Colgate master inventory control with automated loading dock verification and high-speed pallet staging.',
      stat: '99.9% Dispatch Accuracy',
      color: 'from-blue-500 to-indigo-600',
      badge: 'Step 01 • Inventory',
    },
    {
      step: 1,
      title: 'SAP Digital Batching',
      subtitle: 'Instant PDF Picklist Engine',
      icon: ClipboardList,
      desc: 'Parses complex multi-page SAP sales invoices, auto-matching rates, free Colgate scheme quantities, and SKU codes.',
      stat: '0 Paper Entry Errors',
      color: 'from-indigo-500 to-purple-600',
      badge: 'Step 02 • Digitization',
    },
    {
      step: 2,
      title: 'Smart Driver Dispatch',
      subtitle: 'Optimized Sangamner & Akole Routes',
      icon: Truck,
      desc: 'Sequences party drops in the optimal road path for delivery salesmen, reducing travel duration and fuel overhead.',
      stat: '42% Faster Turnaround',
      color: 'from-sky-500 to-blue-600',
      badge: 'Step 03 • Logistics',
    },
    {
      step: 3,
      title: 'Retail Store Drop-off',
      subtitle: 'Mobile Proof of Delivery',
      icon: Store,
      desc: 'Drivers confirm quantities at shop counter, print bills, note damages, and obtain customer sign-off in real time.',
      stat: '100% On-Time Drops',
      color: 'from-emerald-500 to-teal-600',
      badge: 'Step 04 • Fulfillment',
    },
    {
      step: 4,
      title: 'Instant Reconciliation',
      subtitle: 'Cash, UPI & Cheque Split',
      icon: Wallet,
      desc: 'Instant settlement for every stop with automated ledger updates, cheque tracking, and dynamic Udhari balances.',
      stat: 'Zero Cash Leakage',
      color: 'from-amber-500 to-orange-600',
      badge: 'Step 05 • Collections',
    },
    {
      step: 5,
      title: 'Executive Intelligence',
      subtitle: 'Live Margins & Driver Velocity',
      icon: BarChart3,
      desc: 'Owner dashboard provides real-time visibility into route collections, driver targets, and product margin velocity.',
      stat: 'Real-Time ROI Analytics',
      color: 'from-purple-500 to-pink-600',
      badge: 'Step 06 • Analytics',
    },
  ];

  const currentStepData = workflowSteps[activeStep];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8faff] via-[#f1f5f9] to-[#ffffff] text-slate-800 antialiased selection:bg-blue-100 selection:text-blue-900 font-sans">
      {/* ── Top Navigation Bar ────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 text-white font-black text-lg">
              D
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-slate-900 text-base tracking-tight">DistroTrack</span>
                <span className="text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  ERP 2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                FMCG Distribution & Route Logistics
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Live System Status Pill */}
            <div className="hidden md:flex items-center gap-2 bg-emerald-50 border border-emerald-200/60 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full shadow-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Sangamner & Akole Fleet Live</span>
            </div>

            {/* Launch Access Portal Button */}
            <button
              onClick={onEnter}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/35 transition-all cursor-pointer transform active:scale-98"
            >
              <span>Access Portal</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero Section with Integrated 3D Interactive Canvas ──────── */}
      <section className="relative overflow-hidden pt-8 pb-16 lg:pt-12 lg:pb-24">
        {/* Soft Ambient Background Glows */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] pointer-events-none -z-10 overflow-hidden">
          <div className="absolute -top-32 left-1/4 w-[500px] h-[500px] bg-blue-200/40 rounded-full blur-3xl" />
          <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-indigo-200/35 rounded-full blur-3xl" />
          <div className="absolute top-40 left-1/2 w-[350px] h-[350px] bg-emerald-200/25 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header Typography */}
          <div className="text-center max-w-3xl mx-auto mb-8">
            <div className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-blue-200/60 px-4 py-1.5 rounded-full text-xs font-bold text-blue-700 shadow-xs mb-4">
              <Sparkles className="h-3.5 w-3.5 text-blue-600" />
              <span>Real-Time FMCG Distribution Engine</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-slate-900 tracking-tight leading-[1.15]">
              Distribute Faster.{' '}
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-600 bg-clip-text text-transparent">
                Reconcile Flawlessly.
              </span>
            </h1>

            <p className="mt-4 text-base sm:text-lg text-slate-600 font-normal leading-relaxed max-w-2xl mx-auto">
              Digitize SAP picklists in seconds, dispatch drivers on optimized routes, and reconcile 100% of cash & UPI collections with zero paper leakage.
            </p>

            {/* Quick Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => {
                  if (onQuickRoleSelect) onQuickRoleSelect('owner');
                  else onEnter();
                }}
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold shadow-lg shadow-slate-900/15 hover:shadow-xl transition-all cursor-pointer transform active:scale-98"
              >
                <Building2 className="h-4 w-4 text-amber-400" />
                <span>Distributor Admin Login</span>
              </button>

              <button
                onClick={() => {
                  if (onQuickRoleSelect) onQuickRoleSelect('worker');
                  else onEnter();
                }}
                className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white hover:bg-slate-50 text-blue-700 border border-slate-200 shadow-sm hover:shadow-md text-sm font-bold transition-all cursor-pointer transform active:scale-98"
              >
                <Truck className="h-4 w-4 text-blue-600" />
                <span>Salesman Delivery Portal</span>
              </button>
            </div>
          </div>

          {/* ── 3D Interactive Canvas Showcase Container ────────────── */}
          <div
            className="relative bg-gradient-to-b from-white/95 to-slate-50/90 rounded-3xl border border-slate-200/90 shadow-2xl shadow-blue-500/5 overflow-hidden backdrop-blur-sm"
            onMouseEnter={() => setIsHoveringCanvas(true)}
            onMouseLeave={() => setIsHoveringCanvas(false)}
          >
            {/* Top Canvas Bar Info */}
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
              {/* Focused Station Pill */}
              <div className="pointer-events-auto bg-white/90 backdrop-blur-md border border-slate-200 shadow-sm px-4 py-2 rounded-2xl flex items-center gap-3">
                <div className="h-8 w-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xs">
                  {activeStep + 1}
                </div>
                <div>
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                    {currentStepData.badge}
                  </div>
                  <div className="text-sm font-extrabold text-slate-900">
                    {currentStepData.title}
                  </div>
                </div>
              </div>

              {/* Interaction Hint */}
              <div className="hidden sm:flex items-center gap-1.5 bg-white/90 backdrop-blur-md border border-slate-200 shadow-sm px-3 py-1.5 rounded-full text-xs font-semibold text-slate-600">
                <Compass className="h-3.5 w-3.5 text-blue-600 animate-spin" style={{ animationDuration: '8s' }} />
                <span>Drag to Rotate • Click Stage to Fly</span>
              </div>
            </div>

            {/* 3D WebGL Canvas */}
            <div className="w-full h-[420px] sm:h-[500px] lg:h-[540px]">
              <ThreeHeroCanvas activeStep={activeStep} onStepChange={setActiveStep} />
            </div>

            {/* Bottom Station Navigation Bar */}
            <div className="p-4 bg-white/95 border-t border-slate-200/80 backdrop-blur-md">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {workflowSteps.map((step, idx) => {
                  const Icon = step.icon;
                  const isActive = activeStep === idx;
                  return (
                    <button
                      key={step.step}
                      onClick={() => setActiveStep(idx)}
                      className={`p-3 rounded-2xl text-left transition-all cursor-pointer flex flex-col justify-between border ${
                        isActive
                          ? 'bg-blue-50/90 border-blue-400 shadow-sm ring-2 ring-blue-500/20'
                          : 'bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isActive ? 'text-blue-700' : 'text-slate-400'}`}>
                          0{idx + 1}
                        </span>
                        <div className={`h-6 w-6 rounded-lg flex items-center justify-center ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                      </div>
                      <div className={`text-xs font-bold truncate ${isActive ? 'text-blue-950' : 'text-slate-700'}`}>
                        {step.title}
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {step.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Step Description Card */}
              <div className="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-200/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold flex-shrink-0 shadow-xs">
                    <Activity className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      {currentStepData.title} — {currentStepData.subtitle}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {currentStepData.desc}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-100/80 border border-emerald-200 px-3 py-1 rounded-full">
                    {currentStepData.stat}
                  </span>
                  <button
                    onClick={onEnter}
                    className="p-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
                    title="Launch Portal"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Key Operational Metric Cards ───────────────────────── */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-10 w-10 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold mb-4 shadow-xs">
                <Zap className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mb-1">
                Instant SAP Batch Import
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Drop your SAP Sales export or Picklist PDF. The system automatically reads customer codes, invoice totals, and line items in 1.2 seconds.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-10 w-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold mb-4 shadow-xs">
                <Truck className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mb-1">
                Field Driver App & Live GPS
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Salesmen follow assigned route stops on their mobile phone, log store deliveries, and accept Cash or UPI payments on location.
              </p>
            </div>

            <div className="p-6 rounded-3xl bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold mb-4 shadow-xs">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="text-base font-extrabold text-slate-900 mb-1">
                100% Cash Reconciliation
              </h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Real-time collection ledgers cross-verify salesman cash-in-hand against invoice delivery totals, preventing revenue leakage.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200/80 bg-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">DistroTrack Enterprise</span>
            <span>• Built for High-Volume FMCG Operations</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={onEnter} className="hover:text-blue-600 font-semibold cursor-pointer">
              Launch Login Portal
            </button>
            <span>•</span>
            <span>Sangamner & Akole Region</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
