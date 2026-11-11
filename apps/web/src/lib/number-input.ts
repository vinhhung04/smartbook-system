import type { ChangeEvent, FocusEvent, MouseEvent } from 'react';

// Number fields that start at "0": typing into one used to show "05" / "075". These
// helpers only change what the field displays; the value a form keeps is unchanged.

/** "05" -> "5". "0" itself and decimals like "0.5" are left as they are. */
export function withoutLeadingZeros(raw: string): string {
  return raw.replace(/^0+(?=\d)/, '');
}

/**
 * For the onChange of a number field whose state is a number. React does not rewrite a
 * number input whose text means the same number as the state ("075" and 75), so the
 * leading zero would stay on screen; it is removed from the field itself here.
 * Returns the cleaned text, to parse with Number() as before.
 */
export function numberInputValue(event: ChangeEvent<HTMLInputElement>): string {
  const input = event.target;
  const cleaned = withoutLeadingZeros(input.value);
  if (cleaned !== input.value) input.value = cleaned;
  return cleaned;
}

/** A field still showing "0" is selected as it gets focus, so the first key replaces the
 *  0 wherever the click put the caret. The click's own mouseup would move the caret and
 *  drop that selection, so that one mouseup is cancelled. Synchronous on purpose:
 *  selecting later (e.g. next frame) can land after the first key and overwrite it. */
function selectZeroOnFocus(event: FocusEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (input.value !== '0') return;
  input.select();
  input.dataset.keepZeroSelection = 'true';
}

function keepZeroSelectionOnMouseUp(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (input.dataset.keepZeroSelection !== 'true') return;
  delete input.dataset.keepZeroSelection;
  event.preventDefault();
}

/** Spread onto a number <input>/<Input> that can show 0: `<input {...zeroFieldProps} />`. */
export const zeroFieldProps = { onFocus: selectZeroOnFocus, onMouseUp: keepZeroSelectionOnMouseUp };
