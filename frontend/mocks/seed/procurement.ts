/**
 * Deterministic seed for the procurement mock dataset.
 *
 * Contract:
 *   - 12 vendors  (VND-001..VND-012)
 *   - 50 RFQs     (RFQ-2026-0001..0050)
 *   - 30 POs      (PO-2026-0001..0030)
 *
 * Reseeding with the same SEED always yields byte-identical fixtures, so
 * Playwright tests can assert against fixed counts and IDs.
 */
import type {
  Po,
  PoLine,
  PoState,
  Rfq,
  RfqLine,
  RfqPriority,
  RfqState,
  Vendor,
  VendorCategory,
} from '../types';
import { chance, mulberry32, pick, randint } from './rng';

const SEED = 0xa6d3; // "agnipariksha procurement seed v1" — do not change
const EPOCH = Date.UTC(2026, 0, 5); // 2026-01-05 baseline for deterministic timestamps
const DAY_MS = 24 * 60 * 60 * 1000;

const VENDOR_NAMES: ReadonlyArray<readonly [string, VendorCategory]> = [
  ['Apex Electricals',          'electronics'],
  ['Bharat Sensors Pvt Ltd',    'electronics'],
  ['Crescent Machine Tools',    'mechanical'],
  ['Deccan Calibration Labs',   'services'],
  ['EnerTrust Power Systems',   'electronics'],
  ['Falcon Industrial Supplies','consumables'],
  ['Gokul Precision Works',     'mechanical'],
  ['Helios Solar Components',   'electronics'],
  ['Indus Safety Equipments',   'safety'],
  ['Jyoti Connector House',     'electronics'],
  ['Kavery Thermal Solutions',  'mechanical'],
  ['Lakshmi Lab Consumables',   'consumables'],
];

const SKU_CATALOG: ReadonlyArray<readonly [string, string, string, number]> = [
  ['ITECH-FAN-120',  'ITECH PV6000 cooling fan, 120mm',          'ea',   8500],
  ['ITECH-PSU-LV',   'ITECH low-voltage driver board spare',      'ea',  42500],
  ['DAQ-NI-9213',    'NI-9213 thermocouple module',               'ea',  78000],
  ['TC-K-1M',        'Type-K thermocouple probe, 1m',             'ea',    950],
  ['TC-T-1M',        'Type-T thermocouple probe, 1m',             'ea',   1100],
  ['CHMBR-HEATER',   'Climatic chamber heating element',          'ea',  21000],
  ['RH-SENS-HC2',    'Rotronic HC2 humidity sensor',              'ea',  34500],
  ['BUSBAR-CU-25',   'Copper busbar 25x6mm',                      'm',    1850],
  ['FUSE-T-10A',     'Time-lag fuse 10A 250V',                    'ea',     65],
  ['MOLEX-MX150',    'Molex MX150 connector kit',                 'kit',   480],
  ['SAFETY-GLOVES',  'Class-0 electrical safety gloves',          'pair',  3600],
  ['CAL-CERT-AC',    'Annual SCPI calibration certificate',       'svc',  28000],
  ['EARTH-STRAP-1M', 'Grounding strap 1m, 6mm² copper',           'ea',    540],
  ['CABLE-SI-2C',    'Silicone-insulated 2-core cable',           'm',     220],
  ['SOLDER-LF-500',  'Lead-free solder 500g spool',               'spool', 1450],
];

const REQUESTORS = [
  'r.kumar',
  's.iyer',
  'a.patel',
  'm.singh',
  'p.rao',
  'n.menon',
];

const COST_CENTERS = ['CC-RND', 'CC-QA', 'CC-OPS', 'CC-SAFETY'];

function isoFromOffset(offsetDays: number): string {
  return new Date(EPOCH + offsetDays * DAY_MS).toISOString();
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

export interface SeededDataset {
  vendors: Vendor[];
  rfqs: Rfq[];
  pos: Po[];
}

export function seedProcurement(): SeededDataset {
  const rand = mulberry32(SEED);

  const vendors: Vendor[] = VENDOR_NAMES.map(([name, category], idx) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, '');
    const created = randint(rand, -300, -180);
    const updated = randint(rand, -60, -1);
    return {
      id: `VND-${pad(idx + 1, 3)}`,
      name,
      email: `sales@${slug}.example.com`,
      phone: `+91-${randint(rand, 70, 99)}${randint(rand, 10000, 99999)}${randint(rand, 100, 999)}`,
      address: `${randint(rand, 1, 999)}, ${pick(rand, ['Industrial Estate', 'MIDC Phase II', 'Electronics City', 'Peenya'])} , ${pick(rand, ['Bengaluru', 'Pune', 'Chennai', 'Mumbai', 'Hyderabad'])}`,
      category,
      rating: Math.round((3 + rand() * 2) * 10) / 10,
      on_hold: chance(rand, 0.1),
      created_at: isoFromOffset(created),
      updated_at: isoFromOffset(updated),
    };
  });

  const rfqStates: ReadonlyArray<RfqState> = [
    'draft',
    'sent',
    'sent',
    'received',
    'received',
    'awarded',
    'cancelled',
  ];
  const priorities: ReadonlyArray<RfqPriority> = [
    'low',
    'normal',
    'normal',
    'normal',
    'high',
    'urgent',
  ];

  const rfqs: Rfq[] = [];
  for (let i = 0; i < 50; i++) {
    const lineCount = randint(rand, 1, 4);
    const lines: RfqLine[] = [];
    const usedSkus = new Set<string>();
    while (lines.length < lineCount) {
      const [sku, description, unit, refPrice] = pick(rand, SKU_CATALOG);
      if (usedSkus.has(sku)) continue;
      usedSkus.add(sku);
      lines.push({
        sku,
        description,
        quantity: randint(rand, 1, 25),
        unit,
        target_price: chance(rand, 0.6) ? Math.round(refPrice * (0.9 + rand() * 0.2)) : null,
      });
    }
    const vendorCount = randint(rand, 1, 3);
    const vendorIds = Array.from({ length: vendorCount }, () => pick(rand, vendors).id);
    const dedupedVendorIds = Array.from(new Set(vendorIds));
    const createdOffset = randint(rand, -120, -1);
    const dueOffset = createdOffset + randint(rand, 7, 45);
    const state = pick(rand, rfqStates);
    const awardedVendorId =
      state === 'awarded' ? pick(rand, dedupedVendorIds) : null;
    rfqs.push({
      id: `RFQ-2026-${pad(i + 1, 4)}`,
      title: `${pick(rand, ['Procure', 'Replenish', 'Replace', 'Source'])} ${lines[0].description}`,
      vendor_ids: dedupedVendorIds,
      state,
      priority: pick(rand, priorities),
      requestor: pick(rand, REQUESTORS),
      cost_center: pick(rand, COST_CENTERS),
      due_at: isoFromOffset(dueOffset),
      lines,
      notes:
        chance(rand, 0.4)
          ? `Required for ${pick(rand, ['TC', 'HF', 'LeTID', 'BDT', 'RCO', 'GCT'])} test stand`
          : '',
      awarded_vendor_id: awardedVendorId,
      awarded_po_id: null,
      created_at: isoFromOffset(createdOffset),
      updated_at: isoFromOffset(createdOffset + randint(rand, 0, 7)),
    });
  }

  const poStates: ReadonlyArray<PoState> = [
    'draft',
    'issued',
    'issued',
    'acknowledged',
    'acknowledged',
    'partial',
    'received',
    'received',
    'closed',
    'cancelled',
  ];

  const pos: Po[] = [];
  const awardedRfqs = rfqs.filter((r) => r.state === 'awarded');
  for (let i = 0; i < 30; i++) {
    const linkRfq = i < awardedRfqs.length ? awardedRfqs[i] : null;
    const vendorId =
      linkRfq?.awarded_vendor_id ?? pick(rand, vendors).id;
    const lineSource =
      linkRfq?.lines ??
      Array.from({ length: randint(rand, 1, 3) }, () => {
        const [sku, description, unit] = pick(rand, SKU_CATALOG);
        return {
          sku,
          description,
          quantity: randint(rand, 1, 20),
          unit,
          target_price: null,
        } satisfies RfqLine;
      });
    const lines: PoLine[] = lineSource.map((l) => {
      const ref = SKU_CATALOG.find(([sku]) => sku === l.sku);
      const refPrice = ref ? ref[3] : 1000;
      const unit_price =
        l.target_price ?? Math.round(refPrice * (0.95 + rand() * 0.15));
      return {
        sku: l.sku,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unit_price,
        total: unit_price * l.quantity,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * 0.18);
    const state = pick(rand, poStates);
    const createdOffset = randint(rand, -90, -1);
    const issuedOffset =
      state === 'draft' ? null : createdOffset + randint(rand, 1, 5);
    const expectedOffset =
      issuedOffset === null ? null : issuedOffset + randint(rand, 7, 30);
    const receivedOffset =
      state === 'received' || state === 'closed'
        ? (expectedOffset ?? 0) + randint(rand, -3, 4)
        : null;
    const po: Po = {
      id: `PO-2026-${pad(i + 1, 4)}`,
      rfq_id: linkRfq?.id ?? null,
      vendor_id: vendorId,
      state,
      currency: 'INR',
      subtotal,
      tax,
      total: subtotal + tax,
      lines,
      issued_at: issuedOffset === null ? null : isoFromOffset(issuedOffset),
      expected_at: expectedOffset === null ? null : isoFromOffset(expectedOffset),
      received_at: receivedOffset === null ? null : isoFromOffset(receivedOffset),
      notes: '',
      created_at: isoFromOffset(createdOffset),
      updated_at: isoFromOffset(createdOffset + randint(rand, 0, 10)),
    };
    pos.push(po);
    if (linkRfq) linkRfq.awarded_po_id = po.id;
  }

  return { vendors, rfqs, pos };
}
