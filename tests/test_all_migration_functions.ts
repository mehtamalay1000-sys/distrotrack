import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve('.env');
let supabaseUrl = '';
let supabaseKey = '';

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('VITE_SUPABASE_URL=')) {
      supabaseUrl = trimmed.replace('VITE_SUPABASE_URL=', '').trim();
    }
    if (trimmed.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      supabaseKey = trimmed.replace('VITE_SUPABASE_ANON_KEY=', '').trim();
    }
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function findFunctions() {
  const migDir = path.resolve('supabase/migrations');
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql'));
  
  const functionNames = new Set<string>();
  const regex = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(/gi;

  for (const file of files) {
    const content = fs.readFileSync(path.join(migDir, file), 'utf8');
    let match;
    while ((match = regex.exec(content)) !== null) {
      functionNames.add(match[1]);
    }
  }

  console.log(`Found ${functionNames.size} distinct functions across migrations:`);
  console.log(Array.from(functionNames).sort());

  await supabase.auth.signInWithPassword({
    email: 'master@distrotrack.local',
    password: '9129',
  });

  const existingOnRemote: string[] = [];
  const missingOnRemote: string[] = [];

  for (const fn of Array.from(functionNames).sort()) {
    const { data, error } = await supabase.rpc(fn as any, {});
    const notFound = error?.code === 'PGRST202' && error?.message?.includes('Could not find the function');
    if (notFound) {
      missingOnRemote.push(fn);
    } else {
      existingOnRemote.push(`${fn} (code: ${error?.code || 'OK'}, msg: ${error?.message || 'SUCCESS'})`);
    }
  }

  console.log(`\n=== REMOTE SUPABASE: ${existingOnRemote.length} FUNCTIONS FOUND ===`);
  console.log(existingOnRemote.join('\n'));

  console.log(`\n=== REMOTE SUPABASE: ${missingOnRemote.length} FUNCTIONS MISSING / NOT FOUND ===`);
  console.log(missingOnRemote.join('\n'));
}

findFunctions().catch(console.error);
