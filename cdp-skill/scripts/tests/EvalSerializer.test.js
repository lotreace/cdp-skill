import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createEvalSerializer,
  getEvalSerializationFunction,
  processEvalResult
} from '../capture/eval-serializer.js';

describe('EvalSerializer', () => {
  describe('createEvalSerializer', () => {
    it('should return an object with expected methods', () => {
      const serializer = createEvalSerializer();
      assert.ok(typeof serializer.getSerializationFunction === 'function');
      assert.ok(typeof serializer.processResult === 'function');
    });
  });

  describe('getSerializationFunction', () => {
    it('should return a function declaration string', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(typeof fnStr === 'string');
      assert.ok(fnStr.startsWith('function(value)'));
    });

    it('should include handling for null', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes("value === null"));
      assert.ok(fnStr.includes("type: 'null'"));
    });

    it('should include handling for undefined', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes("value === undefined"));
      assert.ok(fnStr.includes("type: 'undefined'"));
    });

    it('should include handling for special numbers', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('Number.isNaN'));
      assert.ok(fnStr.includes('Infinity'));
      assert.ok(fnStr.includes('-Infinity'));
    });

    it('should include handling for Date', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof Date'));
      assert.ok(fnStr.includes('toISOString'));
    });

    it('should include handling for Map', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof Map'));
    });

    it('should include handling for Set', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof Set'));
    });

    it('should include handling for RegExp', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof RegExp'));
    });

    it('should include handling for Error', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof Error'));
    });

    it('should include handling for Element', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('instanceof Element'));
    });

    it('should include handling for arrays', () => {
      const fnStr = getEvalSerializationFunction();
      assert.ok(fnStr.includes('Array.isArray'));
    });
  });

  describe('processResult', () => {
    it('should handle null type', () => {
      const result = processEvalResult({ type: 'null', value: null });
      assert.strictEqual(result.type, 'null');
      assert.strictEqual(result.value, null);
    });

    it('should handle undefined type', () => {
      const result = processEvalResult({ type: 'undefined', value: null });
      assert.strictEqual(result.type, 'undefined');
    });

    it('should handle number type', () => {
      const result = processEvalResult({ type: 'number', value: 42 });
      assert.strictEqual(result.type, 'number');
      assert.strictEqual(result.value, 42);
    });

    it('should handle NaN', () => {
      const result = processEvalResult({ type: 'number', value: null, repr: 'NaN' });
      assert.strictEqual(result.type, 'number');
      assert.strictEqual(result.repr, 'NaN');
    });

    it('should handle Infinity', () => {
      const result = processEvalResult({ type: 'number', value: null, repr: 'Infinity' });
      assert.strictEqual(result.type, 'number');
      assert.strictEqual(result.repr, 'Infinity');
    });

    it('should handle -Infinity', () => {
      const result = processEvalResult({ type: 'number', value: null, repr: '-Infinity' });
      assert.strictEqual(result.type, 'number');
      assert.strictEqual(result.repr, '-Infinity');
    });

    it('should handle string type', () => {
      const result = processEvalResult({ type: 'string', value: 'hello' });
      assert.strictEqual(result.type, 'string');
      assert.strictEqual(result.value, 'hello');
    });

    it('should handle boolean type', () => {
      const result = processEvalResult({ type: 'boolean', value: true });
      assert.strictEqual(result.type, 'boolean');
      assert.strictEqual(result.value, true);
    });

    it('should handle bigint type', () => {
      const result = processEvalResult({ type: 'bigint', value: null, repr: '12345n' });
      assert.strictEqual(result.type, 'bigint');
      assert.strictEqual(result.repr, '12345n');
    });

    it('should handle symbol type', () => {
      const result = processEvalResult({ type: 'symbol', value: null, repr: 'Symbol(test)' });
      assert.strictEqual(result.type, 'symbol');
      assert.strictEqual(result.repr, 'Symbol(test)');
    });

    it('should handle function type', () => {
      const result = processEvalResult({ type: 'function', value: null, repr: 'function foo() {}' });
      assert.strictEqual(result.type, 'function');
      assert.strictEqual(result.repr, 'function foo() {}');
    });

    it('should handle Date type', () => {
      const result = processEvalResult({
        type: 'Date',
        value: '2024-01-15T10:30:00.000Z',
        timestamp: 1705315800000
      });
      assert.strictEqual(result.type, 'Date');
      assert.strictEqual(result.value, '2024-01-15T10:30:00.000Z');
      assert.strictEqual(result.timestamp, 1705315800000);
    });

    it('should handle Map type', () => {
      const result = processEvalResult({
        type: 'Map',
        size: 2,
        entries: [['key1', 'value1'], ['key2', 'value2']]
      });
      assert.strictEqual(result.type, 'Map');
      assert.strictEqual(result.size, 2);
      assert.deepStrictEqual(result.entries, [['key1', 'value1'], ['key2', 'value2']]);
    });

    it('should handle Set type', () => {
      const result = processEvalResult({
        type: 'Set',
        size: 3,
        values: [1, 2, 3]
      });
      assert.strictEqual(result.type, 'Set');
      assert.strictEqual(result.size, 3);
      assert.deepStrictEqual(result.values, [1, 2, 3]);
    });

    it('should handle RegExp type', () => {
      const result = processEvalResult({ type: 'RegExp', value: '/\\d+/g' });
      assert.strictEqual(result.type, 'RegExp');
      assert.strictEqual(result.value, '/\\d+/g');
    });

    it('should handle Error type', () => {
      const result = processEvalResult({
        type: 'Error',
        name: 'TypeError',
        message: 'x is not defined',
        stack: 'TypeError: x is not defined\n    at eval:1:1'
      });
      assert.strictEqual(result.type, 'Error');
      assert.strictEqual(result.name, 'TypeError');
      assert.strictEqual(result.message, 'x is not defined');
      assert.ok(result.stack.includes('TypeError'));
    });

    it('should handle Element type', () => {
      const result = processEvalResult({
        type: 'Element',
        tagName: 'div',
        id: 'main',
        className: 'container',
        attributes: { 'data-id': '123' },
        textContent: 'Hello World',
        isConnected: true,
        childElementCount: 5
      });
      assert.strictEqual(result.type, 'Element');
      assert.strictEqual(result.tagName, 'div');
      assert.strictEqual(result.id, 'main');
      assert.strictEqual(result.className, 'container');
      assert.deepStrictEqual(result.attributes, { 'data-id': '123' });
      assert.strictEqual(result.isConnected, true);
      assert.strictEqual(result.childElementCount, 5);
    });

    it('should handle NodeList type', () => {
      const result = processEvalResult({
        type: 'NodeList',
        length: 3,
        items: [
          { tagName: 'div', id: 'a', className: 'item' },
          { tagName: 'div', id: 'b', className: 'item' }
        ]
      });
      assert.strictEqual(result.type, 'NodeList');
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.items.length, 2);
    });

    it('should handle HTMLCollection type', () => {
      const result = processEvalResult({
        type: 'HTMLCollection',
        length: 2,
        items: [{ tagName: 'li', id: null, className: 'list-item' }]
      });
      assert.strictEqual(result.type, 'HTMLCollection');
      assert.strictEqual(result.length, 2);
    });

    it('should handle Document type', () => {
      const result = processEvalResult({
        type: 'Document',
        title: 'Test Page',
        url: 'https://example.com',
        readyState: 'complete'
      });
      assert.strictEqual(result.type, 'Document');
      assert.strictEqual(result.title, 'Test Page');
      assert.strictEqual(result.url, 'https://example.com');
      assert.strictEqual(result.readyState, 'complete');
    });

    it('should handle Window type', () => {
      const result = processEvalResult({
        type: 'Window',
        location: 'https://example.com',
        innerWidth: 1920,
        innerHeight: 1080
      });
      assert.strictEqual(result.type, 'Window');
      assert.strictEqual(result.location, 'https://example.com');
      assert.strictEqual(result.innerWidth, 1920);
      assert.strictEqual(result.innerHeight, 1080);
    });

    it('should handle array type with items', () => {
      const result = processEvalResult({
        type: 'array',
        length: 3,
        items: [
          { type: 'number', value: 1 },
          { type: 'number', value: 2 },
          { type: 'number', value: 3 }
        ],
        truncated: false
      });
      assert.strictEqual(result.type, 'array');
      assert.strictEqual(result.length, 3);
      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.items[0].type, 'number');
      assert.strictEqual(result.items[0].value, 1);
    });

    it('should handle truncated array', () => {
      const result = processEvalResult({
        type: 'array',
        length: 150,
        items: new Array(100).fill({ type: 'number', value: 0 }),
        truncated: true
      });
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.length, 150);
      assert.strictEqual(result.items.length, 100);
    });

    it('should handle object type with entries', () => {
      const result = processEvalResult({
        type: 'object',
        keys: 2,
        entries: {
          name: { type: 'string', value: 'John' },
          age: { type: 'number', value: 30 }
        },
        truncated: false
      });
      assert.strictEqual(result.type, 'object');
      assert.strictEqual(result.keys, 2);
      assert.strictEqual(result.entries.name.type, 'string');
      assert.strictEqual(result.entries.name.value, 'John');
      assert.strictEqual(result.entries.age.type, 'number');
      assert.strictEqual(result.entries.age.value, 30);
    });

    it('should handle truncated object', () => {
      const entries = {};
      for (let i = 0; i < 50; i++) {
        entries[`key${i}`] = { type: 'number', value: i };
      }
      const result = processEvalResult({
        type: 'object',
        keys: 100,
        entries,
        truncated: true
      });
      assert.strictEqual(result.truncated, true);
      assert.strictEqual(result.keys, 100);
      assert.strictEqual(Object.keys(result.entries).length, 50);
    });

    it('should handle unknown type', () => {
      const result = processEvalResult({ type: 'unknown', repr: '[object CustomType]' });
      assert.strictEqual(result.type, 'unknown');
      assert.strictEqual(result.repr, '[object CustomType]');
    });

    it('should handle non-object input', () => {
      const result = processEvalResult('plain string');
      assert.strictEqual(result.type, 'unknown');
      assert.strictEqual(result.value, 'plain string');
    });

    it('should handle null input', () => {
      const result = processEvalResult(null);
      assert.strictEqual(result.type, 'unknown');
      assert.strictEqual(result.value, null);
    });

    it('should recursively process nested arrays', () => {
      const result = processEvalResult({
        type: 'array',
        length: 2,
        items: [
          {
            type: 'array',
            length: 2,
            items: [
              { type: 'number', value: 1 },
              { type: 'number', value: 2 }
            ]
          },
          { type: 'string', value: 'hello' }
        ]
      });
      assert.strictEqual(result.items[0].type, 'array');
      assert.strictEqual(result.items[0].items[0].type, 'number');
      assert.strictEqual(result.items[0].items[0].value, 1);
    });

    it('should recursively process nested objects', () => {
      const result = processEvalResult({
        type: 'object',
        keys: 1,
        entries: {
          nested: {
            type: 'object',
            keys: 1,
            entries: {
              value: { type: 'number', value: 42 }
            }
          }
        }
      });
      assert.strictEqual(result.entries.nested.type, 'object');
      assert.strictEqual(result.entries.nested.entries.value.type, 'number');
      assert.strictEqual(result.entries.nested.entries.value.value, 42);
    });
  });
});
