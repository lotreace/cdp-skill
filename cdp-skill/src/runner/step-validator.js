/**
 * Step Validator
 * Validates step definitions before execution
 *
 * EXPORTS:
 * - validateSteps(steps) → {valid: boolean, errors: Array}
 * - validateStepInternal(step) → string[] - Internal per-step validation
 *
 * DEPENDENCIES:
 * - ./step-registry.js: getAllStepTypes, getStepConfig, validateHooks
 */

import { getAllStepTypes, getStepConfig, validateHooks, stepSupportsHooks } from './step-registry.js';

/**
 * Validate a single step definition
 * @param {Object} step - Step definition
 * @returns {string[]} Array of validation errors
 */
export function validateStepInternal(step) {
  const errors = [];

  if (!step || typeof step !== 'object') {
    errors.push('step must be an object');
    return errors;
  }

  const allStepTypes = getAllStepTypes();
  const definedActions = allStepTypes.filter(type => step[type] !== undefined);

  if (definedActions.length === 0) {
    errors.push(`unknown step type, expected one of: ${allStepTypes.join(', ')}`);
    return errors;
  }

  if (definedActions.length > 1) {
    errors.push(`ambiguous step: multiple actions defined (${definedActions.join(', ')})`);
    return errors;
  }

  const action = definedActions[0];
  const params = step[action];

  // Get step configuration from registry
  const stepConfig = getStepConfig(action);
  if (!stepConfig) {
    errors.push(`No configuration found for step type: ${action}`);
    return errors;
  }

  // Run step-specific validation from registry
  const stepErrors = stepConfig.validate(params);
  errors.push(...stepErrors);

  // Validate hooks on action steps (readyWhen, settledWhen, observe)
  if (stepSupportsHooks(action)) {
    const hookErrors = validateHooks(params);
    errors.push(...hookErrors);
  } else if (params && typeof params === 'object' && params !== null) {
    // Reject hook keys on steps that don't support them
    const hookKeys = ['readyWhen', 'settledWhen', 'observe'];
    for (const key of hookKeys) {
      if (params[key] !== undefined) {
        errors.push(`${action} does not support the '${key}' hook`);
      }
    }
  }

  return errors;
}

/**
 * Validate an array of step definitions
 * @param {Array<Object>} steps - Array of step definitions
 * @returns {{valid: boolean, errors: Array}}
 */
export function validateSteps(steps) {
  const invalidSteps = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const errors = validateStepInternal(step);
    if (errors.length > 0) {
      invalidSteps.push({ index: i, step, errors });
    }
  }

  if (invalidSteps.length > 0) {
    return {
      valid: false,
      errors: invalidSteps
    };
  }

  return { valid: true, errors: [] };
}
