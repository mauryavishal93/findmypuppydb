import { GoogleGenAI } from "@google/genai";
import { Difficulty } from "../types";

// Lazy-load Gemini API instance (only when API key is available)
let aiInstance: GoogleGenAI | null = null;

const getAI = (): GoogleGenAI => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing in environment variables");
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
};

// --- THEMES ---
const THEMES = [
  "A sunlit cottage kitchen table in morning light",
  "A cozy explorer's desk by a window in autumn",
  "A vintage sewing corner bathed in soft afternoon sun",
  "A lush secret garden nook with blooming hydrangeas",
  "A storybook herbalist's hut interior",
  "A peaceful sunroom filled with ferns",
  "A picnic on a checkered blanket in evening light",
  "A dusty attic window seat with soft sunbeams",
  "A greenhouse shelf crowded with succulents",
  "A bakery counter in a village",
  "A magical potion shop counter",
  "A rustic toolshed workbench",
  "A vintage candy shop display",
  "A painter's easel in a meadow",
  "A cozy reading nook with a plush armchair",
  "A forest floor covered in moss and mushrooms",
  "A seaside rock pool with colorful shells",
  "A vintage vanity table with perfume bottles",
  "A cluttered antique shop shelf",
  "A festive holiday fireplace mantle",
  "A treehouse floor scattered with toys",
  "A japanese tea ceremony set",
  "A wizard's alchemy table",
  "A farmer's market stall",
  "A cozy bedroom window sill"
];

// Curated list of high-quality images to use when AI generation fails (Quota limit/Error)
// Using reliable Unsplash images instead of potentially broken external links
const FALLBACK_BG_IMAGES = [
"https://mauryavishal93.github.io/FindMyPuppy/asset/1.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/2.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/3.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/4.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/5.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/6.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/7.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/8.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/9.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/10.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/11.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/12.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/13.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/14.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/15.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/16.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/17.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/18.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/19.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/20.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/21.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/22.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/23.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/24.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/25.png",
  "https://mauryavishal93.github.io/FindMyPuppy/asset/26.png"
];

// --- BROWSER CACHE IMPLEMENTATION (IndexedDB) ---
const DB_NAME = 'FindMyPuppyDB';
const STORE_NAME = 'bg_images';
const DB_VERSION = 1;

// Helper to open DB
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
  });
};

// Save image data to cache
const saveToCache = async (imageData: string) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.add({ data: imageData, timestamp: Date.now() });
    console.log("Image saved to browser cache.");
  } catch (err) {
    console.error("Failed to save image to cache:", err);
  }
};

// Get a random image from cache
const getRandomFromCache = async (): Promise<string | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const keyRequest = store.getAllKeys();
      
      keyRequest.onsuccess = () => {
        const keys = keyRequest.result;
        if (keys.length === 0) {
          resolve(null);
          return;
        }
        // Pick a random key
        const randomKey = keys[Math.floor(Math.random() * keys.length)];
        const dataRequest = store.get(randomKey);
        dataRequest.onsuccess = () => {
           resolve(dataRequest.result?.data || null);
        };
        dataRequest.onerror = () => resolve(null);
      };
      keyRequest.onerror = () => resolve(null);
    });
  } catch (err) {
    console.error("Failed to read from cache:", err);
    return null;
  }
};

export const generateLevelTheme = async (levelId: number, _difficulty: Difficulty): Promise<string> => {
  return THEMES[(levelId - 1) % THEMES.length];
};

export const generateLevelImage = async (theme: string, levelId: number): Promise<string> => {
  try {
    const ai = getAI();
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a detailed, top-down view illustration suitable for a hidden object game background. 
                   The scene is: ${theme}. 
                   Variation ID: ${levelId}-${Math.random().toString(36).substring(7)}.
                   Style: Colorful, cozy, semi-realistic or detailed artistic style. 
                   Composition: Cluttered with many small objects and textures to make finding items challenging. 
                   Perspective: Top-down or high-angle isometric. 
                   Important: Do not include any dogs or puppies in the background image itself. 
                   Do not include text or UI elements.`
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const generatedImage = `data:image/png;base64,${part.inlineData.data}`;
        // Save to browser cache for future offline/fallback use
        saveToCache(generatedImage);
        return generatedImage;
      }
    }
    
    throw new Error("No image generated by Gemini.");
  } catch (error: any) {
    // Specific error handling for leaked/invalid keys to aid developer debugging
    if (error?.status === 403 || error?.message?.includes('leaked') || error?.message?.includes('API key')) {
        console.error("⚠️ GEMINI API KEY ERROR: Your API key has been revoked (leaked) or is invalid. Please generate a new key in Google AI Studio and update your .env file.");
    } else {
        console.warn("Gemini image generation failed (likely quota exceeded or network issue). Trying cache...", error);
    }
    
    // 1. Try Cache
    const cachedImage = await getRandomFromCache();
    if (cachedImage) {
        console.log("Successfully loaded image from Browser Cache.");
        return cachedImage;
    }

    // 2. Fallback to hardcoded list if cache is empty
    console.warn("Cache empty. Switching to fallback list.");
    const randomIndex = Math.floor(Math.random() * FALLBACK_BG_IMAGES.length);
    return FALLBACK_BG_IMAGES[randomIndex];
  }
};