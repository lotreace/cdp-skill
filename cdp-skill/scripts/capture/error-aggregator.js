/**
 * Error Aggregator Module
 * Combines console and network errors into unified reports
 *
 * PUBLIC EXPORTS:
 * - createErrorAggregator(consoleCapture, networkCapture) - Factory for aggregator
 * - aggregateErrors(consoleCapture, networkCapture) - Convenience function
 *
 * @module cdp-skill/capture/error-aggregator
 */

/**
 * Create an error aggregator that combines console and network errors
 * @param {Object} consoleCapture - Console capture instance
 * @param {Object} networkCapture - Network capture instance
 * @returns {Object} Error aggregator interface
 */
export function createErrorAggregator(consoleCapture, networkCapture) {
  if (!consoleCapture) throw new Error('consoleCapture is required');
  if (!networkCapture) throw new Error('networkCapture is required');

  /**
   * Get summary of all errors
   * @returns {{hasErrors: boolean, hasWarnings: boolean, counts: Object, errors: Object}}
   */
  function getSummary() {
    const consoleErrors = consoleCapture.getErrors();
    const consoleWarnings = consoleCapture.getWarnings();
    const networkFailures = networkCapture.getNetworkFailures();
    const httpErrs = networkCapture.getHttpErrors();

    return {
      hasErrors: consoleErrors.length > 0 || networkFailures.length > 0 ||
                 httpErrs.some(e => e.status >= 500),
      hasWarnings: consoleWarnings.length > 0 ||
                   httpErrs.some(e => e.status >= 400 && e.status < 500),
      counts: {
        consoleErrors: consoleErrors.length,
        consoleWarnings: consoleWarnings.length,
        networkFailures: networkFailures.length,
        httpClientErrors: httpErrs.filter(e => e.status >= 400 && e.status < 500).length,
        httpServerErrors: httpErrs.filter(e => e.status >= 500).length
      },
      errors: {
        console: consoleErrors,
        network: networkFailures,
        http: httpErrs
      }
    };
  }

  /**
   * Get all errors sorted by timestamp
   * @returns {Array} Combined errors with source annotation
   */
  function getAllErrorsChronological() {
    const all = [
      ...consoleCapture.getErrors().map(e => ({ ...e, source: 'console' })),
      ...networkCapture.getAllErrors().map(e => ({ ...e, source: 'network' }))
    ];

    return all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  /**
   * Get critical errors only (exceptions, network failures, 5xx)
   * @returns {Array}
   */
  function getCriticalErrors() {
    return [
      ...consoleCapture.getErrors().filter(e => e.type === 'exception'),
      ...networkCapture.getNetworkFailures(),
      ...networkCapture.getHttpErrors().filter(e => e.status >= 500)
    ];
  }

  /**
   * Generate formatted error report
   * @returns {string} Formatted report text
   */
  function formatReport() {
    const summary = getSummary();
    const lines = ['=== Error Report ==='];

    if (summary.counts.consoleErrors > 0) {
      lines.push('\n## Console Errors');
      for (const error of summary.errors.console) {
        lines.push(`  [${error.level.toUpperCase()}] ${error.text}`);
        if (error.url) {
          lines.push(`    at ${error.url}:${error.line || '?'}`);
        }
      }
    }

    if (summary.counts.networkFailures > 0) {
      lines.push('\n## Network Failures');
      for (const error of summary.errors.network) {
        lines.push(`  [FAILED] ${error.method} ${error.url}`);
        lines.push(`    Error: ${error.errorText}`);
      }
    }

    if (summary.counts.httpServerErrors > 0 || summary.counts.httpClientErrors > 0) {
      lines.push('\n## HTTP Errors');
      for (const error of summary.errors.http) {
        lines.push(`  [${error.status}] ${error.method} ${error.url}`);
      }
    }

    if (!summary.hasErrors && !summary.hasWarnings) {
      lines.push('\nNo errors or warnings captured.');
    }

    return lines.join('\n');
  }

  /**
   * Get JSON representation
   * @returns {Object} JSON-serializable report
   */
  function toJSON() {
    return {
      timestamp: new Date().toISOString(),
      summary: getSummary(),
      all: getAllErrorsChronological()
    };
  }

  return {
    getSummary,
    getAllErrorsChronological,
    getCriticalErrors,
    formatReport,
    toJSON
  };
}

/**
 * Aggregate errors from console and network captures
 * @param {Object} consoleCapture - Console capture instance
 * @param {Object} networkCapture - Network capture instance
 * @returns {{summary: Object, critical: Array, report: string}}
 */
export function aggregateErrors(consoleCapture, networkCapture) {
  const aggregator = createErrorAggregator(consoleCapture, networkCapture);
  return {
    summary: aggregator.getSummary(),
    critical: aggregator.getCriticalErrors(),
    report: aggregator.formatReport()
  };
}
