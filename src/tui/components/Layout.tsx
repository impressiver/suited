import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { FocusTarget, ScreenId } from '../types.ts';
import { NAV_LABELS } from '../types.ts';
import { Footer } from './Footer.tsx';
import { Header, type HeaderProps } from './Header.tsx';
import { Sidebar } from './Sidebar.tsx';

export interface LayoutProps extends HeaderProps {
  activeScreen: ScreenId;
  focusTarget: FocusTarget;
  footerHint: string;
  /** One line when the right panel has keyboard focus (Enter/Esc context). */
  panelFocusBanner?: string | null;
  children: ReactNode;
}

export function Layout({
  activeScreen,
  focusTarget,
  footerHint,
  panelFocusBanner,
  children,
  ...headerProps
}: LayoutProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Header {...headerProps} />
      <Box marginTop={1} flexDirection="row">
        <Sidebar activeScreen={activeScreen} />
        <Box flexGrow={1} flexDirection="column">
          {panelFocusBanner != null && panelFocusBanner !== '' && (
            <Box marginBottom={1} flexDirection="column">
              <Text bold color="cyan">
                {NAV_LABELS[activeScreen]}
              </Text>
              <Text dimColor>{panelFocusBanner}</Text>
            </Box>
          )}
          {children}
        </Box>
      </Box>
      <Footer focusTarget={focusTarget} hint={footerHint} />
    </Box>
  );
}
