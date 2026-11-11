import { customerTheme } from '../../../src/design-system';
import { WebTabs } from '../../../src/design-system/components/web-tabs';

/** Browser build only; phones use the native tab bar in _layout.tsx. */
export default function CustomerTabsLayoutWeb() {
  return (
    <WebTabs
      theme={customerTheme}
      tabs={[
        { name: 'index', title: 'Khám phá', icon: 'compass' },
        { name: 'my-books', title: 'Sách của tôi', icon: 'library' },
        { name: 'wallet', title: 'Ví & phí', icon: 'wallet' },
        { name: 'profile', title: 'Cá nhân', icon: 'person-circle' },
      ]}
    />
  );
}
