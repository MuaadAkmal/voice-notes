import { expect, it } from 'vitest';
import { OverlayMouse } from '../../src/main/overlay-mouse';

it('is click-through only when neither hovered nor dragged over', () => {
  const applied: boolean[] = [];
  const mouse = new OverlayMouse((ignore) => applied.push(ignore));
  mouse.setHover(true);
  expect(applied).toEqual([false]);
  mouse.setDrag(true);
  mouse.setHover(false); // the hover handler's mouseleave mid-drag must not make it click-through
  expect(applied).toEqual([false]);
  mouse.setDrag(false);
  expect(applied).toEqual([false, true]);
  mouse.setHover(false);
  expect(applied).toEqual([false, true]);
});
