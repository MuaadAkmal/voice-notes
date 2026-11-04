import { expect, it } from 'vitest';
import { removeLastLines } from '../../src/shared/list-lines';

it('removes the line a command added at the end', () => {
  expect(removeLastLines('# Groceries\n- eggs\n- milk\n', ['milk'])).toEqual({ body: '# Groceries\n- eggs\n', removed: ['milk'] });
});

it('removes several lines', () => {
  expect(removeLastLines('- a\n- milk\n- eggs\n', ['milk', 'eggs'])).toEqual({ body: '- a\n', removed: ['milk', 'eggs'] });
});

it('keeps an earlier copy of the same item', () => {
  expect(removeLastLines('- milk\n- bread\n- milk\n', ['milk']).body).toBe('- milk\n- bread\n');
});

it('leaves a line the user changed', () => {
  expect(removeLastLines('- eggs\n- milk!\n', ['milk'])).toEqual({ body: '- eggs\n- milk!\n', removed: [] });
});

it('works without a trailing newline', () => {
  expect(removeLastLines('- eggs\n- milk', ['milk'])).toEqual({ body: '- eggs\n', removed: ['milk'] });
});

it('removing the only line leaves an empty page', () => {
  expect(removeLastLines('- milk\n', ['milk'])).toEqual({ body: '', removed: ['milk'] });
});

it('matches the text as appendLine wrote it', () => {
  expect(removeLastLines('- two words\n', ['  two\nwords ']).removed).toEqual(['  two\nwords ']);
});
