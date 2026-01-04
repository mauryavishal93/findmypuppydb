import { Capacitor } from '@capacitor/core';
import RazorpayPlugin from './razorpayPlugin';

export interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export const loadRazorpay = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if ((window as any).Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export const initializeRazorpayPayment = async (options: {
  amount: number;
  playerName: string;
  playerEmail: string;
  packName: string;
  hintsCount: number;
  onSuccess: (response: RazorpayResponse) => void;
  onError: (error: any) => void;
}) => {
  try {
    const isNative = Capacitor.isNativePlatform();
    const razorpayKey = 'rzp_test_RyzZQD56IABhEH'; // Your public key

    // 1. Create order on the backend
    const orderResponse = await fetch('/api/razorpay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: options.amount,
        receipt: `receipt_${Date.now()}`
      })
    });

    const orderData = await orderResponse.json();
    if (!orderData.success) {
      throw new Error(orderData.message || 'Failed to create order');
    }

    // 2. Use Native SDK for Android/iOS, Web SDK for browsers
    if (isNative) {
      console.log('🚀 Using Razorpay Native SDK (Android/iOS)');
      console.log('📦 Order created:', {
        orderId: orderData.order.id,
        amount: orderData.order.amount,
        currency: orderData.order.currency
      });
      
      // Verify plugin is available
      if (!RazorpayPlugin || typeof RazorpayPlugin.open !== 'function') {
        console.error('❌ RazorpayPlugin is not available or open method is missing');
        options.onError({
          type: 'failed',
          description: 'Razorpay plugin not available',
          code: -1
        });
        return;
      }
      
      try {
        // Open native Razorpay checkout
        console.log('🔓 Opening Razorpay checkout...');
        const result = await RazorpayPlugin.open({
          key: razorpayKey,
          amount: orderData.order.amount,
          orderId: orderData.order.id,
          name: 'Find My Puppy',
          description: `Purchase ${options.packName}`,
          email: options.playerEmail,
          contact: '',
          currency: orderData.order.currency,
          theme: '#FF69B4'
        });

        console.log('✅ Razorpay payment result:', result);

        // Native SDK returns only paymentId on success
        // We need to construct the full response for backend verification
        const razorpayResponse: RazorpayResponse = {
          razorpay_order_id: orderData.order.id,
          razorpay_payment_id: result.paymentId,
          razorpay_signature: '' // Signature verification will be done on backend
        };

        console.log('✅ Payment successful, calling onSuccess');
        options.onSuccess(razorpayResponse);

      } catch (nativeError: any) {
        console.error('❌ Native Razorpay error:', nativeError);
        console.error('Error details:', {
          message: nativeError.message,
          code: nativeError.code,
          description: nativeError.description,
          error: nativeError
        });
        
        // Handle cancellation (code 2 or CANCELLED)
        const isCancelled = nativeError.code === 2 || 
                           nativeError.code === 0 || 
                           nativeError.message?.includes('cancelled') ||
                           nativeError.message === 'CANCELLED';
        
        options.onError({
          type: isCancelled ? 'cancelled' : 'failed',
          description: nativeError.description || nativeError.message || 'Payment failed',
          code: nativeError.code
        });
      }

    } else {
      console.log('🌐 Using Razorpay Web SDK (Browser)');

      // Load web SDK
      const isLoaded = await loadRazorpay();
      if (!isLoaded) {
        options.onError(new Error('Razorpay SDK failed to load.'));
        return;
      }

      // Flag to track if payment was already handled
      let isHandled = false;

      // Open web checkout
      const razorpayOptions = {
        key: razorpayKey,
        amount: orderData.order.amount,
        currency: orderData.order.currency,
        name: 'Find My Puppy',
        description: `Purchase ${options.packName}`,
        image: 'https://raw.githubusercontent.com/mauryavishal93/FindMyPuppy/main/apk/release/icon.png',
        order_id: orderData.order.id,
        handler: function (response: RazorpayResponse) {
          isHandled = true;
          options.onSuccess(response);
        },
        prefill: {
          name: options.playerName,
          email: options.playerEmail
        },
        theme: {
          color: '#FF69B4'
        },
        modal: {
          ondismiss: function() {
            if (!isHandled) {
              isHandled = true;
              options.onError({
                type: 'cancelled',
                description: 'Payment cancelled'
              });
            }
          }
        }
      };

      const rzp = new (window as any).Razorpay(razorpayOptions);
      
      // Handle payment failure
      rzp.on('payment.failed', function (response: any) {
        isHandled = true;
        options.onError({
          type: 'failed',
          description: response.error.description,
          code: response.error.code
        });
      });

      rzp.open();
    }

  } catch (error) {
    console.error('Razorpay initialization error:', error);
    options.onError(error);
  }
};

