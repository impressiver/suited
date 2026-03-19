import { Box, Text } from 'ink';

export interface DelegateScreenProps {
  title: string;
  description: string;
  cliHint: string;
}

/** Screen that delegates to an existing `suited` subcommand via subprocess. */
export function DelegateScreen({ title, description, cliHint }: DelegateScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text>{description}</Text>
      <Box marginTop={1}>
        <Text dimColor>CLI: {cliHint}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter (content focused) to run this command in your terminal.</Text>
      </Box>
    </Box>
  );
}
