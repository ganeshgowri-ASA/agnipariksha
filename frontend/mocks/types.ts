/**
 * Procurement domain types for the MSW mock layer.
 *
 * These mirror the shapes the frontend will consume from
 * /api/procurement/{rfq,po,vendor}. The real backend doesn't exist yet —
 * MSW is the source of truth in dev + Playwright until then.
 */

export type VendorCategory =
  | 'electronics'
  | 'mechanical'
  | 'consumables'
  | 'services'
  | 'safety';

export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  category: VendorCategory;
  rating: number;
  on_hold: boolean;
  created_at: string;
  updated_at: string;
}

export type RfqState =
  | 'draft'
  | 'sent'
  | 'received'
  | 'awarded'
  | 'cancelled';

export type RfqPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface RfqLine {
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  target_price: number | null;
}

export interface Rfq {
  id: string;
  title: string;
  vendor_ids: string[];
  state: RfqState;
  priority: RfqPriority;
  requestor: string;
  cost_center: string;
  due_at: string;
  lines: RfqLine[];
  notes: string;
  awarded_vendor_id: string | null;
  awarded_po_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PoState =
  | 'draft'
  | 'issued'
  | 'acknowledged'
  | 'partial'
  | 'received'
  | 'closed'
  | 'cancelled';

export interface PoLine {
  sku: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface Po {
  id: string;
  rfq_id: string | null;
  vendor_id: string;
  state: PoState;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  lines: PoLine[];
  issued_at: string | null;
  expected_at: string | null;
  received_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
