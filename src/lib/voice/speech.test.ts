import { describe, it, expect, vi, afterEach } from 'vitest';
import { AudioBriefing, VoiceDictation, VoiceRecorder, transcribeAudio } from './speech';

describe('Voice & Audio Synthesis Kernel', () => {
  describe('AudioBriefing.cleanForSpeech', () => {
    it('removes code blocks and inserts snippet disclaimer', () => {
      const raw = 'Here is the fix:\n```typescript\nconst a = 10;\n```\nIt works!';
      const cleaned = AudioBriefing.cleanForSpeech(raw);
      expect(cleaned).toContain('Here is the fix:');
      expect(cleaned).toContain('Code snippet omitted.');
      expect(cleaned).toContain('It works!');
      expect(cleaned).not.toContain('const a = 10');
    });

    it('strips markdown headers, bold, italics, and inline code', () => {
      const raw = '### Executive Summary\nThis is **crucial** and *urgent* with `config.json`.';
      const cleaned = AudioBriefing.cleanForSpeech(raw);
      expect(cleaned).toBe('Executive Summary This is crucial and urgent with config.json.');
    });

    it('strips markdown links keeping link text, and removes image embeds', () => {
      const raw = 'Visit [NVIDIA Developer](https://developer.nvidia.com) for details. ![Logo](https://img.png)';
      const cleaned = AudioBriefing.cleanForSpeech(raw);
      expect(cleaned).toBe('Visit NVIDIA Developer for details.');
    });

    it('cleans markdown tables into comma-separated phrases', () => {
      const raw = '| Metric | Value |\n|---|---|\n| Accuracy | 98% |';
      const cleaned = AudioBriefing.cleanForSpeech(raw);
      expect(cleaned).toContain('Metric , Value');
      expect(cleaned).toContain('Accuracy , 98%');
    });

    it('removes bullet point symbols and HTML tags', () => {
      const raw = '- First point <span class="badge">new</span>\n* Second point';
      const cleaned = AudioBriefing.cleanForSpeech(raw);
      expect(cleaned).toBe('First point new Second point');
    });
  });

  describe('AudioBriefing Web Speech synthesis API integration', () => {
    const originalSpeechSynthesis = window.speechSynthesis;

    afterEach(() => {
      window.speechSynthesis = originalSpeechSynthesis;
      vi.restoreAllMocks();
    });

    it('detects lack of speech synthesis if missing from window', () => {
      // @ts-expect-error test mock
      delete window.speechSynthesis;
      expect(AudioBriefing.isSupported()).toBe(false);
      expect(AudioBriefing.isSpeaking()).toBe(false);
    });

    it('calls speak on window.speechSynthesis when supported', () => {
      const mockSpeak = vi.fn();
      const mockCancel = vi.fn();
      const mockGetVoices = vi.fn().mockReturnValue([
        { name: 'Google US English Natural', lang: 'en-US' },
      ]);

      window.speechSynthesis = {
        speak: mockSpeak,
        cancel: mockCancel,
        getVoices: mockGetVoices,
        speaking: false,
      } as any;

      // Mock SpeechSynthesisUtterance if not defined in jsdom
      if (typeof window.SpeechSynthesisUtterance === 'undefined') {
        (window as any).SpeechSynthesisUtterance = function (text: string) {
          return { text, lang: 'en-US', rate: 1, pitch: 1 };
        };
      }

      expect(AudioBriefing.isSupported()).toBe(true);
      const started = AudioBriefing.speak('# Hello World\nThis is an executive test.');
      expect(started).toBe(true);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockSpeak).toHaveBeenCalled();
    });
  });

  describe('VoiceDictation', () => {
    it('detects whether SpeechRecognition is available', () => {
      const origSR = (window as any).SpeechRecognition;
      const origWSR = (window as any).webkitSpeechRecognition;

      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;
      expect(VoiceDictation.isSupported()).toBe(false);

      (window as any).webkitSpeechRecognition = vi.fn();
      expect(VoiceDictation.isSupported()).toBe(true);

      (window as any).SpeechRecognition = origSR;
      (window as any).webkitSpeechRecognition = origWSR;
    });

    it('gracefully reports error when start is called without browser support', () => {
      const origSR = (window as any).SpeechRecognition;
      const origWSR = (window as any).webkitSpeechRecognition;
      delete (window as any).SpeechRecognition;
      delete (window as any).webkitSpeechRecognition;

      const dictation = new VoiceDictation();
      const onError = vi.fn();
      const started = dictation.start({
        onResult: vi.fn(),
        onError,
      });

      expect(started).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('not supported'));
      expect(dictation.isListening()).toBe(false);

      (window as any).SpeechRecognition = origSR;
      (window as any).webkitSpeechRecognition = origWSR;
    });

    it('handles primeMicrophone correctly across success and failure', async () => {
      const origMediaDevices = navigator.mediaDevices;

      // When mediaDevices is missing
      // @ts-expect-error test mock
      delete navigator.mediaDevices;
      const deniedWithoutApi = await VoiceDictation.primeMicrophone();
      expect(deniedWithoutApi).toBe(false);

      // When getUserMedia resolves
      const mockStop = vi.fn();
      const mockGetUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: mockStop }],
      });
      // @ts-expect-error test mock
      navigator.mediaDevices = { getUserMedia: mockGetUserMedia };

      const granted = await VoiceDictation.primeMicrophone();
      expect(granted).toBe(true);
      expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(mockStop).toHaveBeenCalled();

      // When getUserMedia rejects (permission denied / not-allowed)
      mockGetUserMedia.mockRejectedValue(new Error('Permission denied'));
      const denied = await VoiceDictation.primeMicrophone();
      expect(denied).toBe(false);

      // Restore
      // @ts-expect-error test mock
      navigator.mediaDevices = origMediaDevices;
    });

    it('initializes SpeechRecognition with continuous: true and processes speech results', () => {
      let instanceCreated: any = null;
      class MockSpeechRecognition {
        continuous = false;
        interimResults = false;
        lang = '';
        onstart: any = null;
        onresult: any = null;
        onerror: any = null;
        onend: any = null;
        start = vi.fn().mockImplementation(() => {
          this.onstart?.();
        });
        stop = vi.fn().mockImplementation(() => {
          this.onend?.();
        });
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          instanceCreated = this;
        }
      }

      (window as any).SpeechRecognition = MockSpeechRecognition;
      const dictation = new VoiceDictation();
      const onResult = vi.fn();
      const onError = vi.fn();

      const started = dictation.start({ onResult, onError });
      expect(started).toBe(true);
      expect(dictation.isListening()).toBe(true);
      expect(instanceCreated.continuous).toBe(true);

      // Simulate interim and final results
      const mockResultItem: any = [{ transcript: 'open github' }];
      mockResultItem.isFinal = true;
      const mockEvent = {
        resultIndex: 0,
        results: [mockResultItem],
      };

      instanceCreated.onresult(mockEvent);
      expect(onResult).toHaveBeenCalledWith('open github', true);

      // Ignore harmless 'no-speech' in continuous mode
      instanceCreated.onerror({ error: 'no-speech' });
      expect(dictation.isListening()).toBe(true);
      expect(onError).not.toHaveBeenCalled();

      // Stop dictation
      dictation.stop();
      expect(dictation.isListening()).toBe(false);
    });
  });

  describe('VoiceRecorder & AI Whisper Audio Transcriber', () => {
    it('records audio chunks and produces a blob upon stop', async () => {
      const mockStopTrack = vi.fn();

      class MockMediaRecorder {
        mimeType = 'audio/webm';
        ondataavailable: any = null;
        onstop: any = null;
        start = vi.fn().mockImplementation(() => {
          setTimeout(() => {
            this.ondataavailable?.({ data: new Blob(['fake audio'], { type: 'audio/webm' }) });
          }, 0);
        });
        stop = vi.fn().mockImplementation(() => {
          this.onstop?.();
        });
        static isTypeSupported = vi.fn().mockReturnValue(true);
      }

      (window as any).MediaRecorder = MockMediaRecorder;

      const mockGetUserMedia = vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: mockStopTrack }],
      });
      // @ts-expect-error test mock
      navigator.mediaDevices = { getUserMedia: mockGetUserMedia };

      const recorder = new VoiceRecorder();
      const started = await recorder.start();
      expect(started).toBe(true);
      expect(recorder.isRecording()).toBe(true);

      // Small yield to let ondataavailable fire
      await new Promise((r) => setTimeout(r, 10));

      const blob = await recorder.stop();
      expect(blob).toBeInstanceOf(Blob);
      expect(recorder.isRecording()).toBe(false);
      expect(mockStopTrack).toHaveBeenCalled();
    });

    it('transcribes audio via Groq Whisper API endpoint', async () => {
      const fakeBlob = new Blob(['sample audio data'], { type: 'audio/webm' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'navigate to github' }),
      });
      global.fetch = mockFetch;

      const text = await transcribeAudio(fakeBlob, 'groq', 'gsk_test123');
      expect(text).toBe('navigate to github');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer gsk_test123' },
        }),
      );
    });

    it('transcribes audio via OpenAI Whisper API endpoint', async () => {
      const fakeBlob = new Blob(['sample audio data'], { type: 'audio/webm' });
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'scroll down the page' }),
      });
      global.fetch = mockFetch;

      const text = await transcribeAudio(fakeBlob, 'openai', 'sk-test123');
      expect(text).toBe('scroll down the page');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: 'Bearer sk-test123' },
        }),
      );
    });
  });
});
