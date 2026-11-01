import { describe, it, expect, vi, afterEach } from 'vitest';
import { isChromeAIAvailable, promptChromeAI } from './chrome-ai';

describe('Chrome Built-in AI (Gemini Nano) Provider', () => {
  const origAi = (window as any).ai;

  afterEach(() => {
    (window as any).ai = origAi;
    vi.restoreAllMocks();
  });

  describe('isChromeAIAvailable', () => {
    it('returns false when window.ai is missing', async () => {
      delete (window as any).ai;
      const available = await isChromeAIAvailable();
      expect(available).toBe(false);
    });

    it('returns false when languageModel capabilities report no', async () => {
      (window as any).ai = {
        languageModel: {
          capabilities: vi.fn().mockResolvedValue({ available: 'no' }),
          create: vi.fn(),
        },
      };
      const available = await isChromeAIAvailable();
      expect(available).toBe(false);
    });

    it('returns true when languageModel capabilities report readily', async () => {
      (window as any).ai = {
        languageModel: {
          capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
          create: vi.fn(),
        },
      };
      const available = await isChromeAIAvailable();
      expect(available).toBe(true);
    });
  });

  describe('promptChromeAI', () => {
    it('returns null when window.ai is missing', async () => {
      delete (window as any).ai;
      const res = await promptChromeAI('System instructions', 'Analyze text');
      expect(res).toBeNull();
    });

    it('invokes local model and destroys session upon completion', async () => {
      const mockDestroy = vi.fn();
      const mockPrompt = vi.fn().mockResolvedValue('{"entities": ["NVIDIA", "GPU"]}');
      const mockCreate = vi.fn().mockResolvedValue({
        prompt: mockPrompt,
        destroy: mockDestroy,
      });

      (window as any).ai = {
        languageModel: {
          capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
          create: mockCreate,
        },
      };

      const result = await promptChromeAI('Extract entities', 'NVIDIA announced new GPUs.');
      expect(result).toBe('{"entities": ["NVIDIA", "GPU"]}');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: 'Extract entities',
          temperature: 0.2,
        }),
      );
      expect(mockPrompt).toHaveBeenCalledWith('NVIDIA announced new GPUs.');
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it('gracefully catches session runtime errors and cleans up', async () => {
      const mockDestroy = vi.fn();
      const mockPrompt = vi.fn().mockRejectedValue(new Error('VRAM allocation failed'));
      const mockCreate = vi.fn().mockResolvedValue({
        prompt: mockPrompt,
        destroy: mockDestroy,
      });

      (window as any).ai = {
        languageModel: {
          capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
          create: mockCreate,
        },
      };

      const result = await promptChromeAI('Extract entities', 'Test text');
      expect(result).toBeNull();
      expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
  });
});
