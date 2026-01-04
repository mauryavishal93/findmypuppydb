import { useState, useRef } from 'react';
import { PaymentStatus } from '../types/payment';
import { PriceOffer, API_BASE_URL } from '../services/db';
import { initializeRazorpayPayment } from '../services/razorpayService';

interface UsePaymentProps {
  onPaymentSuccess: (hints: number, paymentId: string, amount: number) => void;
  playSfx: (type: 'pay') => void;
  priceOffer: PriceOffer | null;
  playerName: string;
  playerEmail: string;
}

export const usePayment = ({ 
  onPaymentSuccess, 
  playSfx, 
  priceOffer,
  playerName,
  playerEmail
}: UsePaymentProps) => {
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('idle');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentModalConfig, setPaymentModalConfig] = useState<{title?: string, description?: string}>({});

  const handlePayment = async () => {
    setPaymentStatus('processing');

    const offerPrice = priceOffer?.offerPrice || 9.0;
    const hintPack = priceOffer?.hintPack || '100 Hints Pack';
    const hintCount = priceOffer?.hintCount || 100;

    try {
      await initializeRazorpayPayment({
        amount: offerPrice,
        playerName,
        playerEmail,
        packName: hintPack,
        hintsCount: hintCount,
        onSuccess: async (response) => {
         setPaymentStatus('verifying');
         
          try {
            const verifyResponse = await fetch(`${API_BASE_URL}/api/razorpay/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...response,
                username: playerName,
                pack: hintPack,
                hintsToAdd: hintCount,
                amount: offerPrice
              })
            });

            const verifyData = await verifyResponse.json();
            if (verifyData.success) {
             playSfx('pay');
              onPaymentSuccess(hintCount, response.razorpay_payment_id, offerPrice);
             setPaymentStatus('idle');
             setShowPaymentModal(false);
            }
          } catch (error) {
            console.error('Verification Error:', error);
            setPaymentStatus('idle');
    }
        },
        onError: (error) => {
          // Silently return to idle state without browser alerts
          setPaymentStatus('idle');
          console.log('Payment process ended:', error.type || 'unknown');
        }
      });
    } catch (error) {
      console.error('Razorpay Initialization Error:', error);
      setPaymentStatus('idle');
    }
  };

  const handleCancelPayment = () => {
    setPaymentStatus('idle');
  };

  const openPaymentModal = (config?: {title?: string, description?: string}) => {
    setPaymentModalConfig(config || {});
    setPaymentStatus('idle');
    setShowPaymentModal(true);
  };

  const closePaymentModal = () => {
    setShowPaymentModal(false);
    setPaymentStatus('idle');
  };

  return {
    paymentStatus,
    showPaymentModal,
    paymentModalConfig,
    handlePayment,
    handleCancelPayment,
    openPaymentModal,
    closePaymentModal
  };
};

