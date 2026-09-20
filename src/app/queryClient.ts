import { QueryClient } from '@tanstack/react-query';

/**
 * Exported so AuthProvider can clear ALL cached business data on logout,
 * preventing the previous user's data from being visible to the next user.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true, // Refetch immediately when worker/admin returns to the browser tab or wakes phone
      refetchOnReconnect: true,   // Refetch immediately when internet reconnects
      staleTime: 5000,            // 5s fresh window before background refetch
      refetchInterval: 10000,     // Auto-poll every 10 seconds so worker phone and admin laptop stay in 100% real-time sync without manual refresh
      refetchIntervalInBackground: false,
    },
  },
});
