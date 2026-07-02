import { describe, it, expect } from 'vitest';
import {
  approve,
  ApprovalError,
  ISO17025_REPORT_CHECKLIST,
  lock,
  reopen,
  requestChanges,
  submitForReview,
  type ProtocolState,
} from './approval';

const base = (): ProtocolState => ({
  id: 'tc-mqt11',
  title: 'Thermal Cycling 200',
  standard: 'IEC 61215-2:2021 MQT 11',
  author: 'operator.a',
  status: 'draft',
  version: 0,
  trail: [],
});

describe('protocol approval workflow', () => {
  it('happy path: draft → in_review → approved → locked, with audit trail', () => {
    let p = submitForReview(base(), 'operator.a');
    expect(p.status).toBe('in_review');
    p = approve(p, 'quality.mgr');
    expect(p.status).toBe('approved');
    p = lock(p, 'quality.mgr');
    expect(p.status).toBe('locked');
    expect(p.version).toBe(1);
    expect(p.trail.map((t) => t.action)).toEqual([
      'submitted for review',
      'approved',
      'locked as v1 (issued)',
    ]);
    expect(p.trail.every((t) => t.at && t.by)).toBe(true);
  });

  it('four-eyes: the author cannot approve or review their own protocol', () => {
    const p = submitForReview(base(), 'operator.a');
    expect(() => approve(p, 'operator.a')).toThrow(ApprovalError);
    expect(() => requestChanges(p, 'operator.a', 'x')).toThrow(/four-eyes/);
  });

  it('changes_requested loops back and can be resubmitted', () => {
    let p = submitForReview(base(), 'operator.a');
    p = requestChanges(p, 'reviewer.b', 'soak time missing');
    expect(p.status).toBe('changes_requested');
    p = submitForReview(p, 'operator.a');
    expect(p.status).toBe('in_review');
  });

  it('guards: cannot approve a draft, cannot lock unapproved, notes required', () => {
    expect(() => approve(base(), 'quality.mgr')).toThrow(ApprovalError);
    expect(() => lock(base(), 'quality.mgr')).toThrow(ApprovalError);
    const p = submitForReview(base(), 'operator.a');
    expect(() => requestChanges(p, 'reviewer.b', '   ')).toThrow(/note/);
  });

  it('reopen requires a justification and returns to draft', () => {
    let p = submitForReview(base(), 'operator.a');
    p = approve(p, 'quality.mgr');
    p = lock(p, 'quality.mgr');
    expect(() => reopen(p, 'quality.mgr', '')).toThrow(/justification/);
    p = reopen(p, 'quality.mgr', 'edition update 61730-2:2023');
    expect(p.status).toBe('draft');
  });

  it('17025 §7.8.2 checklist covers the mandatory report content', () => {
    expect(ISO17025_REPORT_CHECKLIST.length).toBeGreaterThanOrEqual(10);
    const joined = ISO17025_REPORT_CHECKLIST.join(' ').toLowerCase();
    for (const needle of ['uncertainty', 'method', 'units', 'signature', 'environmental']) {
      expect(joined).toContain(needle);
    }
  });
});
