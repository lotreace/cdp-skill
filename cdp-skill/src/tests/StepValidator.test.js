import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateSteps, validateStepInternal } from '../runner/step-validator.js';

describe('StepValidator', () => {
  describe('validateStepInternal', () => {
    describe('basic validation', () => {
      it('should reject null step', () => {
        const errors = validateStepInternal(null);
        assert.ok(errors.some(e => e.includes('must be an object')));
      });

      it('should reject non-object step', () => {
        const errors = validateStepInternal('string');
        assert.ok(errors.some(e => e.includes('must be an object')));
      });

      it('should reject empty object', () => {
        const errors = validateStepInternal({});
        assert.ok(errors.some(e => e.includes('unknown step type')));
      });

      it('should reject unknown step type', () => {
        const errors = validateStepInternal({ unknownAction: true });
        assert.ok(errors.some(e => e.includes('unknown step type')));
      });

      it('should reject multiple actions in one step', () => {
        const errors = validateStepInternal({ click: '#btn', fill: { selector: '#input', value: 'test' } });
        assert.ok(errors.some(e => e.includes('ambiguous step')));
      });
    });

    describe('goto validation', () => {
      it('should accept valid goto', () => {
        const errors = validateStepInternal({ goto: 'https://example.com' });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty goto URL', () => {
        const errors = validateStepInternal({ goto: '' });
        assert.ok(errors.some(e => e.includes('non-empty')));
      });

      it('should reject non-string goto', () => {
        const errors = validateStepInternal({ goto: 123 });
        // Now accepts both string and object format, so check for url property error
        assert.ok(errors.some(e => e.includes('URL string') || e.includes('url property')));
      });

      it('should accept object goto with url', () => {
        const errors = validateStepInternal({ goto: { url: 'https://example.com' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject object goto without url', () => {
        const errors = validateStepInternal({ goto: { waitUntil: 'load' } });
        assert.ok(errors.some(e => e.includes('url property')));
      });
    });

    describe('wait validation', () => {
      it('should accept numeric wait (delay)', () => {
        const errors = validateStepInternal({ wait: 1000 });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject negative wait time', () => {
        const errors = validateStepInternal({ wait: -100 });
        assert.ok(errors.some(e => e.includes('non-negative')));
      });

      it('should accept string selector', () => {
        const errors = validateStepInternal({ wait: '#element' });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty string selector', () => {
        const errors = validateStepInternal({ wait: '' });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });

      it('should accept object with selector', () => {
        const errors = validateStepInternal({ wait: { selector: '#el' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with text', () => {
        const errors = validateStepInternal({ wait: { text: 'Loading...' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with textRegex', () => {
        const errors = validateStepInternal({ wait: { textRegex: 'Loading.*' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with time', () => {
        const errors = validateStepInternal({ wait: { time: 500 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with urlContains', () => {
        const errors = validateStepInternal({ wait: { urlContains: '/dashboard' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject object without required fields', () => {
        const errors = validateStepInternal({ wait: { timeout: 1000 } });
        assert.ok(errors.some(e => e.includes('requires selector, text, textRegex, time, or urlContains')));
      });

      it('should reject non-string selector in object', () => {
        const errors = validateStepInternal({ wait: { selector: 123 } });
        assert.ok(errors.some(e => e.includes('must be a string')));
      });

      it('should validate minCount as non-negative number', () => {
        const errors = validateStepInternal({ wait: { selector: '#el', minCount: -1 } });
        assert.ok(errors.some(e => e.includes('minCount')));
      });

      it('should validate caseSensitive as boolean', () => {
        const errors = validateStepInternal({ wait: { text: 'hello', caseSensitive: 'yes' } });
        assert.ok(errors.some(e => e.includes('caseSensitive must be a boolean')));
      });

      it('should validate hidden as boolean', () => {
        const errors = validateStepInternal({ wait: { selector: '#el', hidden: 'true' } });
        assert.ok(errors.some(e => e.includes('hidden must be a boolean')));
      });
    });

    describe('click validation', () => {
      it('should accept string selector', () => {
        const errors = validateStepInternal({ click: '#button' });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty string selector', () => {
        const errors = validateStepInternal({ click: '' });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });

      it('should accept object with selector', () => {
        const errors = validateStepInternal({ click: { selector: '#btn' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with ref', () => {
        const errors = validateStepInternal({ click: { ref: 's1e1' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with text', () => {
        const errors = validateStepInternal({ click: { text: 'Submit' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with coordinates', () => {
        const errors = validateStepInternal({ click: { x: 100, y: 200 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with selectors array', () => {
        const errors = validateStepInternal({ click: { selectors: ['#a', '#b'] } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject object without required fields', () => {
        const errors = validateStepInternal({ click: { force: true } });
        assert.ok(errors.some(e => e.includes('requires selector, ref, text, selectors array, or x/y')));
      });

      it('should reject empty text', () => {
        const errors = validateStepInternal({ click: { text: '' } });
        assert.ok(errors.some(e => e.includes('text cannot be empty')));
      });

      it('should reject empty selectors array', () => {
        const errors = validateStepInternal({ click: { selectors: [] } });
        assert.ok(errors.some(e => e.includes('selectors array cannot be empty')));
      });

      it('should reject negative coordinates', () => {
        const errors = validateStepInternal({ click: { x: -10, y: 100 } });
        assert.ok(errors.some(e => e.includes('non-negative')));
      });
    });

    describe('fill validation', () => {
      it('should accept object with selector and value', () => {
        const errors = validateStepInternal({ fill: { selector: '#input', value: 'test' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with ref and value', () => {
        const errors = validateStepInternal({ fill: { ref: 's1e1', value: 'test' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with label and value', () => {
        const errors = validateStepInternal({ fill: { label: 'Username', value: 'john' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject non-object fill', () => {
        const errors = validateStepInternal({ fill: 'value' });
        assert.ok(errors.some(e => e.includes('requires an object')));
      });

      it('should reject missing selector/ref/label', () => {
        const errors = validateStepInternal({ fill: { value: 'test' } });
        assert.ok(errors.some(e => e.includes('requires selector, ref, or label')));
      });

      it('should reject missing value', () => {
        const errors = validateStepInternal({ fill: { selector: '#input' } });
        assert.ok(errors.some(e => e.includes('requires value')));
      });

      it('should reject non-string selector', () => {
        const errors = validateStepInternal({ fill: { selector: 123, value: 'test' } });
        assert.ok(errors.some(e => e.includes('selector must be a string')));
      });
    });

    describe('fillForm validation', () => {
      it('should accept simple format', () => {
        const errors = validateStepInternal({ fillForm: { '#a': 'value1', '#b': 'value2' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept extended format', () => {
        const errors = validateStepInternal({
          fillForm: {
            fields: { '#a': 'value1' },
            react: true
          }
        });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject non-object fillForm', () => {
        const errors = validateStepInternal({ fillForm: 'invalid' });
        assert.ok(errors.some(e => e.includes('requires an object')));
      });

      it('should reject empty fields', () => {
        const errors = validateStepInternal({ fillForm: {} });
        assert.ok(errors.some(e => e.includes('requires at least one field')));
      });

      it('should validate react option as boolean', () => {
        const errors = validateStepInternal({
          fillForm: {
            fields: { '#a': 'val' },
            react: 'yes'
          }
        });
        assert.ok(errors.some(e => e.includes('react option must be a boolean')));
      });
    });

    describe('press validation', () => {
      it('should accept valid key', () => {
        const errors = validateStepInternal({ press: 'Enter' });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty key', () => {
        const errors = validateStepInternal({ press: '' });
        assert.ok(errors.some(e => e.includes('non-empty key string')));
      });

      it('should reject non-string key', () => {
        const errors = validateStepInternal({ press: 13 });
        assert.ok(errors.some(e => e.includes('non-empty key string')));
      });
    });

    describe('query validation', () => {
      it('should accept string selector', () => {
        const errors = validateStepInternal({ query: '#element' });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with selector', () => {
        const errors = validateStepInternal({ query: { selector: '#el' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with role', () => {
        const errors = validateStepInternal({ query: { role: 'button' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept array of roles', () => {
        const errors = validateStepInternal({ query: { role: ['button', 'link'] } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty selector', () => {
        const errors = validateStepInternal({ query: '' });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });

      it('should reject both nameExact and nameRegex', () => {
        const errors = validateStepInternal({ query: { role: 'button', nameExact: 'Submit', nameRegex: 'Sub.*' } });
        assert.ok(errors.some(e => e.includes('cannot have both')));
      });
    });

    describe('snapshot validation', () => {
      it('should accept true', () => {
        const errors = validateStepInternal({ snapshot: true });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with options', () => {
        const errors = validateStepInternal({ snapshot: { mode: 'ai' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject invalid mode', () => {
        const errors = validateStepInternal({ snapshot: { mode: 'invalid' } });
        assert.ok(errors.some(e => e.includes('mode must be "ai" or "full"')));
      });

      it('should reject string', () => {
        const errors = validateStepInternal({ snapshot: 'yes' });
        assert.ok(errors.some(e => e.includes('requires true or params object')));
      });
    });

    describe('viewport validation', () => {
      it('should accept device preset string', () => {
        const errors = validateStepInternal({ viewport: 'iPhone 12' });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept object with width and height', () => {
        const errors = validateStepInternal({ viewport: { width: 1920, height: 1080 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject empty preset name', () => {
        const errors = validateStepInternal({ viewport: '' });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });

      it('should reject missing width', () => {
        const errors = validateStepInternal({ viewport: { height: 1080 } });
        assert.ok(errors.some(e => e.includes('requires numeric width')));
      });

      it('should reject missing height', () => {
        const errors = validateStepInternal({ viewport: { width: 1920 } });
        assert.ok(errors.some(e => e.includes('requires numeric height')));
      });
    });

    describe('assert validation', () => {
      it('should accept url assertion', () => {
        const errors = validateStepInternal({ assert: { url: { contains: '/dashboard' } } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept text assertion', () => {
        const errors = validateStepInternal({ assert: { text: 'Welcome' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject missing url and text', () => {
        const errors = validateStepInternal({ assert: { selector: '#el' } });
        assert.ok(errors.some(e => e.includes('requires url or text')));
      });

      it('should reject non-object url', () => {
        const errors = validateStepInternal({ assert: { url: '/path' } });
        assert.ok(errors.some(e => e.includes('url must be an object')));
      });

      it('should require url matcher', () => {
        const errors = validateStepInternal({ assert: { url: {} } });
        assert.ok(errors.some(e => e.includes('requires contains, equals, startsWith')));
      });
    });

    describe('selectOption validation', () => {
      it('should accept value', () => {
        const errors = validateStepInternal({ selectOption: { selector: '#select', value: 'opt1' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept label', () => {
        const errors = validateStepInternal({ selectOption: { selector: '#select', label: 'Option 1' } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept index', () => {
        const errors = validateStepInternal({ selectOption: { selector: '#select', index: 0 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject missing selector', () => {
        const errors = validateStepInternal({ selectOption: { value: 'opt1' } });
        assert.ok(errors.some(e => e.includes('requires selector')));
      });

      it('should reject missing value/label/index', () => {
        const errors = validateStepInternal({ selectOption: { selector: '#select' } });
        assert.ok(errors.some(e => e.includes('requires value, label, index, or values')));
      });
    });

    describe('getBox validation', () => {
      it('should accept single ref string', () => {
        const errors = validateStepInternal({ getBox: 's1e1' });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept array of refs', () => {
        const errors = validateStepInternal({ getBox: ['s1e1', 's1e2', 's2e3'] });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject invalid ref format', () => {
        const errors = validateStepInternal({ getBox: 'invalid' });
        assert.ok(errors.some(e => e.includes('format "s{N}e{M}"')));
      });

      it('should reject empty array', () => {
        const errors = validateStepInternal({ getBox: [] });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });
    });

    describe('refAt validation', () => {
      it('should accept valid coordinates', () => {
        const errors = validateStepInternal({ refAt: { x: 100, y: 200 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject missing x', () => {
        const errors = validateStepInternal({ refAt: { y: 200 } });
        assert.ok(errors.some(e => e.includes('requires x coordinate')));
      });

      it('should reject missing y', () => {
        const errors = validateStepInternal({ refAt: { x: 100 } });
        assert.ok(errors.some(e => e.includes('requires y coordinate')));
      });
    });

    describe('elementsAt validation', () => {
      it('should accept array of coordinates', () => {
        const errors = validateStepInternal({ elementsAt: [{ x: 100, y: 200 }] });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject non-array', () => {
        const errors = validateStepInternal({ elementsAt: { x: 100, y: 200 } });
        assert.ok(errors.some(e => e.includes('requires an array')));
      });

      it('should reject empty array', () => {
        const errors = validateStepInternal({ elementsAt: [] });
        assert.ok(errors.some(e => e.includes('cannot be empty')));
      });

      it('should reject invalid coordinates in array', () => {
        const errors = validateStepInternal({ elementsAt: [{ x: 'abc', y: 200 }] });
        assert.ok(errors.some(e => e.includes('requires x and y as numbers')));
      });
    });

    describe('elementsNear validation', () => {
      it('should accept valid coordinates', () => {
        const errors = validateStepInternal({ elementsNear: { x: 100, y: 200 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should accept with radius', () => {
        const errors = validateStepInternal({ elementsNear: { x: 100, y: 200, radius: 50 } });
        assert.strictEqual(errors.length, 0);
      });

      it('should reject non-numeric radius', () => {
        const errors = validateStepInternal({ elementsNear: { x: 100, y: 200, radius: 'large' } });
        assert.ok(errors.some(e => e.includes('radius must be a number')));
      });
    });
  });

  describe('validateSteps', () => {
    it('should return valid for empty array', () => {
      const result = validateSteps([]);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should return valid for correct steps', () => {
      const result = validateSteps([
        { goto: 'https://example.com' },
        { click: '#button' },
        { fill: { selector: '#input', value: 'test' } }
      ]);
      assert.strictEqual(result.valid, true);
    });

    it('should return invalid with error details', () => {
      const result = validateSteps([
        { goto: 'https://example.com' },
        { click: '' },
        { fill: { selector: '#input' } }
      ]);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 2);
      assert.strictEqual(result.errors[0].index, 1);
      assert.strictEqual(result.errors[1].index, 2);
    });

    it('should include step in error details', () => {
      const result = validateSteps([{ unknownStep: true }]);
      assert.strictEqual(result.valid, false);
      assert.deepStrictEqual(result.errors[0].step, { unknownStep: true });
    });

    it('should include all validation errors for each step', () => {
      const result = validateSteps([
        { fill: {} }  // Missing both selector and value
      ]);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].errors.length >= 2);
    });
  });
});
