// Non-component helpers for the cyberpunk UI kit. Kept separate from ui.tsx so
// that file only exports components (required for React Fast Refresh / HMR).
import { useState, useEffect } from 'react';

// tick hook — re-renders at an interval
export function useTick(ms = 1000) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setT((v) => v + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

// deterministic hash for stable pseudo-randoms
export function h(s: string, salt = 0) {
  let x = salt;
  for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(x);
}
export function hRand(s: string, salt = 0) {
  return (h(s, salt) % 10000) / 10000;
}

// typewriter reveal
export function useTypewriter(text: string, speed = 20) {
  const [out, setOut] = useState('');
  useEffect(() => {
    setOut('');
    let i = 0;
    const id = setInterval(() => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return out;
}
