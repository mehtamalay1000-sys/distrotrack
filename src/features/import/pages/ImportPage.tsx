import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Upload, FileUp, CheckCircle2, AlertTriangle, ArrowRight, Loader2, RefreshCw, FileText, Sparkles, CalendarDays } from 'lucide-react';
import { PageHeader, Button, Select, StatusBadge, Card } from '@/shared/ui';
import { parsePicklist } from '../parsers/picklistParser';
import { parseBills } from '../parsers/billsParser';
import { matchInvoices } from '../parsers/matcher';
import { confirmImportToDatabase } from '../services/importService';
import { getWorkers } from '@/features/workers/services/workerService';
import { formatCurrency } from '@/shared/utils/format';
import type { ParsedPicklist, ParsedPicklistItem, ParsedBillsResult, MatchResult } from '../parsers/types';

export function ImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Compute tomorrow's date as default delivery date
  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const [picklistFile, setPicklistFile] = useState<File | null>(null);
  const [billsFile, setBillsFile] = useState<File | null>(null);

  const [parsing, setParsing] = useState(false);
  const [parsedPicklist, setParsedPicklist] = useState<ParsedPicklist | null>(null);
  const [parsedBills, setParsedBills] = useState<ParsedBillsResult | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [assignedWorkerId, setAssignedWorkerId] = useState<string>('');
  const [deliveryDate, setDeliveryDate] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'summary' | 'parties' | 'invoices'>('summary');

  const { data: workers = [] } = useQuery({ queryKey: ['workers'], queryFn: getWorkers });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsedPicklist || !matchResult) throw new Error('No parsed data to import');
      if (!deliveryDate) throw new Error('Please select a delivery date');
      return confirmImportToDatabase(parsedPicklist, matchResult, assignedWorkerId, deliveryDate);
    },
    onSuccess: (picklistRecord) => {
      qc.invalidateQueries({ queryKey: ['picklists'] });
      qc.invalidateQueries({ queryKey: ['parties'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['deliveries'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success(`Picklist #${picklistRecord.picklist_number} imported successfully!`);
      navigate('/admin/picklists');
    },
    onError: (err: Error) => {
      toast.error(`Import failed: ${err.message}`);
    },
  });

  async function handleStartParse() {
    if (!picklistFile) {
      toast.error('Please upload a Picklist PDF file or click "Load Sample Picklist"');
      return;
    }
    setParsing(true);
    setParsedPicklist(null);
    setParsedBills(null);
    setMatchResult(null);

    try {
      toast.info('Parsing SAP Picklist PDF…');
      const picklistData = await parsePicklist(picklistFile);
      setParsedPicklist(picklistData);

      let billsData: ParsedBillsResult;
      if (billsFile) {
        toast.info('Parsing SAP Bills PDF…');
        billsData = await parseBills(billsFile);
      } else {
        billsData = { invoices: [], pageCount: 0, totalInvoices: 0, totalAmount: 0, warnings: ['No Bills PDF provided'] };
      }
      setParsedBills(billsData);

      const matched = matchInvoices(picklistData, billsData);
      setMatchResult(matched);

      toast.success('Parsing and reconciliation complete!');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Parsing error: ${msg}`);
    } finally {
      setParsing(false);
    }
  }

  function handleLoadSample() {
    const tomorrow = getTomorrowStr();
    // Use real SAP SKUs from the Product Master so the import flow
    // demonstrates correct lookup-first product referencing
    const party1Items: ParsedPicklistItem[] = [
      { partyCode: 'C000727249', partyName: 'RAJESH KIRANA', sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 6, rate: 150.0, amount: 900 },
      { partyCode: 'C000727249', partyName: 'RAJESH KIRANA', sku: '1608101', productName: 'Cibaca 175 g', quantity: 12, rate: 71.0, amount: 852 },
      { partyCode: 'C000727249', partyName: 'RAJESH KIRANA', sku: '61061321', productName: 'Colgate Sensitive 80g', quantity: 4, rate: 116.0, amount: 464 },
    ];
    const party2Items: ParsedPicklistItem[] = [
      { partyCode: 'C000812345', partyName: 'SHREE GANESH STORE', sku: '61050884', productName: 'CDC 100 NF', quantity: 24, rate: 73.0, amount: 1752 },
      { partyCode: 'C000812345', partyName: 'SHREE GANESH STORE', sku: '61002494', productName: 'SupFlex Char 10+2 M', quantity: 6, rate: 220.0, amount: 1320 },
    ];

    const samplePl: ParsedPicklist = {
      picklistNumber: 'SAP-PL-8890',
      routeCode: 'SANGAMNER_6',
      routeName: 'SANGAMNER 6',
      date: tomorrow,
      pageCount: 2,
      totalItems: 5,
      totalAmount: 5288,
      parties: [
        {
          partyCode: 'C000727249',
          partyName: 'RAJESH KIRANA',
          totalAmount: 2216,
          items: party1Items,
        },
        {
          partyCode: 'C000812345',
          partyName: 'SHREE GANESH STORE',
          totalAmount: 3072,
          items: party2Items,
        },
      ],
      items: [...party1Items, ...party2Items],
      rawText: 'Sample SAP Picklist Raw Data',
      warnings: [],
    };

    const sampleBills: ParsedBillsResult = {
      pageCount: 2,
      totalInvoices: 2,
      totalAmount: 5288,
      warnings: [],
      invoices: [
        {
          invoiceNumber: 'A37A506290',
          partyCode: 'C000727249',
          partyName: 'RAJESH KIRANA',
          date: tomorrow,
          totalAmount: 2216,
          taxAmount: 110.80,
          netAmount: 2216,
          routeCode: 'SANGAMNER_6',
          salesRep: 'Balu M',
          pageCount: 1,
          rawText: 'Sample Invoice Raw Text',
          items: [
            { sku: '1600908', productName: 'Col ActSalt Tpst200', quantity: 6, mrp: 150, rate: 150.0, amount: 900, taxAmount: 45.0 },
            { sku: '1608101', productName: 'Cibaca 175 g', quantity: 12, mrp: 71, rate: 71.0, amount: 852, taxAmount: 42.6 },
            { sku: '61061321', productName: 'Colgate Sensitive 80g', quantity: 4, mrp: 116, rate: 116.0, amount: 464, taxAmount: 23.2 },
          ],
        },
        {
          invoiceNumber: 'A37A506291',
          partyCode: 'C000812345',
          partyName: 'SHREE GANESH STORE',
          date: tomorrow,
          totalAmount: 3072,
          taxAmount: 153.60,
          netAmount: 3072,
          routeCode: 'SANGAMNER_6',
          salesRep: 'Balu M',
          pageCount: 1,
          rawText: 'Sample Invoice Raw Text',
          items: [
            { sku: '61050884', productName: 'CDC 100 NF', quantity: 24, mrp: 73, rate: 73.0, amount: 1752, taxAmount: 87.6 },
            { sku: '61002494', productName: 'SupFlex Char 10+2 M', quantity: 6, mrp: 220, rate: 220.0, amount: 1320, taxAmount: 66.0 },
          ],
        },
      ],
    };

    const matched = matchInvoices(samplePl, sampleBills);
    setParsedPicklist(samplePl);
    setParsedBills(sampleBills);
    setMatchResult(matched);
    toast.success('Sample SAP Picklist & Bills loaded for preview!');
  }

  function handleReset() {
    setPicklistFile(null);
    setBillsFile(null);
    setParsedPicklist(null);
    setParsedBills(null);
    setMatchResult(null);
    setDeliveryDate('');
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="SAP PDF Import"
        description="Digitize SAP Picklists & Bills PDFs into structured DistroTrack database records"
        actions={
          <Button variant="outline" size="sm" onClick={handleLoadSample} icon={<Sparkles className="h-4 w-4 text-amber-500" />}>
            Load Sample SAP Picklist
          </Button>
        }
      />

      {/* Step 1: Upload Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Picklist PDF Card */}
        <Card className={`border-2 border-dashed transition-colors ${picklistFile ? 'border-primary-400 bg-primary-50/20 dark:bg-primary-950/30' : 'border-surface-300 dark:border-surface-700 hover:border-surface-400'}`}>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <FileText className={`h-10 w-10 mb-2 ${picklistFile ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400'}`} />
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">
              {picklistFile ? picklistFile.name : 'SAP Picklist PDF (Required)'}
            </h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
              {picklistFile ? `${(picklistFile.size / 1024).toFixed(1)} KB` : 'Supports multi-page SAP Picklists'}
            </p>

            <label className="cursor-pointer inline-block">
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setPicklistFile(e.target.files?.[0] || null)}
              />
              <span className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors h-8 px-3 text-xs gap-1.5 ${picklistFile ? 'border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                <Upload className="h-4 w-4" />
                {picklistFile ? 'Change File' : 'Select Picklist PDF'}
              </span>
            </label>
          </div>
        </Card>

        {/* Bills PDF Card */}
        <Card className={`border-2 border-dashed transition-colors ${billsFile ? 'border-primary-400 bg-primary-50/20 dark:bg-primary-950/30' : 'border-surface-300 dark:border-surface-700 hover:border-surface-400'}`}>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <FileUp className={`h-10 w-10 mb-2 ${billsFile ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400'}`} />
            <h3 className="text-sm font-semibold text-surface-900 dark:text-surface-100 mb-1">
              {billsFile ? billsFile.name : 'SAP Bills / Invoices PDF (Optional)'}
            </h3>
            <p className="text-xs text-surface-500 dark:text-surface-400 mb-4">
              {billsFile ? `${(billsFile.size / 1024).toFixed(1)} KB` : 'Supports multi-page invoices & matching'}
            </p>

            <label className="cursor-pointer inline-block">
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => setBillsFile(e.target.files?.[0] || null)}
              />
              <span className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors h-8 px-3 text-xs gap-1.5 ${billsFile ? 'border border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-700' : 'bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-600'}`}>
                <Upload className="h-4 w-4" />
                {billsFile ? 'Change File' : 'Select Bills PDF'}
              </span>
            </label>
          </div>
        </Card>
      </div>

      {/* Parse Action Bar */}
      <div className="flex items-center justify-between bg-white dark:bg-surface-800 p-4 border border-surface-200 dark:border-surface-700 rounded-xl">
        <div className="text-xs text-surface-500 dark:text-surface-400">
          {parsedPicklist ? 'PDF parsed. Review structured data below before saving to database.' : 'Upload PDF files or click "Load Sample SAP Picklist".'}
        </div>
        <div className="flex items-center gap-2">
          {parsedPicklist && (
            <Button variant="ghost" size="sm" onClick={handleReset} icon={<RefreshCw className="h-4 w-4" />}>
              Reset
            </Button>
          )}
          <Button
            loading={parsing}
            disabled={!picklistFile && !parsedPicklist}
            onClick={picklistFile ? handleStartParse : handleLoadSample}
            icon={parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          >
            {parsing ? 'Parsing PDFs…' : 'Parse & Validate'}
          </Button>
        </div>
      </div>

      {/* Step 2: Parsed Preview & Reconciliation Section */}
      {parsedPicklist && matchResult && (
        <div className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wide">Picklist No.</div>
              <div className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{parsedPicklist.picklistNumber}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{parsedPicklist.routeName} ({parsedPicklist.routeCode})</div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wide">Parties / Customers</div>
              <div className="text-lg font-bold text-surface-900 dark:text-surface-100 mt-1">{parsedPicklist.parties.length}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{parsedPicklist.totalItems} SKUs total</div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wide">Total Picklist Value</div>
              <div className="text-lg font-bold text-primary-700 dark:text-primary-400 mt-1">{formatCurrency(parsedPicklist.totalAmount)}</div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">{parsedPicklist.pageCount} page(s) parsed</div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-surface-500 dark:text-surface-400 font-medium uppercase tracking-wide">Matching Status</div>
              <div className="mt-1 flex items-center gap-1.5">
                {matchResult.isFullyMatched ? (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> 100% Matched
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> {matchResult.matchedCount}/{matchResult.pairs.length} Matched
                  </span>
                )}
              </div>
              <div className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                {matchResult.missingBillsCount} missing, {matchResult.discrepanciesCount} mismatches
              </div>
            </Card>
          </div>

          {/* Delivery Date Picker — Mandatory */}
          <Card className={`p-4 border-2 transition-colors ${
            deliveryDate
              ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20'
              : 'border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20'
          }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  deliveryDate
                    ? 'bg-emerald-100 dark:bg-emerald-900/40'
                    : 'bg-red-100 dark:bg-red-900/40'
                }`}>
                  <CalendarDays className={`h-5 w-5 ${
                    deliveryDate
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                    Date of Delivery
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">Required</span>
                  </h4>
                  <p className="text-xs text-surface-500 dark:text-surface-400 mt-0.5">
                    Picklists are printed in the evening. Select the actual delivery date (usually tomorrow).
                  </p>
                </div>
              </div>
              <div className="w-full sm:w-52">
                <input
                  id="delivery-date-picker"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  className="w-full text-sm px-3 py-2 border border-surface-300 dark:border-surface-600 rounded-xl bg-white dark:bg-surface-800 text-surface-900 dark:text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-shadow font-medium"
                />
              </div>
            </div>
          </Card>

          {/* Worker Assignment — Mandatory */}
          <Card className={`p-4 border-2 transition-colors ${
            assignedWorkerId
              ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20'
              : 'border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-950/20'
          }`}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-surface-900 dark:text-surface-100 flex items-center gap-2">
                  Assign Delivery Worker
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded">Required</span>
                </h4>
                <p className="text-xs text-surface-500 dark:text-surface-400">Select a worker to handle all deliveries created from this SAP Picklist</p>
              </div>
              <div className="w-full sm:w-64">
                <Select
                  value={assignedWorkerId}
                  onChange={(e) => setAssignedWorkerId(e.target.value)}
                  placeholder="Select Worker…"
                  options={workers.filter((w) => w.status === 'active').map((w) => ({ value: w.id, label: w.name }))}
                />
              </div>
            </div>
          </Card>

          {/* Navigation Tabs */}
          <div className="border-b border-surface-200 dark:border-surface-700 flex gap-4">
            <button
              onClick={() => setActiveTab('summary')}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'summary' ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`}
            >
              Reconciliation Summary
            </button>
            <button
              onClick={() => setActiveTab('parties')}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'parties' ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`}
            >
              Parties & Products ({parsedPicklist.parties.length})
            </button>
            <button
              onClick={() => setActiveTab('invoices')}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'invoices' ? 'border-primary-600 dark:border-primary-400 text-primary-700 dark:text-primary-300' : 'border-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200'}`}
            >
              Bills / Invoices ({parsedBills?.invoices.length || 0})
            </button>
          </div>

          {/* Tab 1: Summary Table */}
          {activeTab === 'summary' && (
            <div className="bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl overflow-hidden">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Customer Party</th>
                    <th>Picklist Items</th>
                    <th>Picklist Value</th>
                    <th>Matched Invoice</th>
                    <th>Invoice Value</th>
                    <th>Match Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matchResult.pairs.map((pair, idx) => (
                    <tr key={idx}>
                      <td>
                        <div className="font-medium text-surface-900 dark:text-surface-100">{pair.partyName}</div>
                        <div className="font-mono text-xs text-surface-500 dark:text-surface-400">{pair.partyCode}</div>
                      </td>
                      <td className="text-xs text-surface-700 dark:text-surface-300">{pair.picklistParty ? `${pair.picklistParty.items.length} items` : '—'}</td>
                      <td className="font-medium text-surface-900 dark:text-surface-100">{pair.picklistParty ? formatCurrency(pair.picklistParty.totalAmount) : '—'}</td>
                      <td>{pair.invoice ? <span className="font-mono text-xs text-surface-700 dark:text-surface-300">{pair.invoice.invoiceNumber}</span> : <span className="text-xs text-surface-400">None</span>}</td>
                      <td className="font-medium text-surface-900 dark:text-surface-100">{pair.invoice ? formatCurrency(pair.invoice.netAmount) : '—'}</td>
                      <td>
                        {pair.status === 'matched' && <StatusBadge status="completed" />}
                        {pair.status === 'missing_bill' && <span className="text-xs bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded font-medium">Missing Bill</span>}
                        {pair.status === 'unexpected_bill' && <span className="text-xs bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded font-medium">Extra Bill</span>}
                        {pair.status === 'discrepancy' && <span className="text-xs bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 px-2 py-0.5 rounded font-medium">Mismatch</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Parties & Items */}
          {activeTab === 'parties' && (
            <div className="space-y-4">
              {parsedPicklist.parties.map((party) => (
                <Card key={party.partyCode} className="p-4">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-surface-200 dark:border-surface-700">
                    <div>
                      <span className="font-mono text-xs bg-surface-100 dark:bg-surface-700 text-surface-800 dark:text-surface-200 px-1.5 py-0.5 rounded font-medium mr-2">{party.partyCode}</span>
                      <span className="font-semibold text-surface-900 dark:text-surface-100">{party.partyName}</span>
                    </div>
                    <div className="font-bold text-primary-700 dark:text-primary-400">{formatCurrency(party.totalAmount)}</div>
                  </div>
                  <table className="w-full text-xs text-surface-700 dark:text-surface-300">
                    <thead>
                      <tr className="text-left text-surface-400 border-b border-surface-100 dark:border-surface-700">
                        <th className="pb-1">SKU</th>
                        <th className="pb-1">Product</th>
                        <th className="pb-1 text-right">Qty</th>
                        <th className="pb-1 text-right">Free Qty</th>
                        <th className="pb-1 text-right">Rate</th>
                        <th className="pb-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {party.items && party.items.length > 0 ? (
                        party.items.map((it, idx) => (
                          <tr key={idx} className="border-b border-surface-50 dark:border-surface-800/60">
                            <td className="py-1 font-mono text-surface-500 dark:text-surface-400">{it.sku}</td>
                            <td className="py-1 font-medium text-surface-900 dark:text-surface-100">{it.productName}</td>
                            <td className="py-1 text-right text-surface-900 dark:text-surface-100">{it.quantity}</td>
                            <td className="py-1 text-right">
                              {it.freeQuantity && it.freeQuantity > 0 ? (
                                <span className="text-xs bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 rounded font-semibold border border-emerald-200 dark:border-emerald-800">
                                  +{it.freeQuantity} free
                                </span>
                              ) : (
                                <span className="text-surface-400">—</span>
                              )}
                            </td>
                            <td className="py-1 text-right">{formatCurrency(it.rate)}</td>
                            <td className="py-1 text-right font-medium text-surface-900 dark:text-surface-100">{formatCurrency(it.amount)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-2 text-center text-xs text-surface-400">
                            No product items mapped yet. Upload SAP Bills PDF or parse reconciliation to populate line items.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          )}

          {/* Tab 3: Bills / Invoices */}
          {activeTab === 'invoices' && (
            <div className="space-y-4">
              {parsedBills && parsedBills.invoices.length > 0 ? (
                parsedBills.invoices.map((inv) => (
                  <Card key={inv.invoiceNumber} className="p-4">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-surface-200 dark:border-surface-700">
                      <div>
                        <span className="font-mono text-sm font-bold text-surface-900 dark:text-surface-100 mr-3">{inv.invoiceNumber}</span>
                        <span className="text-xs text-surface-500 dark:text-surface-400">{inv.partyName} ({inv.partyCode})</span>
                      </div>
                      <div className="font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(inv.netAmount)}</div>
                    </div>
                    <div className="text-xs text-surface-500 dark:text-surface-400 flex gap-4">
                      <span>Date: {inv.date}</span>
                      <span>Route: {inv.routeCode || 'Main'}</span>
                      <span>Sales Rep: {inv.salesRep || 'N/A'}</span>
                    </div>
                  </Card>
                ))
              ) : (
                <div className="text-center py-8 text-surface-400 text-xs">No Bills PDF was uploaded. Picklist only.</div>
              )}
            </div>
          )}

          {/* Final Commit Button */}
          <div className="flex justify-end p-4 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl">
            <Button
              size="lg"
              loading={importMutation.isPending}
              disabled={!deliveryDate || !assignedWorkerId}
              onClick={() => importMutation.mutate()}
              icon={<CheckCircle2 className="h-5 w-5" />}
            >
              {!deliveryDate && !assignedWorkerId
                ? 'Select Delivery Date & Worker to Continue'
                : !deliveryDate
                  ? 'Select Delivery Date to Continue'
                  : !assignedWorkerId
                    ? 'Select Delivery Worker to Continue'
                    : `Confirm & Save for ${new Date(deliveryDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
