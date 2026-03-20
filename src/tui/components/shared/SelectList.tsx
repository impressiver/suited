import { Box, Text, useInput } from 'ink';

export interface SelectItem<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectListProps<T extends string = string> {
  items: Array<SelectItem<T>>;
  selectedIndex: number;
  onChange: (index: number, item: SelectItem<T>) => void;
  onSubmit?: (item: SelectItem<T>) => void;
  /** When false, arrow keys are ignored (global App may still receive keys — parent should coordinate). */
  isActive: boolean;
}

export function SelectList<T extends string = string>({
  items,
  selectedIndex,
  onChange,
  onSubmit,
  isActive,
}: SelectListProps<T>) {
  useInput(
    (_input, key) => {
      if (!isActive || items.length === 0) return;

      if (key.upArrow) {
        const next = (selectedIndex - 1 + items.length) % items.length;
        onChange(next, items[next]);
        return;
      }
      if (key.downArrow) {
        const next = (selectedIndex + 1) % items.length;
        onChange(next, items[next]);
        return;
      }
      if (key.return && onSubmit) {
        const item = items[selectedIndex];
        if (item) onSubmit(item);
      }
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const sel = i === selectedIndex;
        const rowActive = isActive && sel;
        return (
          <Text key={item.value} bold={rowActive} dimColor={!rowActive}>
            {rowActive ? (
              <>
                <Text color="white">›</Text>
                <Text> </Text>
              </>
            ) : (
              '  '
            )}
            {item.label}
          </Text>
        );
      })}
    </Box>
  );
}
