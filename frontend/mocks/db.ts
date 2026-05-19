/**
 * In-memory store for the procurement MSW layer.
 *
 * The seed runs once per worker/server start. Mutations made through the
 * handlers (POST/PATCH/DELETE) live in the same in-memory tables until
 * the worker is restarted. The dataset is intentionally not persisted —
 * tests should not depend on cross-session state.
 */
import { seedProcurement } from './seed/procurement';
import type { Po, Rfq, Vendor } from './types';

interface ProcurementDb {
  vendors: Map<string, Vendor>;
  rfqs: Map<string, Rfq>;
  pos: Map<string, Po>;
  rfqCounter: number;
  poCounter: number;
  vendorCounter: number;
}

function loadSeed(): ProcurementDb {
  const { vendors, rfqs, pos } = seedProcurement();
  return {
    vendors: new Map(vendors.map((v) => [v.id, v])),
    rfqs: new Map(rfqs.map((r) => [r.id, r])),
    pos: new Map(pos.map((p) => [p.id, p])),
    rfqCounter: rfqs.length,
    poCounter: pos.length,
    vendorCounter: vendors.length,
  };
}

let db: ProcurementDb = loadSeed();

export function procurementDb(): ProcurementDb {
  return db;
}

export function resetProcurementDb(): void {
  db = loadSeed();
}
