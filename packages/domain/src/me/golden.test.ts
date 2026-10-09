/**
 * Release gate "calculations verified against fixtures" (PRD §10). These golden tests are the
 * acceptance criteria for WS2. They are `todo` until the engines exist; WS2 turns them on.
 */
import { describe, it } from 'vitest';

describe('golden: sizing engine vs Aster fixture', () => {
  it.todo('TAM 5,000 × €20,000 = €100,000,000/year');
  it.todo('SAM (1,400 + 1,100 − 500) × €20,000 = €40,000,000/year');
  it.todo('reachable pool 500 sites, no money value');
  it.todo('SOM base 100 customers, €2,000,000 annual revenue at end of year 3');
  it.todo('SOM upside capped at 120 customers (uncapped 150), €2,400,000');
  it.todo(
    'blocks SAM > TAM, negative overlap, overlap > smaller cohort, mixed units, mixed years, mixed currency',
  );
  it.todo('same input → same output and same inputHash (determinism)');
});

describe('golden: economics engine vs Aster fixture', () => {
  it.todo('downside 50 → €1.0m → €0.60m → €0 after opex (true zero, break-even)');
  it.todo('base 100 → €2.0m → €1.2m → €600k after opex');
  it.todo('upside 120 (capped) → €2.4m → €1.44m → €840k after opex');
  it.todo('one-time €400k returned separately; no per_year value includes it');
  it.todo('cash flow and payback Unavailable with the five missing inputs listed');
  it.todo('break-even customers = 50');
});
