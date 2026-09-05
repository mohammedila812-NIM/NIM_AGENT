import { loadProviderKeys, type ProviderKeys } from '../storage/secure';

export interface SpeechRecognitionHandlers {
  onStart?: () => void;
  onInterim?: (interimText: string) => void;
  onResult?: (finalText: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
  onTranscribing?: () => void;
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
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Transcribes recorded audio using the user's configured LLM / Speech API (Groq, OpenAI, Gemini).
 */
export async function transcribeAudioBlob(blob: Blob): Promise<string> {
  // 1. Try configured LLM provider key
  try {
    const local = (await chrome.storage?.local?.get(['activeProviderId'])) as { activeProviderId?: string } | undefined;
    const providerId = local?.activeProviderId || 'nim-cloud';
    const keys = await loadProviderKeys(providerId);

    if (keys?.llmApiKey) {
      // Groq Whisper (Ultra-fast & free)
      if (providerId === 'groq' || keys.llmApiKey.startsWith('gsk_')) {
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-large-v3-turbo');
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${keys.llmApiKey}` },
          body: formData,
        });
        if (res.ok) {
          const json = await res.json();
          if (json.text) return json.text.trim();
        }
      }

      // OpenAI Whisper
      if (providerId === 'openai' || keys.llmApiKey.startsWith('sk-')) {
        const formData = new FormData();
        formData.append('file', blob, 'audio.webm');
        formData.append('model', 'whisper-1');
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${keys.llmApiKey}` },
          body: formData,
        });
        if (res.ok) {
          const json = await res.json();
          if (json.text) return json.text.trim();
        }
      }

      // Gemini 2.0 Audio Transcription
      if (providerId === 'gemini' || keys.llmApiKey.startsWith('AIzaSy')) {
        const base64Audio = await blobToBase64(blob);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${keys.llmApiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: blob.type || 'audio/webm', data: base64Audio } },
                { text: 'Transcribe this user spoken instruction. Output ONLY the exact transcribed text, without quotes or conversational commentary.' }
              ]
            }]
          }),
        });
        if (res.ok) {
          const json = await res.json();
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text.trim();
        }
      }
    }
  } catch (err) {
    console.warn('API audio transcription attempt error:', err);
  }

  // 2. Try desktop bridge local STT if available
  try {
    const formData = new FormData();
    formData.append('file', blob, 'audio.webm');
    const res = await fetch('http://127.0.0.1:7432/api/stt', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.text) return json.text.trim();
    }
  } catch {
    // Desktop not responding
  }

  throw new Error('Web Speech Cloud was unreachable. Configure an API key (Groq, Gemini, or OpenAI) in Settings for instant Whisper voice transcription.');
}

export class WebSpeechRecognizer {
  private recognition: any = null;
  private isListening: boolean = false;
  private shouldBeListening: boolean = false;
  private handlers: SpeechRecognitionHandlers = {};
  private finalTranscript: string = '';
  private currentInterim: string = '';
  
  // MediaRecorder backup
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private hadWebSpeechSuccess: boolean = false;

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
          this.hadWebSpeechSuccess = true;
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
            return;
          }

          if (err === 'not-allowed' || err === 'service-not-allowed') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.stopMediaRecorder();
            this.handlers.onError?.('permission-denied');
            return;
          }

          if (err === 'audio-capture') {
            this.shouldBeListening = false;
            this.isListening = false;
            this.stopMediaRecorder();
            this.handlers.onError?.('no-mic-found');
            return;
          }

          if (err === 'network') {
            // Google Cloud Web Speech returned network error.
            // Don't kill the session! MediaRecorder is still capturing audio in the background!
            console.info('WebSpeech cloud unreachable; using local audio recorder.');
            this.handlers.onInterim?.('🎙️ Recording voice... Click mic to transcribe.');
            return;
          }

          this.handlers.onError?.(err);
        };

        this.recognition.onend = () => {
          if (this.shouldBeListening) {
            try {
              this.recognition.start();
              return;
            } catch {
              // Ignore
            }
          }
        };
      } catch (e) {
        console.warn('SpeechRecognition initialization error:', e);
        this.recognition = null;
      }
    }
  }

  private stopMediaRecorder(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
        }
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = this.recordedChunks.length > 0
          ? new Blob(this.recordedChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' })
          : null;
        if (this.mediaStream) {
          this.mediaStream.getTracks().forEach((t) => t.stop());
          this.mediaStream = null;
        }
        this.mediaRecorder = null;
        resolve(blob);
      };

      try {
        this.mediaRecorder.stop();
      } catch {
        resolve(null);
      }
    });
  }

  public get isSupported(): boolean {
    return Boolean(
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      (navigator.mediaDevices && typeof MediaRecorder !== 'undefined')
    );
  }

  public get active(): boolean {
    return this.isListening;
  }

  public async start(handlers: SpeechRecognitionHandlers): Promise<boolean> {
    this.handlers = handlers;
    this.finalTranscript = '';
    this.currentInterim = '';
    this.shouldBeListening = true;
    this.hadWebSpeechSuccess = false;
    this.recordedChunks = [];

    // 1. Start MediaRecorder as guaranteed local audio capture
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? { mimeType: 'audio/webm;codecs=opus' }
        : MediaRecorder.isTypeSupported('audio/webm')
        ? { mimeType: 'audio/webm' }
        : undefined;

      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };
      this.mediaRecorder.start(250); // Slice every 250ms
      this.isListening = true;
      this.handlers.onStart?.();
    } catch (err: any) {
      this.shouldBeListening = false;
      this.isListening = false;
      handlers.onError?.('permission-denied');
      return false;
    }

    // 2. Also start Web Speech API for real-time live preview if possible
    if (this.recognition) {
      try {
        this.recognition.start();
      } catch (err: any) {
        // Recognition might already be running or unavailable; MediaRecorder will handle it
      }
    }

    return true;
  }

  public async stop(): Promise<void> {
    this.shouldBeListening = false;
    this.isListening = false;

    // Stop Web Speech
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
    }

    // Stop MediaRecorder and get audio blob
    const audioBlob = await this.stopMediaRecorder();

    // 1. If Web Speech produced valid final text, use it directly
    const speechResult = (this.finalTranscript + this.currentInterim).trim();
    if (this.hadWebSpeechSuccess && speechResult) {
      this.handlers.onResult?.(speechResult);
      this.handlers.onEnd?.();
      return;
    }

    // 2. If Web Speech was blocked by network/origin, transcribe audio blob via Whisper/Gemini fallback
    if (audioBlob && audioBlob.size > 1000) {
      try {
        this.handlers.onTranscribing?.();
        const text = await transcribeAudioBlob(audioBlob);
        if (text) {
          this.handlers.onResult?.(text);
        } else {
          this.handlers.onError?.('No speech detected.');
        }
      } catch (err: any) {
        this.handlers.onError?.(err.message || 'Voice transcription failed.');
      }
    } else if (speechResult) {
      this.handlers.onResult?.(speechResult);
    } else {
      this.handlers.onError?.('No speech recorded.');
    }

    this.handlers.onEnd?.();
  }

  public toggle(handlers: SpeechRecognitionHandlers): boolean {
    if (this.isListening || this.shouldBeListening) {
      void this.stop();
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

