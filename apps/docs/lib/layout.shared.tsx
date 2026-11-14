import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="wordmark">
          kennel<sup>®</sup> <span className="wordmark-tag">docs</span>
        </span>
      ),
    },
    links: [
      { text: 'Open the app', url: 'https://kennelpad.fun/app', external: true },
      { text: 'SKILL.md', url: `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/main/SKILL.md`, external: true },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    // The docs share the app's dark terminal look; there is no light theme to switch to.
    themeSwitch: { enabled: false },
  };
}
