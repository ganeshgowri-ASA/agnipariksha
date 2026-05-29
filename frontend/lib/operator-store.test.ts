/**
 * Operator-store unit tests. Validates stampOperatorContext() defaults +
 * persistence-free behaviour (we test the pure stamping function, not
 * the React hook).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OPERATOR_DEFAULTS,
  setOperatorContext,
  getOperatorContext,
  stampOperatorContext,
  type TestSessionLike,
} from './operator-store';

beforeEach(() => {
  // Reset the in-memory snapshot between tests.
  setOperatorContext({ ...OPERATOR_DEFAULTS });
});

describe('OperatorContext getters and setters', () => {
  it('starts at defaults', () => {
    const ctx = getOperatorContext();
    expect(ctx.operatorName).toBe('');
    expect(ctx.equipmentId).toContain('PV6000');
  });

  it('setOperatorContext merges partial updates', () => {
    setOperatorContext({ operatorName: 'Mounika' });
    expect(getOperatorContext().operatorName).toBe('Mounika');
    setOperatorContext({ customerName: 'Reliance' });
    // operatorName preserved across partial update
    expect(getOperatorContext().operatorName).toBe('Mounika');
    expect(getOperatorContext().customerName).toBe('Reliance');
  });
});

describe('stampOperatorContext()', () => {
  it('fills in defaults when session has nothing set', () => {
    const stamped = stampOperatorContext({ id: 'TC-1', testType: 'tc' } as TestSessionLike);
    expect(stamped.operatorName).toBe('Anonymous');
    expect(stamped.operatorId).toBe('N/A');
    expect(stamped.companyName).toBe('N/A');
    expect(stamped.customerName).toBe('N/A');
    expect(stamped.equipmentId).toContain('PV6000');
    expect(stamped.methodReference).toContain('IEC');
  });

  it('uses operator context when set', () => {
    setOperatorContext({
      operatorName: 'Alice', operatorId: 'EMP-1', companyName: 'ASA Labs',
      customerName: 'Reliance', methodReference: 'SOW-99',
    });
    const stamped = stampOperatorContext({ id: 'HF-1', testType: 'hf' } as TestSessionLike);
    expect(stamped.operatorName).toBe('Alice');
    expect(stamped.operatorId).toBe('EMP-1');
    expect(stamped.companyName).toBe('ASA Labs');
    expect(stamped.customerName).toBe('Reliance');
    expect(stamped.methodReference).toBe('SOW-99');
  });

  it('does not overwrite values explicitly set on the session', () => {
    setOperatorContext({ operatorName: 'StoreDefault' });
    const stamped = stampOperatorContext({ operatorName: 'ExplicitlySet' });
    expect(stamped.operatorName).toBe('ExplicitlySet');
  });

  it('preserves unrelated session fields when passed through', () => {
    interface Extra extends TestSessionLike { id: string; testType: string }
    const input: Extra = { id: 'TC-1', testType: 'tc' };
    const stamped = stampOperatorContext(input);
    expect(stamped.id).toBe('TC-1');
    expect(stamped.testType).toBe('tc');
  });
});
