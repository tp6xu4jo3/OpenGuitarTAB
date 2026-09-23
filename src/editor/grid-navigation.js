import { fractionToNumber } from './model.js';

const DEFAULT_STRING_COUNT = 6;

function fractionFromDataset(value) {
  const match = String(value || '').match(/^(-?\d+)\/(\d+)$/);
  if (!match) return [0, 1];
  return [Number(match[1]), Number(match[2])];
}

function focusInput(input) {
  if (!input) return false;
  input.focus();
  input.select();
  return true;
}

function chronologicalInputsForString(root, documentModel, string) {
  const measureOrder = new Map(
    (documentModel?.measures || []).map((measure, index) => [String(measure.id), index])
  );

  return [...root.querySelectorAll(`.note-input[data-string="${Number(string)}"][data-measure-id][data-at]`)]
    .sort((left, right) => {
      const leftMeasure = measureOrder.get(String(left.dataset.measureId)) ?? Number.MAX_SAFE_INTEGER;
      const rightMeasure = measureOrder.get(String(right.dataset.measureId)) ?? Number.MAX_SAFE_INTEGER;
      return leftMeasure - rightMeasure
        || fractionToNumber(fractionFromDataset(left.dataset.at))
          - fractionToNumber(fractionFromDataset(right.dataset.at));
    });
}

export function focusRelativeInput(current, {
  documentModel,
  root = document,
  stringDelta = 0,
  timeDelta = 0,
  stringCount = DEFAULT_STRING_COUNT
} = {}) {
  const string = Number(current?.dataset?.string);
  if (!Number.isInteger(string)) return false;

  if (stringDelta !== 0) {
    const targetString = string + Math.sign(stringDelta);
    if (targetString < 0 || targetString >= stringCount) return false;

    const measureId = String(current.dataset.measureId || '');
    const at = String(current.dataset.at || '');
    const target = [...root.querySelectorAll(`.note-input[data-string="${targetString}"]`)]
      .find(input => String(input.dataset.measureId || '') === measureId
        && String(input.dataset.at || '') === at);
    return focusInput(target);
  }

  if (timeDelta !== 0) {
    const inputs = chronologicalInputsForString(root, documentModel, string);
    const index = inputs.indexOf(current);
    if (index < 0) return false;
    const nextIndex = Math.max(0, Math.min(inputs.length - 1, index + Math.sign(timeDelta)));
    return focusInput(inputs[nextIndex]);
  }

  return false;
}

export function handleGridNavigationKeydown(event, { documentModel, root = document } = {}) {
  const input = event.target?.closest?.('.note-input');
  if (!input || event.ctrlKey || event.metaKey) return false;

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    return focusRelativeInput(input, { documentModel, root, timeDelta: 1 });
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    return focusRelativeInput(input, { documentModel, root, timeDelta: -1 });
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    return focusRelativeInput(input, { documentModel, root, stringDelta: 1 });
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    return focusRelativeInput(input, { documentModel, root, stringDelta: -1 });
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    return true;
  }

  const allowedControlKeys = new Set(['Backspace', 'Delete', 'Tab', 'Home', 'End']);
  if (!allowedControlKeys.has(event.key) && !/^[\dxX]$/.test(event.key)) event.preventDefault();
  return false;
}
