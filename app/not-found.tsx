import type { Metadata } from 'next';
import { WebflowDocument } from '@/components/WebflowDocument';
import { loadPage } from '@/lib/webflow';

const page = loadPage('__404');

export const metadata: Metadata = { title: { absolute: page?.head.title ?? '404 - Page not found' } };

export default function NotFound() {
  return page ? <WebflowDocument page={page} /> : null;
}
