import { describe, it, expect } from 'vitest';
import {
  parseNumericValue,
  fastStringHash,
  cleanMessagingSnippet,
  evaluateConditionPredicate,
} from './predicates';

describe('Sentinel Structured Predicates & Helpers', () => {
  describe('parseNumericValue', () => {
    it('parses standard numbers', () => {
      expect(parseNumericValue('123.45')).toBe(123.45);
      expect(parseNumericValue('-42')).toBe(-42);
    });

    it('strips currency signs and commas', () => {
      expect(parseNumericValue('$1,299.99')).toBe(1299.99);
      expect(parseNumericValue('€45.50')).toBe(45.50);
      expect(parseNumericValue('£3,000')).toBe(3000);
      expect(parseNumericValue('₹1,49,999')).toBe(149999);
      expect(parseNumericValue('Price: $19.99 sale!')).toBe(19.99);
    });

    it('returns null when no number is found', () => {
      expect(parseNumericValue('Out of stock')).toBeNull();
      expect(parseNumericValue('')).toBeNull();
    });
  });

  describe('fastStringHash', () => {
    it('generates deterministic hexadecimal hashes', () => {
      const h1 = fastStringHash('Hello World');
      const h2 = fastStringHash('Hello World');
      const h3 = fastStringHash('Different text');

      expect(h1).toBe(h2);
      expect(h1).not.toBe(h3);
      expect(typeof h1).toBe('string');
    });
  });

  describe('cleanMessagingSnippet', () => {
    it('strips relative timestamps and presence indicators', () => {
      expect(cleanMessagingSnippet('Ali: Hi · 1m')).toBe('Ali: Hi');
      expect(cleanMessagingSnippet('Sara: Ok • 5h')).toBe('Sara: Ok');
      expect(cleanMessagingSnippet('John: See you! · just now')).toBe('John: See you!');
      expect(cleanMessagingSnippet('Alex: Here 10 mins ago')).toBe('Alex: Here');
      expect(cleanMessagingSnippet('Mia: Hello active now')).toBe('Mia: Hello');
      expect(cleanMessagingSnippet('Dave: Hey 12:34 PM')).toBe('Dave: Hey');
    });
  });

  describe('evaluateConditionPredicate', () => {
    it('evaluates numeric comparisons (<, <=, >, >=, ==)', () => {
      expect(evaluateConditionPredicate('< 200', '$149.99').matched).toBe(true);
      expect(evaluateConditionPredicate('< 200', '$249.99').matched).toBe(false);
      expect(evaluateConditionPredicate('>= 100', '100').matched).toBe(true);
      expect(evaluateConditionPredicate('> 50', '50').matched).toBe(false);
      expect(evaluateConditionPredicate('== 0', '0 items').matched).toBe(true);
    });

    it('evaluates contains: <substring>', () => {
      expect(evaluateConditionPredicate('contains: discount', 'Great discount today!').matched).toBe(true);
      expect(evaluateConditionPredicate('contains: promo', 'Regular price').matched).toBe(false);
    });

    it('evaluates regex: <pattern>', () => {
      expect(evaluateConditionPredicate('regex: \\bfree shipping\\b', 'Order now with free shipping!').matched).toBe(true);
      expect(evaluateConditionPredicate('regex: \\bfree shipping\\b', 'Paid delivery').matched).toBe(false);
    });

    it('evaluates generic any condition', () => {
      expect(evaluateConditionPredicate('any', 'arbitrary content').matched).toBe(true);
      expect(evaluateConditionPredicate('', 'arbitrary content').matched).toBe(true);
    });
  });
});
