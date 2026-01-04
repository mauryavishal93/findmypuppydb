import { WebPlugin } from '@capacitor/core';
import type { RazorpayPluginInterface, RazorpayOptions, RazorpaySuccessResponse } from './razorpayPlugin';

/**
 * Web implementation of Razorpay Plugin
 * Uses Razorpay Checkout.js for browser environment
 */
export class RazorpayWeb extends WebPlugin implements RazorpayPluginInterface {
  
  async initialize(options: { key: string }): Promise<void> {
    // Web doesn't need initialization
    // Script is already loaded in index.html
    console.log('Razorpay Web initialized with key:', options.key);
    return Promise.resolve();
  }

  async open(options: RazorpayOptions): Promise<RazorpaySuccessResponse> {
    return new Promise((resolve, reject) => {
      // Check if Razorpay is loaded
      if (typeof (window as any).Razorpay === 'undefined') {
        reject({
          code: -1,
          description: 'Razorpay SDK not loaded',
          status: 'error'
        });
        return;
      }

      const rzpOptions = {
        key: options.key,
        amount: options.amount,
        currency: options.currency || 'INR',
        name: options.name || 'Find My Puppy',
        description: options.description || 'Buy Hints',
        order_id: options.orderId,
        prefill: {
          email: options.email || '',
          contact: options.contact || ''
        },
        theme: {
          color: options.theme || '#3399cc'
        },
        handler: (response: any) => {
          resolve({
            paymentId: response.razorpay_payment_id,
            status: 'success'
          });
        },
        modal: {
          ondismiss: () => {
            reject({
              code: 0,
              description: 'Payment cancelled by user',
              status: 'error'
            });
          }
        }
      };

      const rzp = new (window as any).Razorpay(rzpOptions);
      
      rzp.on('payment.failed', (response: any) => {
        reject({
          code: response.error.code,
          description: response.error.description,
          status: 'error'
        });
      });

      rzp.open();
    });
  }
}

