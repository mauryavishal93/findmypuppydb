import { useState, useCallback } from 'react';
import { Difficulty, Puppy } from '../types';
import { generateLevelTheme, generateLevelImage } from '../services/geminiService';
import { PUPPY_IMAGES } from '../constants/puppyImages';

// Seeded Random Number Generator for consistent but varied randomness
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    // Linear congruential generator
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

// Analyze background image to find good camouflage spots
const analyzeBackgroundColors = async (imageUrl: string): Promise<Array<{x: number, y: number, score: number}>> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve([]);
        return;
      }

      canvas.width = Math.min(img.width, 200); // Sample at lower resolution for performance
      canvas.height = Math.min(img.height, 200);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const candidates: Array<{x: number, y: number, score: number}> = [];

      // Sample grid points (every 10 pixels) to find good camouflage spots
      const step = 10;
      for (let y = step; y < canvas.height - step; y += step) {
        for (let x = step; x < canvas.width - step; x += step) {
          const idx = (y * canvas.width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          
          // Calculate color properties for camouflage scoring
          const brightness = (r + g + b) / 3;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          const variance = Math.sqrt(
            Math.pow(r - brightness, 2) + 
            Math.pow(g - brightness, 2) + 
            Math.pow(b - brightness, 2)
          ) / 3;

          // Good camouflage spots have:
          // - Medium brightness (not too dark/light)
          // - Some color variation (texture)
          // - Lower saturation (easier to blend)
          const score = 
            (brightness > 30 && brightness < 220 ? 1 : 0.3) * // Prefer medium brightness
            (variance > 10 ? 1 : 0.5) * // Prefer areas with some variation
            (saturation < 100 ? 1.2 : 0.8); // Prefer less saturated areas

          // Convert pixel coordinates to percentage
          const percentX = (x / canvas.width) * 100;
          const percentY = (y / canvas.height) * 100;

          // Only consider positions within safe margins
          if (percentX >= 5 && percentX <= 95 && percentY >= 5 && percentY <= 95) {
            candidates.push({ x: percentX, y: percentY, score });
          }
        }
      }

      // Sort by score (best camouflage spots first)
      candidates.sort((a, b) => b.score - a.score);
      resolve(candidates);
    };

    img.onerror = () => {
      resolve([]); // Return empty array if image fails to load
    };

    img.src = imageUrl;
  });
};

interface GameState {
  puppies: Puppy[];
  bgImage: string | null;
  loading: boolean;
  levelTheme: string;
}

export const useGameState = () => {
  const [gameState, setGameState] = useState<GameState>({
    puppies: [],
    bgImage: null,
    loading: false,
    levelTheme: '',
  });

  const initLevel = useCallback(async (level: number, diff: Difficulty) => {
    setGameState(prev => ({ ...prev, loading: true, bgImage: null, puppies: [], levelTheme: '' }));
    
    // Difficulty Progression Logic (Harder every 5 levels)
    const progressionStep = Math.floor((level - 1) / 5);
    
    let puppyCount = 15;
    let baseOpacity = 0.5; 
    let minScale = 0.3; 
    let maxScale = 0.5; 
    
    if (diff === Difficulty.EASY) {
        // Easy: 15 -> 25 puppies, Opacity 0.6 -> 0.4
        puppyCount = Math.min(25, 15 + Math.floor(progressionStep / 2)); 
        baseOpacity = Math.max(0.4, 0.6 - (progressionStep * 0.01));
    } else if (diff === Difficulty.MEDIUM) {
        // Medium: 25 -> 35 puppies, Opacity 0.4 -> 0.25, Scale reduces
        puppyCount = Math.min(35, 25 + Math.floor(progressionStep / 2));
        baseOpacity = Math.max(0.25, 0.4 - (progressionStep * 0.01));
        minScale = Math.max(0.15, 0.25 - (progressionStep * 0.005));
        maxScale = Math.max(0.3, 0.4 - (progressionStep * 0.005));
    } else if (diff === Difficulty.HARD) {
        // Hard: 40 -> 50 puppies, Opacity 0.3 -> 0.15, Scale reduces
        puppyCount = Math.min(50, 40 + Math.floor(progressionStep / 2));
        baseOpacity = Math.max(0.15, 0.3 - (progressionStep * 0.01));
        minScale = Math.max(0.12, 0.2 - (progressionStep * 0.004)); 
        maxScale = Math.max(0.25, 0.35 - (progressionStep * 0.005));
    }

    // Get the textual theme for this level
    const theme = await generateLevelTheme(level, diff);
    
    // Generate the image on the fly using Gemini (with timestamp for uniqueness)
    const timestamp = Date.now();
    const bgImage = await generateLevelImage(theme, level, timestamp);

    // Create seeded random generator for consistent but varied positions
    // Seed includes level, difficulty, and timestamp to ensure different positions each time
    const diffMultiplier = diff === Difficulty.EASY ? 1 : diff === Difficulty.MEDIUM ? 2 : 3;
    const baseSeed = level * 10000 + diffMultiplier * 1000 + (timestamp % 100000);
    const rng = new SeededRandom(baseSeed);

    // Analyze background image for good camouflage spots
    const camouflageSpots = await analyzeBackgroundColors(bgImage);

    const newPuppies: Puppy[] = [];
    let safetyCounter = 0; // Prevent infinite loops
    const margin = 5;
    
    while (newPuppies.length < puppyCount && safetyCounter < 1000) {
      safetyCounter++;
      const scale = rng.nextFloat(minScale, maxScale);
      
      let x: number, y: number;
      
      // Use camouflage analysis if available, otherwise use seeded random
      if (camouflageSpots.length > 0) {
        // Pick from top 70% of camouflage spots (best hiding places)
        const topSpots = camouflageSpots.slice(0, Math.floor(camouflageSpots.length * 0.7));
        const spotIndex = rng.nextInt(topSpots.length);
        const spot = topSpots[spotIndex];
        
        // Add small random offset to avoid exact same positions
        x = Math.max(margin, Math.min(100 - margin, spot.x + rng.nextFloat(-2, 2)));
        y = Math.max(margin, Math.min(100 - margin, spot.y + rng.nextFloat(-2, 2)));
      } else {
        // Fallback to random positioning if analysis fails
        x = margin + rng.nextFloat(0, 100 - (margin * 2));
        y = margin + rng.nextFloat(0, 100 - (margin * 2));
      }
      
      // Check for overlaps
      let overlaps = false;
      for (const p of newPuppies) {
        const dx = x - p.x;
        const dy = y - p.y;
        if (Math.sqrt(dx*dx + dy*dy) < 6) { // Distance check
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        newPuppies.push({
          id: `pup-${newPuppies.length}-${timestamp}-${rng.nextInt(10000)}`,
          x,
          y,
          rotation: rng.nextFloat(0, 360),
          scale,
          isFound: false,
          opacity: Math.max(0.15, baseOpacity - rng.nextFloat(0, 0.1)), 
          hueRotate: rng.nextFloat(0, 360), 
          imageUrl: PUPPY_IMAGES[rng.nextInt(PUPPY_IMAGES.length)],
        });
      }
    }

    setGameState({
      loading: false,
      bgImage,
      puppies: newPuppies,
      levelTheme: theme,
    });

    // Calculate time limit based on difficulty
    let calculatedTimeLimit: number | null = null;
    if (diff === Difficulty.MEDIUM) {
      calculatedTimeLimit = Math.max(120, 150 - (progressionStep * 2));
    } else if (diff === Difficulty.HARD) {
      calculatedTimeLimit = Math.max(150, 180 - (progressionStep * 2));
    }

    return { timeLimit: calculatedTimeLimit };
  }, []);

  const updatePuppy = useCallback((id: string, updates: Partial<Puppy>) => {
    setGameState(prev => ({
      ...prev,
      puppies: prev.puppies.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  }, []);

  return {
    gameState,
    initLevel,
    updatePuppy,
    setGameState
  };
};

