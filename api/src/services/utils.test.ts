import { describe, test, vi } from 'vitest';

vi.mock('../cache.js', () => ({
	getCache: vi.fn().mockReturnValue({ cache: null }),
	clearSystemCache: vi.fn(),
}));

vi.mock('../database/index.js', () => ({
	default: vi.fn(),
}));

describe('UtilsService', () => {
	test.todo('clearCache');
});
