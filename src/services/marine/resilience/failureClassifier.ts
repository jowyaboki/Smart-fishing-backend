import {
  MarineProviderError,
  MarineProviderTimeoutError,
  MarineDataValidationError,
} from '../../../domain/marineModels';

export type FailureCategory =
  | 'network_error'
  | 'timeout'
  | 'rate_limit'
  | 'server_error'
  | 'client_error'
  | 'validation_error'
  | 'unknown';

export interface ClassifiedFailure {
  isAvailabilityFailure: boolean;
  category: FailureCategory;
  statusCode?: number;
  message: string;
}

/**
 * Classifies errors into availability failures (which count toward opening the circuit)
 * versus client/validation errors (which do not trip the circuit).
 */
export function classifyError(error: unknown): ClassifiedFailure {
  if (error instanceof MarineProviderTimeoutError) {
    return {
      isAvailabilityFailure: true,
      category: 'timeout',
      statusCode: 408,
      message: error.message,
    };
  }

  if (error instanceof MarineDataValidationError) {
    return {
      isAvailabilityFailure: false,
      category: 'validation_error',
      statusCode: 400,
      message: error.message,
    };
  }

  if (error instanceof MarineProviderError) {
    const status = error.statusCode;

    // HTTP 429 Rate Limit - upstream quota or throttling is an availability issue
    if (status === 429) {
      return {
        isAvailabilityFailure: true,
        category: 'rate_limit',
        statusCode: 429,
        message: error.message,
      };
    }

    // HTTP 5xx Server Errors (500, 502, 503, 504) - upstream outage
    if (status && status >= 500 && status < 600) {
      return {
        isAvailabilityFailure: true,
        category: 'server_error',
        statusCode: status,
        message: error.message,
      };
    }

    // HTTP 4xx Client Errors (except 408 / 429) - invalid query/parameters, not upstream outage
    if (status && status >= 400 && status < 500) {
      return {
        isAvailabilityFailure: false,
        category: 'client_error',
        statusCode: status,
        message: error.message,
      };
    }

    // Network / Socket error without HTTP status code
    return {
      isAvailabilityFailure: true,
      category: 'network_error',
      statusCode: undefined,
      message: error.message,
    };
  }

  const err = error as any;
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return {
      isAvailabilityFailure: true,
      category: 'timeout',
      statusCode: 408,
      message: err.message || 'Operation timed out',
    };
  }

  return {
    isAvailabilityFailure: true,
    category: 'unknown',
    statusCode: undefined,
    message: err?.message || String(error),
  };
}
