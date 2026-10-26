import { describe, expect, it } from 'vitest';
import type { DropPayload, OverlayState } from '../../src/shared/channels';
import { acceptsDrops, laterEntry, parseDrop } from '../../src/shared/later';

const REDDIT = 'https://www.reddit.com/r/x/comments/1/a/';
const drop = (p: Partial<DropPayload>): DropPayload => ({ text: '', uriList: '', html: '', ...p });

describe('parseDrop', () => {
  it('reads a link and its title from uri-list and anchor HTML', () => {
    expect(
      parseDrop(
        drop({
          uriList: `# comment\n${REDDIT}`,
          text: REDDIT,
          html: `<a href="${REDDIT}"><faceplate-screen-reader-content>\n The duality of this sub is insame\n</faceplate-screen-reader-content></a>`,
        }),
      ),
    ).toEqual({ kind: 'link', url: REDDIT, title: 'The duality of this sub is insame' });
  });

  it('treats plain text that is a single URL as a link without a title', () => {
    expect(parseDrop(drop({ text: ' https://example.com/x ' }))).toEqual({
      kind: 'link',
      url: 'https://example.com/x',
      title: null,
    });
  });

  it('gives a thumbnail link (image only) no title', () => {
    expect(
      parseDrop(drop({ uriList: 'https://youtu.be/abc', html: '<a href="https://youtu.be/abc"><img src="t.jpg"></a>' })),
    ).toEqual({ kind: 'link', url: 'https://youtu.be/abc', title: null });
  });

  it('drops a title that is just the URL, and decodes entities', () => {
    expect(parseDrop(drop({ uriList: REDDIT, html: `<a href="${REDDIT}">${REDDIT}</a>` }))).toMatchObject({ title: null });
    expect(parseDrop(drop({ uriList: REDDIT, html: '<a>Tom &amp; Jerry&nbsp;&quot;x&quot; &#39;y&#39; &lt;z&gt;</a>' }))).toMatchObject({
      title: 'Tom & Jerry "x" \'y\' <z>',
    });
  });

  it('collapses dropped text onto one line', () => {
    expect(parseDrop(drop({ text: 'My prediction 🙌\r\n\r\nHarry Kane', html: '<p>My prediction</p>' }))).toEqual({
      kind: 'text',
      text: 'My prediction 🙌 Harry Kane',
    });
  });

  it('never makes a link out of a non-http URL', () => {
    expect(parseDrop(drop({ uriList: 'javascript:alert(1)', text: 'javascript:alert(1)' }))).toEqual({
      kind: 'text',
      text: 'javascript:alert(1)',
    });
  });

  it('ignores an empty drop', () => {
    expect(parseDrop(drop({}))).toBeNull();
    expect(parseDrop(drop({ text: '  \n ', html: '<b> </b>' }))).toBeNull();
  });
});

describe('laterEntry', () => {
  it('formats a titled link with its source', () => {
    expect(laterEntry({ kind: 'link', url: REDDIT, title: 'The duality of this sub is insame' }, 'Reddit')).toBe(
      `[ ] [The duality of this sub is insame](${REDDIT}) · Reddit`,
    );
  });

  it('formats an untitled link as an autolink', () => {
    expect(laterEntry({ kind: 'link', url: 'https://example.com/x', title: null }, null)).toBe('[ ] <https://example.com/x>');
  });

  it('formats text with its source', () => {
    expect(laterEntry({ kind: 'text', text: 'serendipity' }, 'La Casa de Papel')).toBe('[ ] serendipity · La Casa de Papel');
  });

  it('escapes brackets in titles and encodes ) and spaces in URLs', () => {
    expect(laterEntry({ kind: 'link', url: 'https://e.com/a_(b) c', title: 'a [b] c' }, null)).toBe(
      '[ ] [a \\[b\\] c](https://e.com/a_(b%29%20c)',
    );
  });

  it('caps text at 500 and titles at 200 characters', () => {
    const text = laterEntry({ kind: 'text', text: 'x'.repeat(600) }, null).slice('[ ] '.length);
    expect(text).toHaveLength(500);
    expect(text.endsWith('…')).toBe(true);
    const title = /^\[ \] \[(.*)\]\(/.exec(laterEntry({ kind: 'link', url: REDDIT, title: 'y'.repeat(250) }, null))![1];
    expect(title).toHaveLength(200);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('acceptsDrops', () => {
  const cases: [OverlayState, boolean][] = [
    [{ kind: 'idle', visible: true }, true],
    [{ kind: 'idle', visible: false }, false],
    [{ kind: 'idle', visible: false, film: true }, false],
    [{ kind: 'saved', noteId: 'n' }, true],
    [{ kind: 'recording', mode: 'hold', startedAt: 0, source: 'mic' }, false],
    [{ kind: 'busy', message: 'Saving…' }, false],
    [{ kind: 'error', message: 'x', retry: false }, false],
  ];
  it.each(cases)('%j → %s', (state, expected) => expect(acceptsDrops(state)).toBe(expected));
});
