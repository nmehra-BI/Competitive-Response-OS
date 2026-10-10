import type { Assumption } from '@growth-os/contracts';
import { describe, expect, it } from 'vitest';
import { compareAssumptions, groupRegister } from './register';

const asm = (
  key: string,
  sensitivity: Assumption['sensitivity'],
  quality: string,
  group: string,
  status = 'testing',
) =>
  ({
    key,
    sensitivity,
    registerGroup: group,
    status,
    current: { evidenceQuality: quality },
  }) as unknown as Assumption;

describe('assumption register order', () => {
  it('groups Test first → Test next → Watch → Monitor and drops empty groups', () => {
    const groups = groupRegister([
      asm('ASM-08', 'medium', 'some', 'monitor'),
      asm('ASM-01', 'high', 'weak', 'test_first'),
      asm('ASM-07', 'high', 'some', 'test_next'),
    ]);
    expect(groups.map((g) => g.group)).toEqual(['test_first', 'test_next', 'monitor']);
  });

  it('sorts by sensitivity, then evidence (weakest first), never by a combined score', () => {
    const items = [
      asm('ASM-04', 'high', 'weak', 'test_first'),
      asm('ASM-06', 'high', 'none', 'test_first'),
      asm('ASM-02', 'medium', 'none', 'test_first'),
      asm('ASM-01', 'high', 'weak', 'test_first'),
    ];
    expect([...items].sort(compareAssumptions).map((a) => a.key)).toEqual([
      'ASM-06',
      'ASM-01',
      'ASM-04',
      'ASM-02',
    ]);
  });

  it('leaves retired assumptions out of the register', () => {
    const groups = groupRegister([asm('ASM-01', 'high', 'weak', 'test_first', 'retired')]);
    expect(groups).toEqual([]);
  });
});
