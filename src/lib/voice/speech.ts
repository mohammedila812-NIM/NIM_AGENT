/**
 * Voice & Speech Synthesis Kernel (Phase 5)
 * Zero-dependency Web Speech API wrapper providing:
 *   1. Speech-to-Intent dictation (SpeechRecognition / webkitSpeechRecognition)
 *   2. Natural executive audio briefings (SpeechSynthesis)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SpeechRecognitionOptions {
  lang?: string;
  interimResults?: boolean;
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface SpeechSynthesisOptions {
  lang?: string;
  rate?: number;  // 0.8 to 1.5
  pitch?: number; // 0.8 to 1.2
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

interface IWindowWithSpeech extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

// ── Speech-to-Text Dictation ──────────────────────────────────────────────────

export class VoiceDictation {
  private recognition: any = null;
  private listening = false;

  public static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as IWindowWithSpeech;
    return !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  }

  /**
   * Tests or primes microphone access via getUserMedia.
   * In Chrome extensions, granting access on any extension tab enables microphone
   * across all extension pages including the Side Panel.
   */
  public static async primeMicrophone(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  public isListening(): boolean {
    return this.listening;
  }

  public start(options: SpeechRecognitionOptions): boolean {
    if (this.listening) {
      this.stop();
    }

    if (typeof window === 'undefined') return false;
    const win = window as unknown as IWindowWithSpeech;
    const SpeechRecClass = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecClass) {
      options.onError?.('Speech recognition is not supported in this browser.');
      return false;
    }

    try {
      this.recognition = new SpeechRecClass();
      // Continuous listening prevents premature shutdown during brief pauses
      this.recognition.continuous = true;
      this.recognition.interimResults = options.interimResults ?? true;
      this.recognition.lang = options.lang || navigator.language || 'en-US';

      this.recognition.onstart = () => {
        this.listening = true;
      };

      this.recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const item = event.results[i];
          if (item.isFinal) {
            finalTranscript += item[0].transcript;
          } else {
            interimTranscript += item[0].transcript;
          }
        }

        const transcript = (finalTranscript || interimTranscript).trim();
        if (transcript) {
          options.onResult(transcript, !!finalTranscript);
        }
      };

      this.recognition.onerror = (event: any) => {
        // In continuous dictation mode, 'no-speech' is a harmless pause warning
        if (event.error === 'no-speech') {
          return;
        }
        this.listening = false;
        options.onError?.(event.error || 'Speech recognition encountered an error.');
      };

      this.recognition.onend = () => {
        this.listening = false;
        options.onEnd?.();
      };

      this.recognition.start();
      return true;
    } catch (err) {
      this.listening = false;
      options.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  public stop(): void {
    if (this.recognition && this.listening) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
    }
    this.listening = false;
  }
}

// ── Whisper & Local MediaRecorder Speech-to-Text ──────────────────────────────

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private recording = false;

  public isRecording(): boolean {
    return this.recording;
  }

  public async start(): Promise<boolean> {
    if (this.recording) return true;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone audio capture is not supported in this browser context.');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];

      let mimeType = 'audio/webm';
      if (typeof MediaRecorder !== 'undefined') {
        if (typeof MediaRecorder.isTypeSupported === 'function') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/webm')) {
            mimeType = 'audio/webm';
          } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
            mimeType = 'audio/ogg';
          }
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.start(250);
      this.recording = true;
      return true;
    } catch (err) {
      this.recording = false;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      throw err;
    }
  }

  public async stop(): Promise<Blob | null> {
    if (!this.mediaRecorder || !this.recording) {
      return null;
    }

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];
        this.recording = false;

        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = null;
        }

        resolve(audioBlob);
      };

      try {
        this.mediaRecorder!.stop();
      } catch {
        this.recording = false;
        if (this.stream) {
          this.stream.getTracks().forEach((t) => t.stop());
          this.stream = null;
        }
        resolve(null);
      }
    });
  }
}

/**
 * Transcribes audio blob using AI Whisper or Gemini endpoints.
 * Completely immune to Google's chrome-extension:// network error.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  providerId: string,
  apiKey: string,
  customBaseUrl?: string,
): Promise<string> {
  // 1. Groq Whisper (Ultra-fast ~200ms)
  if (providerId === 'groq' && apiKey) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      return (data.text || '').trim();
    }
  }

  // 2. OpenAI Whisper
  if (providerId === 'openai' && apiKey) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      return (data.text || '').trim();
    }
  }

  // 3. NVIDIA NIM Cloud Audio
  if ((providerId === 'nim-cloud' || providerId === 'nim-local') && apiKey) {
    const baseUrl = customBaseUrl || (providerId === 'nim-cloud' ? 'https://integrate.api.nvidia.com/v1' : 'http://localhost:8000/v1');
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'openai/whisper-large-v3');

    try {
      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.text) return data.text.trim();
      }
    } catch {
      // Fallback to other available keys below
    }
  }

  // 4. Gemini Multimodal Transcription
  if (providerId === 'gemini' && apiKey) {
    const base64Data = await blobToBase64(audioBlob);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Transcribe the spoken audio verbatim into plain text. Do not summarize, format, or add commentary. Return ONLY the transcribed words.',
                },
                {
                  inlineData: {
                    mimeType: audioBlob.type || 'audio/webm',
                    data: base64Data,
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    }
  }

  // 5. Check if Groq, OpenAI, or Gemini keys exist in local storage as a fallback
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const saved = await chrome.storage.local.get(['keys:groq', 'keys:openai', 'keys:gemini']);
    if (saved['keys:groq']?.llmApiKey && providerId !== 'groq') {
      return transcribeAudio(audioBlob, 'groq', saved['keys:groq'].llmApiKey);
    }
    if (saved['keys:openai']?.llmApiKey && providerId !== 'openai') {
      return transcribeAudio(audioBlob, 'openai', saved['keys:openai'].llmApiKey);
    }
    if (saved['keys:gemini']?.llmApiKey && providerId !== 'gemini') {
      return transcribeAudio(audioBlob, 'gemini', saved['keys:gemini'].llmApiKey);
    }
  }

  throw new Error(
    'No compatible speech transcription endpoint found for this provider. Add a Groq (Whisper-Turbo), OpenAI, or Gemini key in Settings for instant AI voice transcription.',
  );
}

// ── Text-to-Speech Audio Briefing ─────────────────────────────────────────────

export class AudioBriefing {
  public static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  public static isSpeaking(): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    return window.speechSynthesis.speaking;
  }

  public static stop(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Cleans raw markdown and technical syntax so the read-out sounds natural.
   */
  public static cleanForSpeech(raw: string): string {
    return raw
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, ' Code snippet omitted. ')
      // Remove inline code
      .replace(/`([^`]+)`/g, '$1')
      // Remove images and markdown links [text](url) -> text
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
      // Remove table separator rows (e.g. |---|---| or |:---:|)
      .replace(/^\|?[\s\-:|]+\|?$/gm, '')
      // Convert table column pipe dividers to natural pauses
      .replace(/\|/g, ', ')
      // Remove headers (#, ##, ###)
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bullet points and bold/italics
      .replace(/^[\*\-\+]\s+/gm, '')
      .replace(/[\*_~]{1,3}/g, '')
      // Remove HTML tags
      .replace(/<[^>]*>/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  public static speak(text: string, options?: SpeechSynthesisOptions): boolean {
    if (!this.isSupported()) {
      options?.onError?.('Speech synthesis is not supported in this browser.');
      return false;
    }

    // Cancel any previous speech
    window.speechSynthesis.cancel();

    const spokenText = this.cleanForSpeech(text);
    if (!spokenText) return false;

    try {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      utterance.lang = options?.lang || 'en-US';
      utterance.rate = options?.rate ?? 1.05; // Slightly brisk executive cadence
      utterance.pitch = options?.pitch ?? 1.0;

      // Select high quality natural voice if available
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) => (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Neural')) && v.lang.startsWith('en'),
      ) || voices.find((v) => v.lang.startsWith('en'));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        options?.onStart?.();
      };

      utterance.onend = () => {
        options?.onEnd?.();
      };

      utterance.onerror = (e) => {
        options?.onError?.(e.error);
      };

      window.speechSynthesis.speak(utterance);
      return true;
    } catch (err) {
      options?.onError?.(err instanceof Error ? err.message : String(err));
      return false;
    }
  }
}
