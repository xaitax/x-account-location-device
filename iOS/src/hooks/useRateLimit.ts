/**
 * X-Posed Mobile App - Rate Limit Hook
 * Tracks API rate limit status globally
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { XGraphQLAPI } from '../services/XGraphQLAPI';

interface RateLimitStatus {
  isRateLimited: boolean;
  resetTime: number | null;
  remainingMs: number | null;
}

interface UseRateLimitReturn {
  isRateLimited: boolean;
  resetTime: number | null;
  remainingMs: number | null;
  dismissed: boolean;
  dismiss: () => void;
  checkStatus: () => RateLimitStatus;
}

/**
 * Hook to track rate limit status globally
 * Polls the XGraphQLAPI rate limit status and updates state
 */
export function useRateLimit(): UseRateLimitReturn {
  const [status, setStatus] = useState<RateLimitStatus>({
    isRateLimited: false,
    resetTime: null,
    remainingMs: null,
  });
  const [dismissed, setDismissed] = useState(false);
  const lastResetTimeRef = useRef<number | null>(null);

  /**
   * Check rate limit status from XGraphQLAPI
   */
  const checkStatus = useCallback((): RateLimitStatus => {
    const apiStatus = XGraphQLAPI.getRateLimitStatus();
    return apiStatus;
  }, []);

  /**
   * Update status by polling XGraphQLAPI
   */
  const updateStatus = useCallback(() => {
    const newStatus = checkStatus();
    
    // If reset time changed (new rate limit), un-dismiss
    if (newStatus.resetTime && newStatus.resetTime !== lastResetTimeRef.current) {
      lastResetTimeRef.current = newStatus.resetTime;
      setDismissed(false);
    }
    
    // If no longer rate limited, reset dismissed state
    if (!newStatus.isRateLimited) {
      lastResetTimeRef.current = null;
      setDismissed(false);
    }
    
    setStatus(newStatus);
  }, [checkStatus]);

  /**
   * Dismiss the rate limit banner
   */
  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Poll for rate limit status changes
  useEffect(() => {
    // Initial check
    updateStatus();
    
    // Poll every 2 seconds when rate limited, every 10 seconds otherwise
    const interval = setInterval(() => {
      updateStatus();
    }, status.isRateLimited ? 2000 : 10000);
    
    return () => clearInterval(interval);
  }, [updateStatus, status.isRateLimited]);

  return {
    isRateLimited: status.isRateLimited && !dismissed,
    resetTime: status.resetTime,
    remainingMs: status.remainingMs,
    dismissed,
    dismiss,
    checkStatus,
  };
}

export default useRateLimit;