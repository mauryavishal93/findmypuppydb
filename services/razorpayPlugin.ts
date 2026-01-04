import { registerPlugin } from '@capacitor/core';

/**
 * Razorpay Payment Options
 */
export interface RazorpayOptions {
  /** Razorpay Key ID */
  key: string;
  /** Amount in paise (e.g., 50000 for ₹500) */
  amount: number;
  /** Razorpay Order ID from backend */
  orderId: string;
  /** Business/App name */
  name?: string;
  /** Payment description */
  description?: string;
  /** Customer email */
  email?: string;
  /** Customer phone number */
  contact?: string;
  /** Currency code (default: INR) */
  currency?: string;
  /** Theme color in hex (default: #3399cc) */
  theme?: string;
}

/**
 * Razorpay Payment Success Response
 */
export interface RazorpaySuccessResponse {
  /** Razorpay Payment ID */
  paymentId: string;
  /** Payment status */
  status: 'success';
}

/**
 * Razorpay Payment Error Response
 */
export interface RazorpayErrorResponse {
  /** Error code */
  code: number;
  /** Error description */
  description: string;
  /** Payment status */
  status: 'error';
}

/**
 * Razorpay Plugin Interface
 */
export interface RazorpayPluginInterface {
  /**
   * Initialize Razorpay with API key
   * @param options - { key: string }
   */
  initialize(options: { key: string }): Promise<void>;

  /**
   * Open Razorpay Checkout
   * @param options - Payment options
   * @returns Promise with payment ID on success
   */
  open(options: RazorpayOptions): Promise<RazorpaySuccessResponse>;
}

// Register the native plugin
const RazorpayPlugin = registerPlugin<RazorpayPluginInterface>('Razorpay', {
  web: () => import('./razorpay-web').then(m => new m.RazorpayWeb()),
});

export default RazorpayPlugin;

