import { PageWipe } from '@/components/motion';

/**
 * A template rather than a layout on purpose: Next remounts a template on
 * every navigation, which is exactly what makes the wipe replay each time a
 * page changes. A layout would play it once and never again.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageWipe>{children}</PageWipe>;
}
