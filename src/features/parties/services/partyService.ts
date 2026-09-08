import { supabase } from '@/lib/supabase';
import { mockStore } from '@/lib/mockStore';
import type { Party } from '@/lib/database.types';

export async function getParties(): Promise<Party[]> {
  try {
    let allParties: Party[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('parties')
        .select('*, route:routes(id, name, code)')
        .order('name')
        .range(from, from + PAGE_SIZE - 1);

      if (error || !data) {
        if (allParties.length > 0) return allParties;
        return mockStore.getParties();
      }

      allParties = allParties.concat(data as Party[]);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return allParties;
  } catch {
    return mockStore.getParties();
  }
}

export async function getParty(id: string): Promise<Party> {
  try {
    const { data, error } = await supabase
      .from('parties')
      .select('*, route:routes(id, name, code)')
      .eq('id', id)
      .single();
    if (error || !data) {
      const found = mockStore.getParties().find((p) => p.id === id);
      if (found) return found;
      throw new Error('Party not found');
    }
    return data as Party;
  } catch {
    const found = mockStore.getParties().find((p) => p.id === id);
    if (found) return found;
    throw new Error('Party not found');
  }
}

export async function createParty(input: {
  code: string; name: string; contact_person?: string; phone?: string;
  email?: string; address?: string; city?: string; route_id?: string;
}): Promise<Party> {
  try {
    const { data, error } = await supabase
      .from('parties')
      .insert({
        code: input.code, name: input.name,
        contact_person: input.contact_person ?? null, phone: input.phone ?? null,
        email: input.email ?? null, address: input.address ?? null,
        city: input.city ?? null, route_id: input.route_id || null,
        outstanding_amount: 0, status: 'active',
      })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveParty(input);
    }
    mockStore.saveParty(data as Party);
    return data as Party;
  } catch {
    return mockStore.saveParty(input);
  }
}

export async function updateParty(id: string, input: Partial<Party>): Promise<Party> {
  try {
    const { data, error } = await supabase.from('parties').update(input).eq('id', id).select().single();
    if (error || !data) {
      return mockStore.saveParty({ id, ...input });
    }
    mockStore.saveParty(data as Party);
    return data as Party;
  } catch {
    return mockStore.saveParty({ id, ...input });
  }
}

export async function deleteParty(id: string): Promise<void> {
  try {
    await supabase.from('parties').delete().eq('id', id);
  } catch {
    // fallback
  }
  mockStore.deleteParty(id);
}

/** Upsert a party by code – used during SAP import */
export async function upsertPartyByCode(code: string, name: string, routeId?: string): Promise<Party> {
  try {
    const { data: existing } = await supabase.from('parties').select('*').eq('code', code).single();
    if (existing) return existing as Party;

    const { data, error } = await supabase
      .from('parties')
      .insert({ code, name, route_id: routeId ?? null, outstanding_amount: 0, status: 'active' })
      .select()
      .single();
    if (error || !data) {
      return mockStore.saveParty({ code, name, route_id: routeId });
    }
    mockStore.saveParty(data as Party);
    return data as Party;
  } catch {
    return mockStore.saveParty({ code, name, route_id: routeId });
  }
}

/** Fetch authoritative customer outstanding balance derived from party_financial_ledger */
export async function getAuthoritativePartyOutstanding(partyId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('get_party_outstanding', { p_party_id: partyId });
    if (!error && data !== null && data !== undefined) {
      return Number(data);
    }
  } catch (err) {
    console.warn('[partyService] Failed to load party outstanding from RPC:', err);
  }
  const found = mockStore.getParties().find((p) => p.id === partyId);
  return Number(found?.outstanding_amount || 0);
}
