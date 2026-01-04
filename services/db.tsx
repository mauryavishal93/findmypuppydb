
// ------------------------------------------------------------------
// AUTH SERVICE - Client Side
// ------------------------------------------------------------------

// API Base URL Configuration:
// Production backend server - all API calls will be made to this server
// For local development/testing, you can temporarily change this to:
// - Android Emulator: "http://10.0.2.2:5174" (10.0.2.2 is the Android emulator's alias for host machine's localhost)
// - Physical Device: your computer's local IP address (e.g., "http://192.168.1.100:5174")
//const API_BASE_URL = "https://findmypuppydb.onrender.com";
const API_BASE_URL = "http://localhost:5174";

export interface User {
  username: string;
  email: string;
  hints?: number;
  points?: number;
  premium?: boolean;
  levelPassedEasy?: number;
  levelPassedMedium?: number;
  levelPassedHard?: number;
  referredBy?: string | null;
}

export interface PurchaseHistory {
  purchaseId: string;
  purchaseDate: Date | string;
  amount: number;
  purchaseType: 'Premium' | 'Hints';
  pack: string;
  purchaseMode?: 'Money' | 'Points'; // Money (₹) or Points (Pts)
}

export interface AuthResponse {
  success: boolean;
  message?: string;
  user?: User;
}

export interface PriceOffer {
  hintPack: string;
  marketPrice: number;
  offerPrice: number;
  hintCount: number;
}

export const db = {
  login: async (username: string, password: string): Promise<AuthResponse> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Login failed" };
      }
      return data;
    } catch (error) {
      console.error("DB Login Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  signup: async (username: string, email: string, password: string, referralCode?: string): Promise<AuthResponse> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password, referralCode }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Signup failed" };
      }
      return data;
    } catch (error) {
      console.error("DB Signup Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  updateHints: async (username: string, hints: number): Promise<{ success: boolean; message?: string; hints?: number }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/update-hints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, hints }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to update hints" };
      }
      return data;
    } catch (error) {
      console.error("DB Update Hints Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  updatePoints: async (username: string, points: number): Promise<{ success: boolean; message?: string; points?: number }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/update-points`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, points }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to update points" };
      }
      return data;
    } catch (error) {
      console.error("DB Update Points Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  updatePremium: async (username: string, premium: boolean): Promise<{ success: boolean; message?: string; premium?: boolean }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/update-premium`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, premium }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to update premium status" };
      }
      return data;
    } catch (error) {
      console.error("DB Update Premium Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  updateLevelPassed: async (username: string, difficulty: string, levelPassed: number): Promise<{ success: boolean; message?: string; levelPassedEasy?: number; levelPassedMedium?: number; levelPassedHard?: number }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/update-level-passed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, difficulty, levelPassed }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to update level passed count" };
      }
      return data;
    } catch (error) {
      console.error("DB Update Level Passed Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  createPurchaseHistory: async (
    username: string,
    amount: number,
    purchaseType: 'Premium' | 'Hints',
    pack: string,
    purchaseMode: 'Money' | 'Points' = 'Money'
  ): Promise<{ success: boolean; message?: string; purchase?: PurchaseHistory }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/purchase-history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, amount, purchaseType, pack, purchaseMode }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to create purchase history" };
      }
      return data;
    } catch (error) {
      console.error("DB Create Purchase History Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  getPurchaseHistory: async (username: string): Promise<{ success: boolean; message?: string; purchases?: PurchaseHistory[] }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/purchase-history/${username}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to fetch purchase history" };
      }
      return data;
    } catch (error) {
      console.error("DB Get Purchase History Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  getUser: async (username: string): Promise<{ success: boolean; message?: string; user?: User }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/${username}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to fetch user data" };
      }
      return data;
    } catch (error) {
      console.error("DB Get User Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  getPriceOffer: async (): Promise<{ success: boolean; message?: string; offer?: PriceOffer }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/price-offer`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to fetch price offer" };
      }
      return data;
    } catch (error) {
      console.error("DB Get Price Offer Error:", error);
      return { success: false, message: "Connection error." };
    }
  },

  signInWithGoogle: async (idToken: string, referralCode?: string): Promise<AuthResponse> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google/signin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ idToken, referralCode }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Google sign in failed" };
      }
      return data;
    } catch (error) {
      console.error("DB Google Sign In Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  }
};
