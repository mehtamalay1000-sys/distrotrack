/**
 * useRealtimeSync — Supabase Realtime subscription hook for DistroTrack v2.
 *
 * Sets up database-level change subscriptions and invalidates the React Query
 * cache when authoritative server records change. This ensures Admin and Master
 * views update immediately when Worker mutations commit to Supabase, rather than
 * waiting for the 10s poll interval.
 *
 * DESIGN RULES:
 * - Master subscribes to all business-wide tables.
 * - Admin subscribes to operational tables.
 * - Worker does NOT subscribe to company-wide tables.
 * - Each subscription only invalidates relevant query keys (no blanket clear).
 * - If Realtime is not enabled for a table, the hook degrades gracefully.
 * - Cleanup: channels are removed on unmount.
 *
 * USAGE:
 *   In MasterLayout or AdminLayout — call once at the layout level.
 *   import { useRealtimeSync } from '@/lib/useRealtimeSync';
 *   export function MasterLayout() {
 *     useRealtimeSync('master');
 *     ...
 *   }
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { QK } from '@/lib/queryKeys';

type SyncRole = 'master' | 'admin';

export function useRealtimeSync(role: SyncRole) {
  const qc = useQueryClient();

  useEffect(() => {
    const channels: ReturnType<typeof supabase.channel>[] = [];

    // ── Picklists (route start/complete/assign) ───────────────────
    const picklistsCh = supabase
      .channel('rt-picklists')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'picklists' },
        () => {
          qc.invalidateQueries({ queryKey: QK.picklists });
          qc.invalidateQueries({ queryKey: QK.masterOperations });
          qc.invalidateQueries({ queryKey: QK.masterAllWorkers });
          qc.invalidateQueries({ queryKey: QK.dashboardStats });
        }
      )
      .subscribe();
    channels.push(picklistsCh);

    // ── Deliveries ────────────────────────────────────────────────
    const deliveriesCh = supabase
      .channel('rt-deliveries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'deliveries' },
        () => {
          qc.invalidateQueries({ queryKey: QK.deliveries });
          qc.invalidateQueries({ queryKey: QK.masterOperations });
          qc.invalidateQueries({ queryKey: QK.dashboardStats });
        }
      )
      .subscribe();
    channels.push(deliveriesCh);

    // ── Payments ──────────────────────────────────────────────────
    const paymentsCh = supabase
      .channel('rt-payments')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        () => {
          qc.invalidateQueries({ queryKey: QK.payments });
          qc.invalidateQueries({ queryKey: QK.masterOperations });
          qc.invalidateQueries({ queryKey: QK.dashboardStats });
        }
      )
      .subscribe();
    channels.push(paymentsCh);

    // ── Expenses ──────────────────────────────────────────────────
    const expensesCh = supabase
      .channel('rt-expenses')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          qc.invalidateQueries({ queryKey: QK.expenses });
          qc.invalidateQueries({ queryKey: QK.masterOperations });
        }
      )
      .subscribe();
    channels.push(expensesCh);

    // ── Master-only: inventory movements ─────────────────────────
    if (role === 'master') {
      const inventoryCh = supabase
        .channel('rt-inventory-movements')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'inventory_movements' },
          () => {
            qc.invalidateQueries({ queryKey: QK.masterInventory });
            qc.invalidateQueries({ queryKey: QK.inventory });
          }
        )
        .subscribe();
      channels.push(inventoryCh);
    }

    // ── Cleanup on unmount ────────────────────────────────────────
    return () => {
      channels.forEach(ch => {
        supabase.removeChannel(ch).catch(() => {
          // Channel removal errors are non-fatal
        });
      });
    };
  }, [qc, role]);
}
