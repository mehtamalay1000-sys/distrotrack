import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
  console.log('Authenticating as master or admin...');
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  if (authErr) {
    console.log('Master login failed:', authErr.message);
    // Try admin login
    const { data: adminList } = await supabase.from('pin_users').select('*');
    console.log('pin_users:', adminList);
  } else {
    console.log('Authenticated successfully as:', auth.user?.email);
  }

  const { data: products, error: prodErr } = await supabase
    .from('products')
    .select('*')
    .order('name');

  if (prodErr) {
    console.error('Error fetching products:', prodErr);
  } else {
    console.log(`\n=== TOTAL PRODUCTS IN SUPABASE: ${products?.length || 0} ===`);
    products?.forEach((p, i) => {
      console.log(`[${i + 1}] ID: ${p.id} | SKU: "${p.sku}" | Name: "${p.name}" | Cat: "${p.category}" | is_sap_master: ${p.is_sap_master} | source: ${p.source} | status: ${p.status}`);
    });
  }

  const { data: movements, error: movErr } = await supabase
    .from('inventory_movements')
    .select('*');

  if (movErr) {
    console.error('Error fetching inventory_movements:', movErr);
  } else {
    console.log(`\n=== TOTAL INVENTORY MOVEMENTS IN SUPABASE: ${movements?.length || 0} ===`);
    movements?.forEach((m, i) => {
      console.log(`[${i + 1}] ID: ${m.id} | SKU: "${m.sku}" | Type: ${m.movement_type} | Qty: ${m.quantity} | Dir: ${m.direction} | Notes: ${m.notes}`);
    });
  }

  const { data: picklists } = await supabase.from('picklists').select('id, picklist_number, status');
  const { data: deliveries } = await supabase.from('deliveries').select('id, status, total_amount');
  const { data: deliveryItems } = await supabase.from('delivery_items').select('id, sku, product_name, delivered_qty');

  console.log(`\n=== DEPENDENT DATA IN SUPABASE ===`);
  console.log(`Picklists (${picklists?.length || 0})`);
  console.log(`Deliveries (${deliveries?.length || 0})`);
  console.log(`Delivery Items (${deliveryItems?.length || 0})`);
}

inspect().catch(console.error);
