/**
 * Test Step Execution
 * Validates and executes YAML/JSON test step sequences
 *
 * EXPORTS:
 * - validateSteps(steps) → {valid: boolean, errors: Array}
 * - executeStep(deps, step, options?) → Promise<StepResult>
 * - runSteps(deps, steps, options?) → Promise<RunResult>
 * - createTestRunner(deps) → TestRunner
 *
 * SUBMODULES:
 * - ./context-helpers.js: buildActionContext, buildCommandContext, captureFailureContext, STEP_TYPES, VISUAL_ACTIONS
 * - ./step-validator.js: validateSteps, validateStepInternal
 * - ./step-executors.js: executeStep, runSteps
 */

// Re-export from submodules for direct access
export {
  STEP_TYPES,
  VISUAL_ACTIONS,
  buildActionContext,
  buildCommandContext,
  captureFailureContext
} from './context-helpers.js';

export {
  validateSteps,
  validateStepInternal
} from './step-validator.js';

export {
  executeStep,
  runSteps
} from './step-executors.js';

// Import for use in createTestRunner
import { validateSteps } from './step-validator.js';
import { executeStep, runSteps } from './step-executors.js';

/**
 * Create a test runner with bound dependencies
 * @param {Object} deps - Dependencies
 * @returns {Object} Test runner interface
 */
export function createTestRunner(deps) {
  return {
    validateSteps,
    executeStep: (step, options) => executeStep(deps, step, options),
    run: (steps, options) => runSteps(deps, steps, options)
  };
}
