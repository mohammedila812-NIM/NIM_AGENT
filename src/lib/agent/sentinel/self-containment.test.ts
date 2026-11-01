import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  sentinelInjectedWatcher,
  sentinelInjectedStopper,
  sentinelInjectedStatusGetter,
} from './change-detector';
import {
  pressEnterWorker,
  scrollToElementWorker,
  dismissModalWorker,
  detectSecurityChallengeWorker,
} from '../triad/reflector';
import {
  flashSpotlightWorker,
  showCaptchaHUDWorker,
  removeCaptchaHUDWorker,
} from '../triad/spotlight';

function evaluateInIsolatedContext(fn: Function, args: unknown[], initialHtml = '<!DOCTYPE html><html><head><title>Test</title></head><body><div id="root">Root</div></body></html>') {
  const dom = new JSDOM(initialHtml, {
    url: 'https://example.com/app',
    runScripts: 'dangerously',
  });
  const win = dom.window as unknown as Record<string, unknown>;

  const mockChrome = {
    runtime: {
      id: 'mock-ext-id',
      sendMessage: () => {},
    },
  };
  win.chrome = mockChrome;

  // Polyfill AudioContext and layout stubs for jsdom
  (win as any).Element.prototype.scrollIntoView = () => {};
  (win as any).Element.prototype.getClientRects = () => [{}];
  (win as any).Element.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 100,
    top: 0,
    left: 0,
    bottom: 100,
    right: 100,
  });
  win.AudioContext = class {
    state = 'running';
    currentTime = 0;
    destination = {};
    resume = async () => {};
    createOscillator = () => ({
      type: 'sine',
      frequency: { setValueAtTime: () => {} },
      connect: () => {},
      start: () => {},
      stop: () => {},
    });
    createGain = () => ({
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    });
  };

  const fnStr = fn.toString();
  // Using new Function in the isolated JSDOM window prevents closure access to module variables
  const isolatedRunner = new (win.Function as any)(
    'chrome',
    'args',
    `
      const isolatedFn = (${fnStr});
      return isolatedFn.apply(window, args);
    `
  );

  return isolatedRunner(mockChrome, args);
}

describe('Audit Finding 1: Universal executeScript Function Self-Containment', () => {
  it('verifies sentinel change detector workers have no free-variable ReferenceErrors', () => {
    expect(() => {
      evaluateInIsolatedContext(sentinelInjectedWatcher, ['page', 'any', 'any change', 'ask', '', true, 60]);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(sentinelInjectedStopper, []);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(sentinelInjectedStatusGetter, []);
    }).not.toThrow();
  });

  it('verifies reflector fallback workers have no free-variable ReferenceErrors', () => {
    expect(() => {
      evaluateInIsolatedContext(pressEnterWorker, []);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(scrollToElementWorker, ['#root']);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(dismissModalWorker, []);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(detectSecurityChallengeWorker, []);
    }).not.toThrow();
  });

  it('verifies spotlight and captcha HUD workers have no free-variable ReferenceErrors', () => {
    expect(() => {
      evaluateInIsolatedContext(flashSpotlightWorker, [{ x: 50, y: 50 }]);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(showCaptchaHUDWorker, ['Please solve captcha']);
    }).not.toThrow();

    expect(() => {
      evaluateInIsolatedContext(removeCaptchaHUDWorker, []);
    }).not.toThrow();
  });
});
