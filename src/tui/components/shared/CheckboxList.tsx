import { Box, Text, useInput } from 'ink';

export interface CheckboxItem<T extends string = string> {
  value: T;
  label: string;
  checked: boolean;
  /** When true, Space does not toggle (paired with section floor in Generate). */
  locked?: boolean;
}

export interface CheckboxListProps<T extends string = string> {
  items: Array<CheckboxItem<T>>;
  focusedIndex: number;
  onFocusChange: (index: number) => void;
  onItemsChange: (items: Array<CheckboxItem<T>>) => void;
  onConfirm: () => void;
  isActive: boolean;
}

/**
 * Multi-select list: ↑↓ move · Space toggles · Enter confirms.
 */
export function CheckboxList<T extends string = string>({
  items,
  focusedIndex,
  onFocusChange,
  onItemsChange,
  onConfirm,
  isActive,
}: CheckboxListProps<T>) {
  useInput(
    (input, inkKey) => {
      if (!isActive || items.length === 0) {
        return;
      }

      if (inkKey.upArrow) {
        const next = (focusedIndex - 1 + items.length) % items.length;
        onFocusChange(next);
        return;
      }
      if (inkKey.downArrow) {
        const next = (focusedIndex + 1) % items.length;
        onFocusChange(next);
        return;
      }
      if (inkKey.return) {
        onConfirm();
        return;
      }
      if (input === ' ') {
        const row = items[focusedIndex];
        if (!row || row.locked) {
          return;
        }
        const nextItems = items.map((it, i) =>
          i === focusedIndex ? { ...it, checked: !it.checked } : it,
        );
        onItemsChange(nextItems);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const rowFocus = isActive && i === focusedIndex;
        const mark = item.locked ? '[=]' : item.checked ? '[x]' : '[ ]';
        return (
          <Text key={item.value} bold={rowFocus} dimColor={!rowFocus}>
            {rowFocus ? (
              <>
                <Text color="white">›</Text>
                <Text> </Text>
              </>
            ) : (
              '  '
            )}
            {mark} {item.label}
          </Text>
        );
      })}
    </Box>
  );
}
