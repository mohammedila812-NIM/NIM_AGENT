import { describe, it, expect } from 'vitest';
import { extractNumericPrice } from './watch-engine';
import { executeCreateWatch, executeListWatches, executeDeleteWatch } from './tools/watch-tools';
import { listWatches, deleteWatch } from '../storage/watch';

describe('Watch Engine & Tools', () => {
  it('extracts numeric prices from various currency strings', () => {
    expect(extractNumericPrice('$1,299.99')).toBe(1299.99);
    expect(extractNumericPrice('€649.00')).toBe(649);
    expect(extractNumericPrice('£49.50')).toBe(49.5);
    expect(extractNumericPrice('₹12,499')).toBe(12499);
    expect(extractNumericPrice('Price: $899 USD')).toBe(899);
    expect(extractNumericPrice('No price here')).toBeNull();
  });

  it('creates, lists, and deletes monitors via tool executors', async () => {
    // 1. Create Watch
    const createOutput = await executeCreateWatch({
      name: 'MacBook Air M3 Price',
      url: 'https://apple.com/macbook-air',
      type: 'price',
      intervalMinutes: 15,
      conditionPrompt: 'Price below $999',
    });

    expect(createOutput).toContain('MONITOR CREATED SUCCESSFULLY');
    expect(createOutput).toContain('MacBook Air M3 Price');
    expect(createOutput).toContain('Every 15 minute(s)');

    // 2. List Watches
    const listOutput = await executeListWatches();
    expect(listOutput).toContain('SCHEDULED MONITORS');
    expect(listOutput).toContain('MacBook Air M3 Price');

    // 3. Find created watch ID
    const all = await listWatches();
    const created = all.find((w) => w.name === 'MacBook Air M3 Price');
    expect(created).toBeDefined();

    // 4. Delete Watch
    if (created) {
      const deleteOutput = await executeDeleteWatch(created.watchId);
      expect(deleteOutput).toContain('MONITOR DELETED');
      expect(await listWatches()).toHaveLength(0);
    }
  });
});
