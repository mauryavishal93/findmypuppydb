import { useEffect, useRef } from 'react';
import { SOUNDS } from '../constants/sounds';

interface UseAudioProps {
  view: string;
  isMuted: boolean;
}

export const useAudio = ({ view, isMuted }: UseAudioProps) => {
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);
  const wasPlayingBeforeHiddenRef = useRef(false);

  useEffect(() => {
    // Initialize audio object once
    if (!ambientAudioRef.current) {
      ambientAudioRef.current = new Audio(SOUNDS.ambient);
      ambientAudioRef.current.loop = true;
      ambientAudioRef.current.volume = 0.2; // Softer background
    }
    
    // Play logic: Only play if logged in (interacted) and not muted
    const shouldPlay = view !== 'LOGIN' && !isMuted;

    if (shouldPlay) {
      const playPromise = ambientAudioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.log("Autoplay prevented:", error);
        });
      }
    } else {
      ambientAudioRef.current.pause();
    }

    return () => {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
      }
    };
  }, [view, isMuted]);

  // Handle visibility change and window focus: pause when app/tab loses focus, resume when focused
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!ambientAudioRef.current) return;

      if (document.visibilityState === 'hidden') {
        // App/tab is hidden - pause music and remember if it was playing
        wasPlayingBeforeHiddenRef.current = !ambientAudioRef.current.paused;
        ambientAudioRef.current.pause();
      } else if (document.visibilityState === 'visible') {
        // App/tab is visible again - resume if conditions are met (music should be playing)
        const shouldPlay = view !== 'LOGIN' && !isMuted;
        if (shouldPlay) {
          const playPromise = ambientAudioRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch(error => {
              console.log("Resume audio prevented:", error);
            });
          }
        }
      }
    };

    const handleWindowBlur = () => {
      if (!ambientAudioRef.current) return;
      // Window lost focus - pause music and remember if it was playing
      wasPlayingBeforeHiddenRef.current = !ambientAudioRef.current.paused;
      ambientAudioRef.current.pause();
    };

    const handleWindowFocus = () => {
      if (!ambientAudioRef.current) return;
      // Window regained focus - resume if conditions are met (music should be playing)
      const shouldPlay = view !== 'LOGIN' && !isMuted;
      if (shouldPlay) {
        const playPromise = ambientAudioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.log("Resume audio prevented:", error);
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [view, isMuted]);

  const playSfx = (type: 'found' | 'clear' | 'hint' | 'pay' | 'fail', isMuted: boolean) => {
    if (isMuted) return;
    try {
      const sfx = new Audio(SOUNDS[type]);
      sfx.volume = type === 'clear' ? 0.5 : 0.4;
      sfx.play().catch(e => console.warn("SFX play failed", e));
    } catch (e) {
      console.error("Audio Error", e);
    }
  };

  return {
    ambientAudioRef,
    playSfx
  };
};

