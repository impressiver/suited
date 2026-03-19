import { Box, Text } from 'ink';

export interface ImportScreenProps {
  profileDir: string;
}

export function ImportScreen({ profileDir }: ImportScreenProps) {
  return (
    <Box flexDirection="column">
      <Text bold>Import profile</Text>
      <Text dimColor>
        Runs the interactive import flow in this terminal (LinkedIn URL, export ZIP, or paste).
      </Text>
      <Box marginTop={1}>
        <Text>Profile directory: {profileDir}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          Press Enter while this screen is focused to launch import, or use the CLI.
        </Text>
      </Box>
    </Box>
  );
}
