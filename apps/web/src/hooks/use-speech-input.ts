import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// Speech to text through the browser's Web Speech API (Chrome, Edge, Safari).
// The browser does the recognition; in Chrome and Edge the audio goes to the
// browser vendor's speech service. Unsupported browsers get `supported: false`.

interface RecognitionResultList {
  length: number;
  [index: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: RecognitionResultList }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** `onText` receives the whole utterance so far, then once more with `final` true. */
export function useSpeechInput({ lang = 'vi-VN', onText }: { lang?: string; onText: (text: string, final: boolean) => void }) {
  const [Ctor] = useState(recognitionCtor);
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });

  useEffect(() => () => recRef.current?.abort(), []);

  const start = useCallback(() => {
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let text = '';
      let final = false;
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i][0].transcript;
        final = final || event.results[i].isFinal;
      }
      onTextRef.current(text.trim(), final);
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast.error('Trình duyệt chưa cho phép dùng micro. Hãy cho phép micro rồi thử lại.');
      } else if (event.error === 'no-speech') {
        toast('Không nghe thấy giọng nói. Hãy thử nói lại.');
      } else if (event.error !== 'aborted') {
        toast.error('Không nhận dạng được giọng nói. Hãy gõ câu hỏi.');
      }
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setListening(false);
    }
  }, [Ctor, lang]);

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { supported: !!Ctor, listening, start, stop };
}
