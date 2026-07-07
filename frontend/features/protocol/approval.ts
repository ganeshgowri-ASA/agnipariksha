// Protocol review / check-in / approval workflow (ISO/IEC 17025 alignment).
//
// Pure state machine so it is vitest-covered; the /protocols page renders
// it and persists per-browser until server persistence lands. Enforces the
// four-eyes principle (author may not review/approve their own protocol)
// and keeps an append-only audit trail — both 17025 §7.5/§8.3 expectations
// (control of records / documents). The report-content checklist mirrors
// §7.8.2 so a report cannot be issued with required fields missing.

export type ProtocolStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'locked';

export interface AuditEntry {
  at: string; // ISO timestamp
  by: string;
  action: string;
  note?: string;
}

export interface ProtocolState {
  id: string;
  title: string;
  standard: string;
  author: string;
  status: ProtocolStatus;
  version: number;
  trail: AuditEntry[];
}

export class ApprovalError extends Error {}

function entry(by: string, action: string, note?: string): AuditEntry {
  return { at: new Date().toISOString(), by, action, ...(note ? { note } : {}) };
}

export function submitForReview(p: ProtocolState, by: string): ProtocolState {
  if (p.status !== 'draft' && p.status !== 'changes_requested') {
    throw new ApprovalError(`cannot submit from status "${p.status}"`);
  }
  return { ...p, status: 'in_review', trail: [...p.trail, entry(by, 'submitted for review')] };
}

export function requestChanges(p: ProtocolState, by: string, note: string): ProtocolState {
  if (p.status !== 'in_review') throw new ApprovalError(`cannot request changes from "${p.status}"`);
  if (by === p.author) throw new ApprovalError('four-eyes: the author cannot review their own protocol');
  if (!note.trim()) throw new ApprovalError('a change request needs a note');
  return { ...p, status: 'changes_requested', trail: [...p.trail, entry(by, 'changes requested', note)] };
}

export function approve(p: ProtocolState, by: string): ProtocolState {
  if (p.status !== 'in_review') throw new ApprovalError(`cannot approve from "${p.status}"`);
  if (by === p.author) throw new ApprovalError('four-eyes: the author cannot approve their own protocol');
  return { ...p, status: 'approved', trail: [...p.trail, entry(by, 'approved')] };
}

export function lock(p: ProtocolState, by: string): ProtocolState {
  if (p.status !== 'approved') throw new ApprovalError(`cannot lock from "${p.status}"`);
  return {
    ...p,
    status: 'locked',
    version: p.version + 1,
    trail: [...p.trail, entry(by, `locked as v${p.version + 1} (issued)`)],
  };
}

export function reopen(p: ProtocolState, by: string, note: string): ProtocolState {
  if (p.status !== 'locked' && p.status !== 'approved') {
    throw new ApprovalError(`cannot reopen from "${p.status}"`);
  }
  if (!note.trim()) throw new ApprovalError('reopening needs a justification note');
  return { ...p, status: 'draft', trail: [...p.trail, entry(by, 'reopened as draft', note)] };
}

/** ISO/IEC 17025 §7.8.2 — required report content, shown as a per-protocol
 * pre-issue checklist. */
export const ISO17025_REPORT_CHECKLIST: string[] = [
  'Title ("Test Report") and unique identification on each page',
  'Laboratory name and address; location where tests were performed',
  'Customer name and contact',
  'Method used (IEC standard + clause, incl. edition)',
  'Unambiguous item identification (module MSN, condition on receipt)',
  'Dates: receipt, test performance, report issue',
  'Results with units of measurement',
  'Measurement uncertainty where relevant to validity',
  'Environmental conditions during test',
  'Deviations, additions or exclusions from the method',
  'Name(s), function(s) and signature(s) of person(s) authorising the report',
  'Statement that results relate only to the items tested',
];
