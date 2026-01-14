// ------------------------------------------------------------------
// AUTH SERVICE - Client Side
// ------------------------------------------------------------------

// API Base URL Configuration:
// - For production: Use the production server URL
// - For local development: Use empty string to leverage Vite proxy (recommended)
//   OR use "http://localhost:5774" for direct backend connection
// - For Android Emulator: "http://10.0.2.2:5774"
// - For Physical Device: your computer's local IP (e.g., "http://192.168.1.100:5774")

// Use production server for DB writes, or empty string to use Vite proxy in development
export const API_BASE_URL = "https://findmypuppydb.onrender.com";

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
  },

  forgotPassword: async (email: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to send password reset email" };
      }
      return data;
    } catch (error) {
      console.error("DB Forgot Password Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to reset password" };
      }
      return data;
    } catch (error) {
      console.error("DB Reset Password Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  getDailyCheckInStatus: async (username: string): Promise<{
    success: boolean;
    message?: string;
    lastCheckInDate?: string | null;
    checkInStreak?: number;
    totalCheckIns?: number;
    hasCheckedInToday?: boolean;
    puppyAge?: number;
    puppySize?: number;
  }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/daily-checkin/status/${username}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to get daily check-in status" };
      }
      return data;
    } catch (error) {
      console.error("DB Get Daily Check-In Status Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  completeDailyCheckIn: async (
    username: string
  ): Promise<{
    success: boolean;
    message?: string;
    hintsEarned?: number;
    pointsEarned?: number;
    totalHints?: number;
    totalPoints?: number;
    puppyAge?: number;
    puppySize?: number;
    checkInStreak?: number;
    milestone?: '7days' | '30days' | '1year' | null;
  }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/daily-checkin/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to complete daily check-in" };
      }
      return data;
    } catch (error) {
      console.error("DB Complete Daily Check-In Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },

  getLeaderboard: async (currentUsername?: string): Promise<{
    success: boolean;
    message?: string;
    leaderboard?: Array<{ username: string; rank: number; points: number }>;
    currentUser?: { username: string; rank: number; points: number } | null;
  }> => {
    try {
      // Add username as query parameter if provided
      const url = currentUsername 
        ? `${API_BASE_URL}/api/leaderboard?username=${encodeURIComponent(currentUsername)}`
        : `${API_BASE_URL}/api/leaderboard`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, message: data.message || "Failed to fetch leaderboard" };
      }
      return data;
    } catch (error) {
      console.error("DB Get Leaderboard Error:", error);
      return { success: false, message: "Connection error. Check your internet." };
    }
  },
};