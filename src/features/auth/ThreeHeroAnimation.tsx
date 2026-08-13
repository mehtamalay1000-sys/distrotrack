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
  Lock,
  Sparkles,
  Zap,
  ChevronRight,
  TrendingUp,
  PackageCheck,
  ShieldAlert,
} from 'lucide-react';
import { ThreeHeroCanvas } from './components/ThreeHeroCanvas';

interface ThreeHeroAnimationProps {
  onEnter: () => void;
}

export function ThreeHeroAnimation({ onEnter }: ThreeHeroAnimationProps) {
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setIsReducedMotion(mediaQuery.matches);
    const listener = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  const triggerAccessPortal = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      onEnter();
    }, 400);
  };

  const scrollToWorkflow = () => {
    document.getElementById('workflow-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const workflowSteps = [
    {
      step: 0,
      title: 'Warehouse',
      subtitle: 'Inventory & Dispatch Hub',
      icon: Warehouse,
      desc: 'Centralized Colgate stock control with real-time pallet tracking and automated loading dock assignment.',
      stat: '99.8% Inventory Accuracy',
    },
    {
      step: 1,
      title: 'Picklist',
      subtitle: 'Digital SAP Batching',
      icon: ClipboardList,
      desc: 'Instant SAP picklist digitization, categorizing toothpastes, toothbrushes, and promotional free scheme items.',
      stat: '0 Paper Manual Errors',
    },
    {
      step: 2,
      title: 'Delivery Route',
      subtitle: 'Smart Driver Dispatch',
      icon: Truck,
      desc: 'AI-assisted route sequence planning optimized for Sangamner & Akole distributor drops.',
      stat: '42% Faster Delivery Cycles',
    },
    {
      step: 3,
      title: 'Retail Stores',
      subtitle: 'Proof of Delivery',
      icon: Store,
      desc: 'On-site mobile verification with live quantity adjustments and digital party sign-off.',
      stat: '18+ Store Drop-offs Daily',
    },
    {
      step: 4,
      title: 'Payments',
      subtitle: 'Cash & UPI Reconciliation',
      icon: Wallet,
      desc: 'Instant collection ledger entry with QR UPI receipts, cash bag tracking, and zero payment leakage.',
      stat: '100% Cash Reconciliation',
    },
    {
      step: 5,
      title: 'Analytics',
      subtitle: 'Executive Intelligence',
      icon: BarChart3,
      desc: 'Real-time sales velocity graphs, salesman performance leaderboards, and margin analytics.',
      stat: 'Live ROI & Margin Reports',
    },
  ];

  return (
    <div
      className={`relative w-full min-h-screen bg-[#f8fafc] text-slate-900 font-sans select-none flex flex-col justify-between transition-all duration-500 ${
        isTransitioning ? 'opacity-0 scale-95 blur-md' : 'opacity-100 scale-100'
      }`}
    >
      {/* ── 1. CLEAN ELEGANT HEADER BAR ─────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-200/80 px-6 md:px-12 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
          
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-100 border border-slate-200 p-1 flex items-center justify-center shadow-2xs">
              <img src="/distrotrack_logo.png" alt="DistroTrack Logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-xl tracking-tight text-slate-900">DistroTrack</span>
                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 rounded-full">
                  v10.0 Enterprise
                </span>
              </div>
              <p className="text-[11px] font-semibold text-slate-500 -mt-0.5">
                Powered by <span className="text-slate-800 font-bold">Sanghavi Traders</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200/80 text-xs font-semibold text-slate-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>All Distribution Systems Operational</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── 2. HERO SECTION WITH 3D WEBGL LOGISTICS CANVAS ───────────────────── */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 py-10 w-full grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        
        {/* LEFT COLUMN: HERO HEADLINE & CTAS */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Pill Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white border border-slate-200 text-slate-700 text-xs font-bold shadow-xs">
            <img src="/distrotrack_logo.png" alt="Logo" className="h-4 w-4 object-contain" />
            <span>Colgate-Palmolive Authorized Distribution Platform</span>
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-[3.2rem] font-black text-slate-900 tracking-tight leading-[1.12]">
            Modern Distribution Management for{' '}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-amber-600 bg-clip-text text-transparent">
              Wholesale FMCG Businesses
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base text-slate-600 font-medium leading-relaxed max-w-lg">
            Digitize picklists, deliveries, routes, inventory, payments, and analytics within a single platform designed for real-world distributors.
          </p>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-4">
            <button
              onClick={triggerAccessPortal}
              className="group inline-flex items-center justify-center px-8 py-3.5 rounded-xl bg-slate-900 hover:bg-blue-600 text-white font-bold text-sm shadow-xl shadow-slate-900/15 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Access Portal</span>
              <ArrowRight className="h-4 w-4 ml-2.5 group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={scrollToWorkflow}
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 font-bold text-sm shadow-xs transition-all cursor-pointer"
            >
              <span>Learn More</span>
              <ChevronRight className="h-4 w-4 ml-1 text-slate-400" />
            </button>
          </div>

          {/* Security Footprint */}
          <div className="pt-4 flex items-center gap-5 text-xs font-semibold text-slate-500 border-t border-slate-200/80">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              <span>256-bit Encryption</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>Sanghavi Traders Verified</span>
            </div>
          </div>

        </div>

        {/* RIGHT COLUMN: 3D LOGISTICS SCENE VIEWPORT */}
        <div className="lg:col-span-7 relative h-[480px] lg:h-[540px]">
          
          <ThreeHeroCanvas
            activeStep={activeStep}
            onStepChange={(step) => setActiveStep(step)}
            isReducedMotion={isReducedMotion}
          />

        </div>

      </main>

      {/* ── 3. VISUAL WORKFLOW STORYTELLING SECTION ──────────────────────────── */}
      <section id="workflow-section" className="relative z-10 bg-white border-y border-slate-200/80 py-16 px-6 md:px-12">
        <div className="max-w-7xl mx-auto w-full space-y-12">
          
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold">
              <Zap className="h-3.5 w-3.5 text-amber-600" />
              <span>End-to-End FMCG Lifecycle</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              One Seamless Flow from Warehouse to Bank
            </h2>
            <p className="text-sm sm:text-base text-slate-500 font-medium">
              Click any stage below to inspect how DistroTrack streamlines each step of your daily distribution operations.
            </p>
          </div>

          {/* 6 Workflow Stage Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workflowSteps.map((stepItem) => {
              const Icon = stepItem.icon;
              const isSelected = activeStep === stepItem.step;

              return (
                <div
                  key={stepItem.step}
                  onClick={() => {
                    setActiveStep(stepItem.step);
                  }}
                  className={`group relative p-6 rounded-2xl border transition-all duration-300 cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xl scale-[1.02]'
                      : 'bg-white text-slate-800 border-slate-200 hover:border-slate-400 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`h-12 w-12 rounded-xl flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                          : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200'
                      }`}
                    >
                      <Icon className="h-6 w-6" />
                    </div>
                    <span
                      className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${
                        isSelected ? 'bg-slate-800 text-amber-400' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Stage 0{stepItem.step + 1}
                    </span>
                  </div>

                  <div className="mt-5 space-y-2">
                    <h3 className="text-lg font-bold tracking-tight">{stepItem.title}</h3>
                    <p className={`text-xs font-semibold ${isSelected ? 'text-amber-300' : 'text-slate-600'}`}>
                      {stepItem.subtitle}
                    </p>
                    <p className={`text-xs leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {stepItem.desc}
                    </p>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] font-bold">
                    <span className={isSelected ? 'text-emerald-400' : 'text-emerald-600'}>
                      {stepItem.stat}
                    </span>
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      Focus Station <ChevronRight className="h-3 w-3" />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* ── 4. ENTERPRISE FMCG CAPABILITIES GRID ───────────────────────────── */}
      <section className="relative z-10 py-16 px-6 md:px-12 max-w-7xl mx-auto w-full space-y-12">
        
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Built for Real-World FMCG Wholesale Operators
          </h2>
          <p className="text-sm text-slate-500 font-medium">
            Designed specifically for Sanghavi Traders with high-volume Colgate toothpaste & toothbrush line items.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
              <PackageCheck className="h-5 w-5 text-slate-700" />
            </div>
            <h3 className="text-base font-bold text-slate-900">SAP Picklist Synchronization</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Seamlessly import Colgate SAP picklists, itemizing Strong Teeth, Maxfresh, Active Salt, and toothbrush boxes into ready-to-load truck lists.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
              <Truck className="h-5 w-5 text-slate-700" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Route & Vehicle Dispatch</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Assign daily routes across Sangamner, Akole, and regional markets with worker vehicle loading capacity checks and live turn-by-turn guidance.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
              <Wallet className="h-5 w-5 text-slate-700" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Cash & UPI Instant Reconciliation</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Eliminate end-of-day discrepancy with live cash bag counting, UPI transaction reference verification, and immediate admin clearance.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
              <Sparkles className="h-5 w-5 text-amber-600" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Automated Free Scheme Engine</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Auto-calculate Colgate free promotional items per party bill, ensuring scheme compliance without manual clerk calculations.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center font-bold">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Party Return & Shortage Audit</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Record damaged items, retailer returns, and box shortages directly at store drop-off with instant photo proof upload.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3 hover:shadow-md transition-shadow">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold">
              <TrendingUp className="h-5 w-5 text-slate-700" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Real-Time Executive Analytics</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Track daily outward tonnage, party collection ratios, salesman route efficiency, and gross distributor margins at a glance.
            </p>
          </div>

        </div>
      </section>

      {/* ── 5. OPERATIONAL METRICS BANNER ───────────────────────────────────── */}
      <section className="relative z-10 bg-slate-900 text-white py-14 px-6 md:px-12">
        <div className="max-w-7xl mx-auto w-full grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          
          <div className="space-y-1">
            <div className="text-3xl sm:text-4xl font-black text-amber-400">₹4.2 Cr+</div>
            <div className="text-xs font-semibold text-slate-400">Monthly Colgate FMCG Volume</div>
          </div>

          <div className="space-y-1">
            <div className="text-3xl sm:text-4xl font-black text-emerald-400">100%</div>
            <div className="text-xs font-semibold text-slate-400">Daily Payment Reconciliation</div>
          </div>

          <div className="space-y-1">
            <div className="text-3xl sm:text-4xl font-black text-slate-200">42% Faster</div>
            <div className="text-xs font-semibold text-slate-400">Route Completion Time</div>
          </div>

          <div className="space-y-1">
            <div className="text-3xl sm:text-4xl font-black text-amber-400">0% Paper</div>
            <div className="text-xs font-semibold text-slate-400">Digital Picklist Operation</div>
          </div>

        </div>
      </section>

      {/* ── 6. FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 px-6 md:px-12 py-6 max-w-7xl mx-auto w-full flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-500 border-t border-slate-200">
        <div className="flex items-center gap-2">
          <img src="/distrotrack_logo.png" alt="Logo" className="h-4 w-auto object-contain" />
          <span>Sanghavi Traders — Exclusive Colgate Distribution Management System</span>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={triggerAccessPortal} className="hover:text-slate-900 transition-colors cursor-pointer">
            Access Portal
          </button>
          <span>•</span>
          <span>DistroTrack v10.0</span>
        </div>
      </footer>
    </div>
  );
}
