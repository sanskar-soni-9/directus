import { describe, expect, test } from 'vitest';
import { splitFieldPath } from './split-field-path.js';

describe('splitFieldPath', () => {
	test('splits a simple dotted path', () => {
		expect(splitFieldPath('a.b.c')).toEqual(['a', 'b', 'c']);
	});

	test('returns single-segment path as array', () => {
		expect(splitFieldPath('field')).toEqual(['field']);
	});

	test('does not split dots inside parentheses', () => {
		expect(splitFieldPath('category_id.json(metadata, color)')).toEqual(['category_id', 'json(metadata, color)']);
	});

	test('does not split dots inside function args with dotted json path', () => {
		expect(splitFieldPath('category_id.json(metadata, settings.theme)')).toEqual([
			'category_id',
			'json(metadata, settings.theme)',
		]);
	});

	test('splits on dots outside parentheses only (multi-segment relational)', () => {
		expect(splitFieldPath('a.b.json(field, x.y.z)')).toEqual(['a', 'b', 'json(field, x.y.z)']);
	});

	test('handles a standalone json() function with no relational prefix', () => {
		expect(splitFieldPath('json(metadata, color)')).toEqual(['json(metadata, color)']);
	});

	test('handles a standalone json() function with dotted path arg', () => {
		expect(splitFieldPath('json(metadata, a.b.c)')).toEqual(['json(metadata, a.b.c)']);
	});
});
