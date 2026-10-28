import { staffTheme } from '../../src/design-system';
import { WebTabs } from '../../src/design-system/components/web-tabs';

/** Browser build only; phones use the native tab bar in _layout.tsx. */
export default function TabsLayoutWeb() {
  return (
    <WebTabs
      theme={staffTheme}
      tabs={[
        { name: 'index', title: 'Trang chủ', icon: 'home' },
        { name: 'tasks', title: 'Việc của tôi', icon: 'clipboard' },
        { name: 'scan', title: 'Quét', icon: 'scan' },
        { name: 'profile', title: 'Cá nhân', icon: 'person-circle' },
      ]}
    />
  );
}
