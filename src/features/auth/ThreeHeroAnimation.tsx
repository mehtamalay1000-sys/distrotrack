import { useState, useEffect, useRef } from 'react';
import { ArrowRight, Truck, BarChart3, MapPin, Package, ShieldCheck } from 'lucide-react';
import { ThreeHeroCanvas } from './components/ThreeHeroCanvas';

interface ThreeHeroAnimationProps {
  onEnter: () => void;
}

/* Precision animated counter */
function useCounter(target: number, duration: number, start: boolean) {
  const [value, setValue] = useState(0);
  const ref = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!start) return;
    const startTime = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [target, duration, start]);

  return value;
}

export function ThreeHeroAnimation({ onEnter }: ThreeHeroAnimationProps) {
  const [mounted, setMounted] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  const handleEnter = () => {
    setExiting(true);
    setTimeout(onEnter, 500);
  };

  // Authentic operational data from mockStore & SAP master
  const routesCount = useCounter(20, 1400, mounted);
  const salesmenCount = useCounter(2, 1000, mounted);
  const skuCount = useCounter(54, 1800, mounted);

  const capabilities = [
    { icon: Package, label: 'SAP Import' },
    { icon: MapPin, label: 'Route Dispatch' },
    { icon: Truck, label: 'Daily Drops' },
    { icon: BarChart3, label: 'Settlement' },
  ];

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-500 overflow-hidden select-none ${
        exiting ? 'opacity-0 scale-[1.02]' : 'opacity-100 scale-100'
      }`}
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #f8faff 0%, #eef3f9 55%, #e6edf7 100%)',
      }}
    >
      {/* 3D Constellation & Route Network Background */}
      <ThreeHeroCanvas />

      {/* Subtle Atmospheric Depth Glows */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Content Container */}
      <div className="relative z-10 flex flex-col items-center justify-between min-h-screen px-6 py-8 sm:py-12">
        {/* Top Header Badge */}
        <div
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 backdrop-blur-md border border-slate-200/80 shadow-xs transition-all duration-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
          }`}
        >
          <div className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </div>
          <span className="text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
            Official FMCG Distributor • Sangamner
          </span>
        </div>

        {/* Center Hero Identity */}
        <div className="text-center max-w-3xl my-auto py-6">
          {/* Company Title */}
          <div
            className={`transition-all duration-700 delay-100 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
            }`}
          >
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-900 tracking-tight leading-[1.08] mb-3">
              Sanghavi Traders
            </h1>
            <p className="text-sm sm:text-base font-medium text-slate-500 max-w-lg mx-auto leading-relaxed">
              Enterprise wholesale distribution & last-mile fulfillment network
            </p>
          </div>

          {/* Real Operational Stats Cards */}
          <div
            className={`grid grid-cols-3 gap-3 sm:gap-4 max-w-lg mx-auto my-7 transition-all duration-700 delay-200 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
            }`}
          >
            <div className="p-3.5 sm:p-4 rounded-2xl bg-white/80 backdrop-blur-md border border-slate-200/90 shadow-sm hover:shadow-md hover:border-slate-300 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {routesCount}
              </div>
              <div className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                Active Routes
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-2xl bg-white/80 backdrop-blur-md border border-slate-200/90 shadow-sm hover:shadow-md hover:border-slate-300 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {salesmenCount}
              </div>
              <div className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                Salesmen
              </div>
            </div>

            <div className="p-3.5 sm:p-4 rounded-2xl bg-white/80 backdrop-blur-md border border-slate-200/90 shadow-sm hover:shadow-md hover:border-slate-300 transition-all text-center">
              <div className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {skuCount}+
              </div>
              <div className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                SAP SKUs
              </div>
            </div>
          </div>

          {/* DistroTrack Powered Badge & Capabilities */}
          <div
            className={`flex flex-wrap items-center justify-center gap-2 mb-8 transition-all duration-700 delay-300 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 text-white shadow-sm">
              <div className="h-4 w-4 rounded-md bg-gradient-to-tr from-blue-500 to-indigo-500 flex items-center justify-center text-[9px] font-extrabold">
                D
              </div>
              <span className="text-xs font-bold tracking-tight">DistroTrack 10</span>
            </div>

            {capabilities.map((c) => (
              <div
                key={c.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/60 backdrop-blur-sm border border-slate-200/70 text-slate-600 text-xs font-semibold"
              >
                <c.icon className="h-3.5 w-3.5 text-slate-400" />
                <span>{c.label}</span>
              </div>
            ))}
          </div>

          {/* Clean Premium Access CTA */}
          <div
            className={`transition-all duration-700 delay-400 ${
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <button
              onClick={handleEnter}
              className="group inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-lg shadow-slate-900/15 hover:shadow-xl hover:shadow-slate-900/25 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Access Portal</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </button>
          </div>
        </div>

        {/* Bottom Trust & Region Note */}
        <div
          className={`flex items-center justify-center gap-2 text-xs text-slate-400 font-medium tracking-wide transition-all duration-700 delay-500 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
          <span>Sangamner Regional Operations • Secure Enterprise System</span>
        </div>
      </div>
    </div>
  );
}
