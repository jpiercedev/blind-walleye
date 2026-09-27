import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WebflowDocument } from '@/components/WebflowDocument';
import { loadPage, site, slugForRoute } from '@/lib/webflow';

type Props = { params: Promise<{ slug?: string[] }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return site.routes.map((route) => ({ slug: route === '/' ? [] : route.slice(1).split('/') }));
}

function pageFor(slug?: string[]) {
  return loadPage(slugForRoute('/' + (slug ?? []).join('/')));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = pageFor((await params).slug);
  return page ? { title: { absolute: page.head.title } } : {};
}

export default async function Page({ params }: Props) {
  const page = pageFor((await params).slug);
  if (!page) notFound();
  return <WebflowDocument page={page} />;
}
