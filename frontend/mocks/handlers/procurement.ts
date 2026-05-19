/**
 * MSW handlers for /api/procurement/{vendor,rfq,po}.
 *
 * Surface is intentionally REST-shaped so it can be replaced 1:1 by a
 * real backend later without touching call sites:
 *
 *   GET    /api/procurement/vendor              ?q=&category=&page=&page_size=
 *   POST   /api/procurement/vendor
 *   GET    /api/procurement/vendor/:id
 *   PATCH  /api/procurement/vendor/:id
 *   DELETE /api/procurement/vendor/:id
 *
 *   GET    /api/procurement/rfq                 ?state=&priority=&vendor_id=&q=&page=&page_size=
 *   POST   /api/procurement/rfq
 *   GET    /api/procurement/rfq/:id
 *   PATCH  /api/procurement/rfq/:id
 *   DELETE /api/procurement/rfq/:id
 *
 *   GET    /api/procurement/po                  ?state=&vendor_id=&rfq_id=&q=&page=&page_size=
 *   POST   /api/procurement/po
 *   GET    /api/procurement/po/:id
 *   PATCH  /api/procurement/po/:id
 *   DELETE /api/procurement/po/:id
 *
 *   POST   /api/procurement/__reset             (test-only; reseeds the in-memory store)
 */
import { HttpResponse, http } from 'msw';
import { procurementDb, resetProcurementDb } from '../db';
import type {
  Paginated,
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

const RFQ_STATES: readonly RfqState[] = ['draft', 'sent', 'received', 'awarded', 'cancelled'];
const RFQ_PRIORITIES: readonly RfqPriority[] = ['low', 'normal', 'high', 'urgent'];
const PO_STATES: readonly PoState[] = ['draft', 'issued', 'acknowledged', 'partial', 'received', 'closed', 'cancelled'];
const VENDOR_CATEGORIES: readonly VendorCategory[] = ['electronics', 'mechanical', 'consumables', 'services', 'safety'];

function nowIso(): string {
  return new Date().toISOString();
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

function parsePagination(u: URL): { page: number; pageSize: number } {
  const page = Math.max(1, Number(u.searchParams.get('page') ?? '1') || 1);
  const raw = Number(u.searchParams.get('page_size') ?? '25') || 25;
  const pageSize = Math.max(1, Math.min(100, raw));
  return { page, pageSize };
}

function paginate<T>(items: T[], page: number, pageSize: number): Paginated<T> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    page_size: pageSize,
  };
}

function bad(message: string, status = 400): Response {
  return HttpResponse.json({ error: message }, { status });
}

function notFound(kind: string, id: string): Response {
  return HttpResponse.json({ error: `${kind} ${id} not found` }, { status: 404 });
}

// ---------- vendors ----------

interface VendorCreate {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  category?: unknown;
  rating?: unknown;
  on_hold?: unknown;
}

function normalizeVendor(body: VendorCreate): Omit<Vendor, 'id' | 'created_at' | 'updated_at'> | string {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return 'name is required';
  const category = body.category;
  if (typeof category !== 'string' || !VENDOR_CATEGORIES.includes(category as VendorCategory)) {
    return `category must be one of ${VENDOR_CATEGORIES.join(', ')}`;
  }
  const rating = typeof body.rating === 'number' ? body.rating : 0;
  if (rating < 0 || rating > 5) return 'rating must be 0..5';
  return {
    name,
    email: typeof body.email === 'string' ? body.email : '',
    phone: typeof body.phone === 'string' ? body.phone : '',
    address: typeof body.address === 'string' ? body.address : '',
    category: category as VendorCategory,
    rating,
    on_hold: Boolean(body.on_hold),
  };
}

const vendorHandlers = [
  http.get('*/api/procurement/vendor', ({ request }) => {
    const db = procurementDb();
    const u = new URL(request.url);
    const q = (u.searchParams.get('q') ?? '').toLowerCase().trim();
    const category = u.searchParams.get('category');
    let items = Array.from(db.vendors.values());
    if (category) items = items.filter((v) => v.category === category);
    if (q) items = items.filter((v) => v.name.toLowerCase().includes(q));
    items.sort((a, b) => a.id.localeCompare(b.id));
    const { page, pageSize } = parsePagination(u);
    return HttpResponse.json(paginate(items, page, pageSize));
  }),

  http.post('*/api/procurement/vendor', async ({ request }) => {
    let body: VendorCreate;
    try {
      body = (await request.json()) as VendorCreate;
    } catch {
      return bad('invalid_json');
    }
    const result = normalizeVendor(body);
    if (typeof result === 'string') return bad(result, 422);
    const db = procurementDb();
    db.vendorCounter += 1;
    const ts = nowIso();
    const vendor: Vendor = {
      id: `VND-${pad(db.vendorCounter, 3)}`,
      ...result,
      created_at: ts,
      updated_at: ts,
    };
    db.vendors.set(vendor.id, vendor);
    return HttpResponse.json(vendor, { status: 201 });
  }),

  http.get('*/api/procurement/vendor/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    const v = db.vendors.get(id);
    return v ? HttpResponse.json(v) : notFound('vendor', id);
  }),

  http.patch('*/api/procurement/vendor/:id', async ({ params, request }) => {
    const db = procurementDb();
    const id = String(params.id);
    const v = db.vendors.get(id);
    if (!v) return notFound('vendor', id);
    let patch: Partial<VendorCreate>;
    try {
      patch = (await request.json()) as Partial<VendorCreate>;
    } catch {
      return bad('invalid_json');
    }
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || !patch.name.trim()) return bad('name must not be blank', 422);
      v.name = patch.name.trim();
    }
    if (patch.email !== undefined && typeof patch.email === 'string') v.email = patch.email;
    if (patch.phone !== undefined && typeof patch.phone === 'string') v.phone = patch.phone;
    if (patch.address !== undefined && typeof patch.address === 'string') v.address = patch.address;
    if (patch.category !== undefined) {
      if (typeof patch.category !== 'string' || !VENDOR_CATEGORIES.includes(patch.category as VendorCategory)) {
        return bad(`category must be one of ${VENDOR_CATEGORIES.join(', ')}`, 422);
      }
      v.category = patch.category as VendorCategory;
    }
    if (patch.rating !== undefined) {
      if (typeof patch.rating !== 'number' || patch.rating < 0 || patch.rating > 5) return bad('rating must be 0..5', 422);
      v.rating = patch.rating;
    }
    if (patch.on_hold !== undefined) v.on_hold = Boolean(patch.on_hold);
    v.updated_at = nowIso();
    return HttpResponse.json(v);
  }),

  http.delete('*/api/procurement/vendor/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    if (!db.vendors.delete(id)) return notFound('vendor', id);
    return new HttpResponse(null, { status: 204 });
  }),
];

// ---------- RFQs ----------

interface RfqCreate {
  title?: unknown;
  vendor_ids?: unknown;
  state?: unknown;
  priority?: unknown;
  requestor?: unknown;
  cost_center?: unknown;
  due_at?: unknown;
  lines?: unknown;
  notes?: unknown;
}

function normalizeRfqLines(input: unknown): RfqLine[] | string {
  if (!Array.isArray(input) || input.length === 0) return 'lines must be a non-empty array';
  const out: RfqLine[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return 'line must be an object';
    const r = raw as Record<string, unknown>;
    const sku = typeof r.sku === 'string' ? r.sku.trim() : '';
    if (!sku) return 'line.sku is required';
    const quantity = typeof r.quantity === 'number' ? r.quantity : Number(r.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return 'line.quantity must be > 0';
    out.push({
      sku,
      description: typeof r.description === 'string' ? r.description : '',
      quantity,
      unit: typeof r.unit === 'string' ? r.unit : 'ea',
      target_price:
        r.target_price === undefined || r.target_price === null
          ? null
          : Number(r.target_price),
    });
  }
  return out;
}

function normalizeRfqCreate(body: RfqCreate, db: ReturnType<typeof procurementDb>): Omit<Rfq, 'id' | 'created_at' | 'updated_at' | 'awarded_po_id'> | string {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return 'title is required';
  const vendor_ids = Array.isArray(body.vendor_ids) ? body.vendor_ids.filter((v): v is string => typeof v === 'string') : [];
  for (const vid of vendor_ids) {
    if (!db.vendors.has(vid)) return `unknown vendor ${vid}`;
  }
  const state: RfqState =
    typeof body.state === 'string' && RFQ_STATES.includes(body.state as RfqState)
      ? (body.state as RfqState)
      : 'draft';
  const priority: RfqPriority =
    typeof body.priority === 'string' && RFQ_PRIORITIES.includes(body.priority as RfqPriority)
      ? (body.priority as RfqPriority)
      : 'normal';
  const lines = normalizeRfqLines(body.lines);
  if (typeof lines === 'string') return lines;
  const awarded =
    state === 'awarded' && typeof body.title === 'string' && vendor_ids[0]
      ? vendor_ids[0]
      : null;
  return {
    title,
    vendor_ids,
    state,
    priority,
    requestor: typeof body.requestor === 'string' ? body.requestor : '',
    cost_center: typeof body.cost_center === 'string' ? body.cost_center : '',
    due_at: typeof body.due_at === 'string' ? body.due_at : nowIso(),
    lines,
    notes: typeof body.notes === 'string' ? body.notes : '',
    awarded_vendor_id: awarded,
  };
}

const rfqHandlers = [
  http.get('*/api/procurement/rfq', ({ request }) => {
    const db = procurementDb();
    const u = new URL(request.url);
    const state = u.searchParams.get('state');
    const priority = u.searchParams.get('priority');
    const vendorId = u.searchParams.get('vendor_id');
    const q = (u.searchParams.get('q') ?? '').toLowerCase().trim();
    let items = Array.from(db.rfqs.values());
    if (state) items = items.filter((r) => r.state === state);
    if (priority) items = items.filter((r) => r.priority === priority);
    if (vendorId) items = items.filter((r) => r.vendor_ids.includes(vendorId));
    if (q) items = items.filter((r) => r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const { page, pageSize } = parsePagination(u);
    return HttpResponse.json(paginate(items, page, pageSize));
  }),

  http.post('*/api/procurement/rfq', async ({ request }) => {
    const db = procurementDb();
    let body: RfqCreate;
    try {
      body = (await request.json()) as RfqCreate;
    } catch {
      return bad('invalid_json');
    }
    const normalized = normalizeRfqCreate(body, db);
    if (typeof normalized === 'string') return bad(normalized, 422);
    db.rfqCounter += 1;
    const ts = nowIso();
    const rfq: Rfq = {
      id: `RFQ-2026-${pad(db.rfqCounter, 4)}`,
      ...normalized,
      awarded_po_id: null,
      created_at: ts,
      updated_at: ts,
    };
    db.rfqs.set(rfq.id, rfq);
    return HttpResponse.json(rfq, { status: 201 });
  }),

  http.get('*/api/procurement/rfq/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    const r = db.rfqs.get(id);
    return r ? HttpResponse.json(r) : notFound('rfq', id);
  }),

  http.patch('*/api/procurement/rfq/:id', async ({ params, request }) => {
    const db = procurementDb();
    const id = String(params.id);
    const r = db.rfqs.get(id);
    if (!r) return notFound('rfq', id);
    let patch: Partial<RfqCreate> & { awarded_vendor_id?: unknown };
    try {
      patch = (await request.json()) as Partial<RfqCreate> & { awarded_vendor_id?: unknown };
    } catch {
      return bad('invalid_json');
    }
    if (patch.title !== undefined) {
      if (typeof patch.title !== 'string' || !patch.title.trim()) return bad('title must not be blank', 422);
      r.title = patch.title.trim();
    }
    if (patch.state !== undefined) {
      if (typeof patch.state !== 'string' || !RFQ_STATES.includes(patch.state as RfqState)) {
        return bad(`state must be one of ${RFQ_STATES.join(', ')}`, 422);
      }
      r.state = patch.state as RfqState;
    }
    if (patch.priority !== undefined) {
      if (typeof patch.priority !== 'string' || !RFQ_PRIORITIES.includes(patch.priority as RfqPriority)) {
        return bad(`priority must be one of ${RFQ_PRIORITIES.join(', ')}`, 422);
      }
      r.priority = patch.priority as RfqPriority;
    }
    if (patch.requestor !== undefined && typeof patch.requestor === 'string') r.requestor = patch.requestor;
    if (patch.cost_center !== undefined && typeof patch.cost_center === 'string') r.cost_center = patch.cost_center;
    if (patch.due_at !== undefined && typeof patch.due_at === 'string') r.due_at = patch.due_at;
    if (patch.notes !== undefined && typeof patch.notes === 'string') r.notes = patch.notes;
    if (patch.vendor_ids !== undefined) {
      if (!Array.isArray(patch.vendor_ids)) return bad('vendor_ids must be an array', 422);
      const ids = patch.vendor_ids.filter((v): v is string => typeof v === 'string');
      for (const vid of ids) {
        if (!db.vendors.has(vid)) return bad(`unknown vendor ${vid}`, 422);
      }
      r.vendor_ids = ids;
    }
    if (patch.lines !== undefined) {
      const lines = normalizeRfqLines(patch.lines);
      if (typeof lines === 'string') return bad(lines, 422);
      r.lines = lines;
    }
    if (patch.awarded_vendor_id !== undefined) {
      if (patch.awarded_vendor_id === null) r.awarded_vendor_id = null;
      else if (typeof patch.awarded_vendor_id === 'string') {
        if (!db.vendors.has(patch.awarded_vendor_id)) return bad('unknown awarded_vendor_id', 422);
        r.awarded_vendor_id = patch.awarded_vendor_id;
      }
    }
    r.updated_at = nowIso();
    return HttpResponse.json(r);
  }),

  http.delete('*/api/procurement/rfq/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    if (!db.rfqs.delete(id)) return notFound('rfq', id);
    return new HttpResponse(null, { status: 204 });
  }),
];

// ---------- POs ----------

interface PoCreate {
  rfq_id?: unknown;
  vendor_id?: unknown;
  state?: unknown;
  currency?: unknown;
  lines?: unknown;
  tax_rate?: unknown;
  issued_at?: unknown;
  expected_at?: unknown;
  received_at?: unknown;
  notes?: unknown;
}

function normalizePoLines(input: unknown): PoLine[] | string {
  if (!Array.isArray(input) || input.length === 0) return 'lines must be a non-empty array';
  const out: PoLine[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return 'line must be an object';
    const r = raw as Record<string, unknown>;
    const sku = typeof r.sku === 'string' ? r.sku.trim() : '';
    if (!sku) return 'line.sku is required';
    const quantity = typeof r.quantity === 'number' ? r.quantity : Number(r.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return 'line.quantity must be > 0';
    const unit_price = typeof r.unit_price === 'number' ? r.unit_price : Number(r.unit_price);
    if (!Number.isFinite(unit_price) || unit_price < 0) return 'line.unit_price must be >= 0';
    out.push({
      sku,
      description: typeof r.description === 'string' ? r.description : '',
      quantity,
      unit: typeof r.unit === 'string' ? r.unit : 'ea',
      unit_price,
      total: Math.round(unit_price * quantity),
    });
  }
  return out;
}

const poHandlers = [
  http.get('*/api/procurement/po', ({ request }) => {
    const db = procurementDb();
    const u = new URL(request.url);
    const state = u.searchParams.get('state');
    const vendorId = u.searchParams.get('vendor_id');
    const rfqId = u.searchParams.get('rfq_id');
    const q = (u.searchParams.get('q') ?? '').toLowerCase().trim();
    let items = Array.from(db.pos.values());
    if (state) items = items.filter((p) => p.state === state);
    if (vendorId) items = items.filter((p) => p.vendor_id === vendorId);
    if (rfqId) items = items.filter((p) => p.rfq_id === rfqId);
    if (q) items = items.filter((p) => p.id.toLowerCase().includes(q));
    items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    const { page, pageSize } = parsePagination(u);
    return HttpResponse.json(paginate(items, page, pageSize));
  }),

  http.post('*/api/procurement/po', async ({ request }) => {
    const db = procurementDb();
    let body: PoCreate;
    try {
      body = (await request.json()) as PoCreate;
    } catch {
      return bad('invalid_json');
    }
    const vendor_id = typeof body.vendor_id === 'string' ? body.vendor_id : '';
    if (!vendor_id || !db.vendors.has(vendor_id)) return bad('valid vendor_id is required', 422);
    const rfq_id = typeof body.rfq_id === 'string' ? body.rfq_id : null;
    if (rfq_id && !db.rfqs.has(rfq_id)) return bad(`unknown rfq_id ${rfq_id}`, 422);
    const lines = normalizePoLines(body.lines);
    if (typeof lines === 'string') return bad(lines, 422);
    const state: PoState =
      typeof body.state === 'string' && PO_STATES.includes(body.state as PoState)
        ? (body.state as PoState)
        : 'draft';
    const taxRate = typeof body.tax_rate === 'number' ? body.tax_rate : 0.18;
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const tax = Math.round(subtotal * taxRate);
    db.poCounter += 1;
    const ts = nowIso();
    const po: Po = {
      id: `PO-2026-${pad(db.poCounter, 4)}`,
      rfq_id,
      vendor_id,
      state,
      currency: typeof body.currency === 'string' ? body.currency : 'INR',
      subtotal,
      tax,
      total: subtotal + tax,
      lines,
      issued_at: typeof body.issued_at === 'string' ? body.issued_at : null,
      expected_at: typeof body.expected_at === 'string' ? body.expected_at : null,
      received_at: typeof body.received_at === 'string' ? body.received_at : null,
      notes: typeof body.notes === 'string' ? body.notes : '',
      created_at: ts,
      updated_at: ts,
    };
    db.pos.set(po.id, po);
    if (rfq_id) {
      const rfq = db.rfqs.get(rfq_id);
      if (rfq) {
        rfq.awarded_po_id = po.id;
        rfq.updated_at = ts;
      }
    }
    return HttpResponse.json(po, { status: 201 });
  }),

  http.get('*/api/procurement/po/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    const p = db.pos.get(id);
    return p ? HttpResponse.json(p) : notFound('po', id);
  }),

  http.patch('*/api/procurement/po/:id', async ({ params, request }) => {
    const db = procurementDb();
    const id = String(params.id);
    const p = db.pos.get(id);
    if (!p) return notFound('po', id);
    let patch: Partial<PoCreate>;
    try {
      patch = (await request.json()) as Partial<PoCreate>;
    } catch {
      return bad('invalid_json');
    }
    if (patch.state !== undefined) {
      if (typeof patch.state !== 'string' || !PO_STATES.includes(patch.state as PoState)) {
        return bad(`state must be one of ${PO_STATES.join(', ')}`, 422);
      }
      p.state = patch.state as PoState;
    }
    if (patch.vendor_id !== undefined) {
      if (typeof patch.vendor_id !== 'string' || !db.vendors.has(patch.vendor_id)) return bad('unknown vendor_id', 422);
      p.vendor_id = patch.vendor_id;
    }
    if (patch.rfq_id !== undefined) {
      if (patch.rfq_id === null) p.rfq_id = null;
      else if (typeof patch.rfq_id === 'string') {
        if (!db.rfqs.has(patch.rfq_id)) return bad('unknown rfq_id', 422);
        p.rfq_id = patch.rfq_id;
      }
    }
    if (patch.currency !== undefined && typeof patch.currency === 'string') p.currency = patch.currency;
    if (patch.issued_at !== undefined && (patch.issued_at === null || typeof patch.issued_at === 'string')) {
      p.issued_at = (patch.issued_at as string | null) ?? null;
    }
    if (patch.expected_at !== undefined && (patch.expected_at === null || typeof patch.expected_at === 'string')) {
      p.expected_at = (patch.expected_at as string | null) ?? null;
    }
    if (patch.received_at !== undefined && (patch.received_at === null || typeof patch.received_at === 'string')) {
      p.received_at = (patch.received_at as string | null) ?? null;
    }
    if (patch.notes !== undefined && typeof patch.notes === 'string') p.notes = patch.notes;
    if (patch.lines !== undefined) {
      const lines = normalizePoLines(patch.lines);
      if (typeof lines === 'string') return bad(lines, 422);
      p.lines = lines;
      p.subtotal = lines.reduce((s, l) => s + l.total, 0);
      const taxRate = typeof patch.tax_rate === 'number' ? patch.tax_rate : 0.18;
      p.tax = Math.round(p.subtotal * taxRate);
      p.total = p.subtotal + p.tax;
    }
    p.updated_at = nowIso();
    return HttpResponse.json(p);
  }),

  http.delete('*/api/procurement/po/:id', ({ params }) => {
    const db = procurementDb();
    const id = String(params.id);
    if (!db.pos.delete(id)) return notFound('po', id);
    return new HttpResponse(null, { status: 204 });
  }),
];

const resetHandler = http.post('*/api/procurement/__reset', () => {
  resetProcurementDb();
  return HttpResponse.json({ ok: true });
});

export const procurementHandlers = [
  ...vendorHandlers,
  ...rfqHandlers,
  ...poHandlers,
  resetHandler,
];
