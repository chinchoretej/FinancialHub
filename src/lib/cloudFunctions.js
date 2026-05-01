/**
 * Typed wrappers around the FinancialHub Cloud Functions callables.
 * Throws Error subclasses with `.code` and `.details` populated from the
 * server's HttpsError payload so UI code can switch on them.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

export class CloudFunctionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'CloudFunctionError';
    this.code = code;
    this.details = details;
  }
}

function unwrap(callable) {
  return async (payload) => {
    try {
      const result = await callable(payload);
      return result.data;
    } catch (e) {
      // Firebase callable wraps server HttpsError into a FirebaseError
      // whose .code is "functions/already-exists" etc. Strip the prefix.
      const code = (e?.code || '').replace(/^functions\//, '') || 'unknown';
      throw new CloudFunctionError(code, e?.message || 'Cloud function failed', e?.details);
    }
  };
}

export const calculateLoanDetails    = unwrap(httpsCallable(functions, 'calculateLoanDetails'));
export const getLoanSummary          = unwrap(httpsCallable(functions, 'getLoanSummary'));
export const recomputeLoanAggregates = unwrap(httpsCallable(functions, 'recomputeLoanAggregates'));

export const addDisbursement   = unwrap(httpsCallable(functions, 'addDisbursement'));
export const addBuilderStage   = unwrap(httpsCallable(functions, 'addBuilderStage'));
export const addBuilderPayment = unwrap(httpsCallable(functions, 'addBuilderPayment'));
