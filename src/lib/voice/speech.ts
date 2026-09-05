/**
 * speech.ts
 * ---------
 * Native Web Speech API Voice Recognition Controller for NIM Web Extension.
 * Provides real-time speech-to-text, interim preview streaming, permission management,
 * and seamless fallback for Chrome extension sidepanels.
 */

export interface SpeechRecognitionHandlers {
  onStart?: () => void;
  onInterim?: (interimText: string) => void;
  onResult?: (finalText: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

// Window typing for Web Speech API
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

/**
 * Checks whether microphone access is granted to the extension origin.
 */
export async function checkMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return result.state;
    }
  } catch {
    // Fallback if query not supported for microphone
  }
  return 'unknown';
}

/**
 * Requests microphone permission from the browser.
 * Note: Must be called from a user gesture or tab where permission dialog can display.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop test tracks immediately to free hardware
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the options page in a normal browser tab to display Chrome's native microphone permission prompt.
 */
export function openMicrophonePermissionPage(): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const optionsUrl = chrome.runtime.getURL('options.html#mic-permission');
      if (chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: optionsUrl });
      } else if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(optionsUrl, '_blank');
      }
    } else {
      window.open('options.html#mic-permission', '_blank');
    }
  } catch (err) {
    console.warn('Failed to open microphone permission page:', err);
  }
}

export class WebSpeechRecognizer {
  private recognition: any = null;
  private isListening: boolean = false;
  private shouldBeListening: boolean = false;
  private handlers: SpeechRecognitionHandlers = {};
  private finalTranscript: string = '';
  private currentInterim: string = '';

  constructor() {
    this.initRecognition();
  }

  private initRecognition() {
    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechClass) {
      try {
        this.recognition = new SpeechClass();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 1;
        this.recognition.lang = 'en-US';

        this.recognition.onstart = () => {
          this.isListening = true;
          this.handlers.onStart?.();
        };

        this.recognition.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const item = event.results[i];
            const text = item[0]?.transcript || '';
            if (item.isFinal) {
              this.finalTranscript += text + ' ';
            } else {
              interim += text;
            }
          }

          this.currentInterim = interim;
          const fullPreview = (this.finalTranscript + interim).trim();
          if (fullPreview) {
            this.handlers.onInterim?.(fullPreview);
          }
        };

        this.recognition.onerror = (event: any) => {
          const err = event.error || 'speech_recognition_error';
          
          if (err === 'no-speech') {
            // Harmless silence timeout, keep listening
            return;
          }

          if (err === 'not-allowed' || err === 'service-not-allowed') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.handlers.onError?.('permission-denied');
            return;
          }

          if (err === 'audio-capture') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.handlers.onError?.('no-mic-found');
            return;
          }

          // Other transient errors
          this.handlers.onError?.(err);
        };

        this.recognition.onend = () => {
          this.isListening = false;
          if (this.shouldBeListening) {
            // Restart automatically if user hasn't explicitly stopped
            try {
              this.recognition.start();
              return;
            } catch {
              // Ignore restart error and finalize
            }
          }

          const result = (this.finalTranscript + this.currentInterim).trim();
          if (result) {
            this.handlers.onResult?.(result);
          }
          this.handlers.onEnd?.();
        };
      } catch (e) {
        console.warn('SpeechRecognition initialization error:', e);
        this.recognition = null;
      }
    }
  }

  public get isSupported(): boolean {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  public get active(): boolean {
    return this.isListening;
  }

  public async start(handlers: SpeechRecognitionHandlers): Promise<boolean> {
    if (!this.recognition) {
      this.initRecognition();
      if (!this.recognition) {
        handlers.onError?.('Web Speech API is not supported in this browser.');
        return false;
      }
    }

    if (this.isListening) {
      this.stop();
    }

    this.handlers = handlers;
    this.finalTranscript = '';
    this.currentInterim = '';
    this.shouldBeListening = true;

    try {
      this.recognition.start();
      return true;
    } catch (err: any) {
      if (err.name === 'InvalidStateError' || err.message?.includes('already started')) {
        this.isListening = true;
        return true;
      }
      this.shouldBeListening = false;
      this.isListening = false;
      handlers.onError?.(err.message || 'Failed to start microphone');
      return false;
    }
  }

  public stop() {
    this.shouldBeListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop error
      }
    }
    this.isListening = false;
  }

  public toggle(handlers: SpeechRecognitionHandlers): boolean {
    if (this.isListening || this.shouldBeListening) {
      this.stop();
      return false;
    } else {
      void this.start(handlers);
      return true;
    }
  }
}

let _recognizerInstance: WebSpeechRecognizer | null = null;

export function getWebSpeechRecognizer(): WebSpeechRecognizer {
  if (!_recognizerInstance) {
    _recognizerInstance = new WebSpeechRecognizer();
  }
  return _recognizerInstance;
}
