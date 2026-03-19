import { Box } from 'ink';
import type { ReactNode } from 'react';
import type { FocusTarget, ScreenId } from '../types.js';
import { Footer } from './Footer.js';
import { Header, type HeaderProps } from './Header.js';
import { Sidebar } from './Sidebar.js';

export interface LayoutProps extends HeaderProps {
  activeScreen: ScreenId;
  focusTarget: FocusTarget;
  footerHint: string;
  children: ReactNode;
}

export function Layout({
  activeScreen,
  focusTarget,
  footerHint,
  children,
  ...headerProps
}: LayoutProps) {
  return (
    <Box flexDirection="column" padding={1}>
      <Header {...headerProps} />
      <Box marginTop={1} flexDirection="row">
        <Sidebar activeScreen={activeScreen} focusTarget={focusTarget} />
        <Box flexGrow={1} flexDirection="column">
          {children}
        </Box>
      </Box>
      <Footer focusTarget={focusTarget} hint={footerHint} />
    </Box>
  );
}
