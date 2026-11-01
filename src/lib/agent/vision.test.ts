import { describe, it, expect } from 'vitest';
import { inferVisionSupport } from '../llm/model-registry';
import { shouldUseFallbackVision } from './tools/interaction-policy';
import { validateToolCall } from './tools/schemas';

describe('Vision Capability Detection & Gating', () => {
  describe('inferVisionSupport', () => {
    it('correctly identifies models that DO support multimodal vision', () => {
      // NVIDIA NIM Vision
      expect(inferVisionSupport('meta/llama-3.2-11b-vision-instruct')).toBe(true);
      expect(inferVisionSupport('meta/llama-3.2-90b-vision-instruct')).toBe(true);
      expect(inferVisionSupport('nvidia/neva-22b')).toBe(true);
      expect(inferVisionSupport('microsoft/phi-3-vision-128k-instruct')).toBe(true);

      // Google Gemini
      expect(inferVisionSupport('gemini-1.5-flash')).toBe(true);
      expect(inferVisionSupport('gemini-1.5-pro')).toBe(true);
      expect(inferVisionSupport('gemini-2.0-flash')).toBe(true);
      expect(inferVisionSupport('gemini-2.0-flash-exp')).toBe(true);

      // OpenAI
      expect(inferVisionSupport('gpt-4o')).toBe(true);
      expect(inferVisionSupport('gpt-4o-mini')).toBe(true);
      expect(inferVisionSupport('gpt-4-turbo')).toBe(true);
      expect(inferVisionSupport('gpt-4.5-preview')).toBe(true);
      expect(inferVisionSupport('o1')).toBe(true);

      // Anthropic / Claude
      expect(inferVisionSupport('claude-3-5-sonnet-20241022')).toBe(true);
      expect(inferVisionSupport('claude-3-haiku-20240307')).toBe(true);

      // Open Multimodal / Ollama
      expect(inferVisionSupport('llava:latest')).toBe(true);
      expect(inferVisionSupport('bakllava')).toBe(true);
      expect(inferVisionSupport('qwen2.5-vl-72b')).toBe(true);
      expect(inferVisionSupport('pixtral-12b')).toBe(true);
      expect(inferVisionSupport('llama3.2-vision')).toBe(true);
    });

    it('strictly disqualifies text-only models that DO NOT support images', () => {
      // NVIDIA NIM Text Models
      expect(inferVisionSupport('meta/llama-3.3-70b-instruct')).toBe(false);
      expect(inferVisionSupport('meta/llama-3.1-70b-instruct')).toBe(false);
      expect(inferVisionSupport('meta/llama-3.1-8b-instruct')).toBe(false);
      expect(inferVisionSupport('nvidia/nemotron-4-340b-instruct')).toBe(false);
      expect(inferVisionSupport('mistralai/mixtral-8x22b-instruct-v0.1')).toBe(false);
      expect(inferVisionSupport('deepseek-ai/deepseek-r1')).toBe(false);

      // Groq Text Models
      expect(inferVisionSupport('llama-3.3-70b-versatile')).toBe(false);
      expect(inferVisionSupport('llama-3.1-70b-versatile')).toBe(false);
      expect(inferVisionSupport('llama-3.1-8b-instant')).toBe(false);
      expect(inferVisionSupport('mixtral-8x7b-32768')).toBe(false);
      expect(inferVisionSupport('gemma2-9b-it')).toBe(false);

      // Ollama Base Text Models
      expect(inferVisionSupport('llama3.2')).toBe(false);
      expect(inferVisionSupport('llama3.1')).toBe(false);
      expect(inferVisionSupport('llama3')).toBe(false);
      expect(inferVisionSupport('mistral')).toBe(false);

      // OpenAI Text Models
      expect(inferVisionSupport('gpt-3.5-turbo')).toBe(false);
      expect(inferVisionSupport('gpt-4')).toBe(false);
    });
  });

  describe('shouldUseFallbackVision policy enforcement', () => {
    it('returns false unconditionally when model does not support vision', () => {
      // Even if user checked visionOptIn
      expect(shouldUseFallbackVision('Hello world', 0, true, false)).toBe(false);
      // Even if DOM is completely empty
      expect(shouldUseFallbackVision('', 0, false, false)).toBe(false);
      // Even if multiple DOM attempts failed
      expect(shouldUseFallbackVision('', 5, true, false)).toBe(false);
    });

    it('returns true when vision is supported and opt-in or needed', () => {
      // Opt-in active
      expect(shouldUseFallbackVision('Standard text content', 0, true, true)).toBe(true);
      // Short DOM (< 200 chars)
      expect(shouldUseFallbackVision('Tiny', 0, false, true)).toBe(true);
      // Failed attempts >= 2
      expect(shouldUseFallbackVision('Lots of DOM content '.repeat(20), 2, false, true)).toBe(true);
      // Normal DOM with 0 failed attempts and no opt-in -> false
      expect(shouldUseFallbackVision('Lots of DOM content '.repeat(20), 0, false, true)).toBe(false);
    });
  });

  describe('Vision and Continuous Command Schemas', () => {
    it('validates screenshot schema with reason and optional annotateWithMarks', () => {
      const valid1 = validateToolCall({
        tool: 'screenshot',
        reason: 'DOM elements are unlabelled icons on Instagram',
      });
      expect(valid1.success).toBe(true);

      const valid2 = validateToolCall({
        tool: 'screenshot',
        reason: 'Inspecting canvas graphic',
        annotateWithMarks: false,
      });
      expect(valid2.success).toBe(true);

      const invalid = validateToolCall({ tool: 'screenshot', reason: '' });
      expect(invalid.success).toBe(false);
    });

    it('validates visual_inspect tool schema', () => {
      const valid = validateToolCall({
        tool: 'visual_inspect',
        query: 'Is there a red notification dot on the Direct Messages icon?',
        targetElement: 'sidebar-nav',
      });
      expect(valid.success).toBe(true);

      const invalid = validateToolCall({ tool: 'visual_inspect', query: '' });
      expect(invalid.success).toBe(false);
    });

    it('validates auto_advance_media tool schema for reels and shorts', () => {
      const startCall = validateToolCall({
        tool: 'auto_advance_media',
        action: 'start',
        maxReels: 50,
        scrollKey: 'ArrowDown',
      });
      expect(startCall.success).toBe(true);

      const stopCall = validateToolCall({
        tool: 'auto_advance_media',
        action: 'stop',
      });
      expect(stopCall.success).toBe(true);

      const statusCall = validateToolCall({
        tool: 'auto_advance_media',
        action: 'status',
      });
      expect(statusCall.success).toBe(true);
    });
  });

  describe('Non-Vision Image Stripping & Clean Formatting', () => {
    it('strips base64 image prefixes cleanly when model does not support vision', () => {
      const mockResultWithImage = '[IMAGE_DATA:data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==] Viewport screenshot captured successfully.';

      // Simulate non-vision model handling in react-loop
      const supportsVision = false;
      let toolTextContent = mockResultWithImage;

      if (mockResultWithImage.startsWith('[IMAGE_DATA:') && mockResultWithImage.includes(']')) {
        const endIdx = mockResultWithImage.indexOf(']');
        const restText = mockResultWithImage.slice(endIdx + 1).trim();

        if (supportsVision) {
          toolTextContent = restText;
        } else {
          toolTextContent = restText || 'Visual capture completed (Image omitted: active model does not support multimodal vision inputs).';
        }
      }

      expect(toolTextContent).toBe('Viewport screenshot captured successfully.');
      expect(toolTextContent).not.toContain('IMAGE_DATA');
      expect(toolTextContent).not.toContain('base64');
    });

    it('extracts image_url properly when model DOES support vision', () => {
      const mockResultWithImage = '[IMAGE_DATA:data:image/png;base64,sample123] Visual inspection found 1 unread message.';

      const supportsVision = true;
      let toolTextContent = mockResultWithImage;
      let attachedImage: { type: string; image_url: { url: string } } | null = null;

      if (mockResultWithImage.startsWith('[IMAGE_DATA:') && mockResultWithImage.includes(']')) {
        const endIdx = mockResultWithImage.indexOf(']');
        const dataUrl = mockResultWithImage.slice('[IMAGE_DATA:'.length, endIdx);
        const restText = mockResultWithImage.slice(endIdx + 1).trim();

        if (supportsVision) {
          toolTextContent = restText || 'Viewport screenshot captured.';
          attachedImage = { type: 'image_url', image_url: { url: dataUrl } };
        }
      }

      expect(toolTextContent).toBe('Visual inspection found 1 unread message.');
      expect(attachedImage?.image_url.url).toBe('data:image/png;base64,sample123');
    });
  });
});
