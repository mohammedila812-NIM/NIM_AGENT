/**
 * speech.ts
 * ---------
 * Native Web Speech API Voice Recognition Controller for NIM Web Extension.
 * Provides real-time speech-to-text, interim preview streaming, and voice command dispatch.
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

export class WebSpeechRecognizer {
  private recognition: any = null;
  private isListening: boolean = false;
  private handlers: SpeechRecognitionHandlers = {};
  private finalTranscript: string = '';

  constructor() {
    const SpeechClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechClass) {
      this.recognition = new SpeechClass();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListening = true;
        this.finalTranscript = '';
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

        if (interim) {
          this.handlers.onInterim?.((this.finalTranscript + interim).trim());
        } else if (this.finalTranscript) {
          this.handlers.onInterim?.(this.finalTranscript.trim());
        }
      };

      this.recognition.onerror = (event: any) => {
        const err = event.error || 'speech_recognition_error';
        if (err !== 'no-speech') {
          this.handlers.onError?.(err);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        const result = this.finalTranscript.trim();
        if (result) {
          this.handlers.onResult?.(result);
        }
        this.handlers.onEnd?.();
      };
    }
  }

  public get isSupported(): boolean {
    return Boolean(this.recognition);
  }

  public get active(): boolean {
    return this.isListening;
  }

  public start(handlers: SpeechRecognitionHandlers): boolean {
    if (!this.recognition) {
      handlers.onError?.('Web Speech API is not supported in this browser.');
      return false;
    }

    if (this.isListening) {
      this.stop();
    }

    this.handlers = handlers;
    try {
      this.recognition.start();
      return true;
    } catch (err: any) {
      handlers.onError?.(err.message || 'Failed to start microphone');
      return false;
    }
  }

  public stop() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
    }
    this.isListening = false;
  }

  public toggle(handlers: SpeechRecognitionHandlers): boolean {
    if (this.isListening) {
      this.stop();
      return false;
    } else {
      return this.start(handlers);
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
