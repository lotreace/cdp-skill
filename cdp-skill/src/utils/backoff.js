/**
 * Backoff and Sleep Utilities
 * Exponential backoff with jitter for retry operations
 */

/**
 * Promise-based delay
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a backoff sleeper with exponential delay and jitter
 * Prevents thundering herd by randomizing retry delays
 * @param {Object} [options] - Configuration options
 * @param {number} [options.initialDelay=100] - Initial delay in ms
 * @param {number} [options.maxDelay=5000] - Maximum delay in ms
 * @param {number} [options.multiplier=2] - Base multiplier for exponential growth
 * @param {number} [options.jitterMin=0.9] - Minimum jitter factor (e.g., 0.9 = 90%)
 * @param {number} [options.jitterMax=1.1] - Maximum jitter factor (e.g., 1.1 = 110%)
 * @returns {Object} Backoff sleeper interface
 */
export function createBackoffSleeper(options = {}) {
  const {
    initialDelay = 100,
    maxDelay = 5000,
    multiplier = 2,
    jitterMin = 0.9,
    jitterMax = 1.1
  } = options;

  let attempt = 0;
  let currentDelay = initialDelay;

  /**
   * Apply jitter to a delay value
   * @param {number} delay - Base delay
   * @returns {number} Delay with jitter applied
   */
  function applyJitter(delay) {
    const jitterRange = jitterMax - jitterMin;
    const jitterFactor = jitterMin + Math.random() * jitterRange;
    return Math.floor(delay * jitterFactor);
  }

  /**
   * Sleep with exponential backoff and jitter
   * Each call increases the delay exponentially (with random factor)
   * @returns {Promise<number>} The delay that was used
   */
  async function sleepFn() {
    const delayWithJitter = applyJitter(currentDelay);
    await new Promise(resolve => setTimeout(resolve, delayWithJitter));

    // Increase delay for next attempt (with random multiplier 1.9-2.1)
    const randomMultiplier = multiplier * (0.95 + Math.random() * 0.1);
    currentDelay = Math.min(currentDelay * randomMultiplier, maxDelay);
    attempt++;

    return delayWithJitter;
  }

  /**
   * Reset the backoff state
   */
  function reset() {
    attempt = 0;
    currentDelay = initialDelay;
  }

  /**
   * Get current attempt count
   * @returns {number}
   */
  function getAttempt() {
    return attempt;
  }

  /**
   * Get next delay without sleeping (preview)
   * @returns {number}
   */
  function peekDelay() {
    return applyJitter(currentDelay);
  }

  return {
    sleep: sleepFn,
    reset,
    getAttempt,
    peekDelay
  };
}

/**
 * Sleep with backoff - simple one-shot function
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} [options] - Options
 * @param {number} [options.initialDelay=100] - Initial delay
 * @param {number} [options.maxDelay=5000] - Max delay
 * @returns {Promise<number>} The delay used
 */
export async function sleepWithBackoff(attempt, options = {}) {
  const { initialDelay = 100, maxDelay = 5000 } = options;

  // Calculate delay: initialDelay * 2^attempt with jitter
  const baseDelay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

  // Apply jitter (0.9-1.1x)
  const jitter = 0.9 + Math.random() * 0.2;
  const delay = Math.floor(baseDelay * jitter);

  await sleep(delay);
  return delay;
}
