import { useEffect } from 'react';

const SITE_NAME = 'SmartBook';
const DEFAULT_TITLE = 'SmartBook — Thư viện sách';
const DEFAULT_DESCRIPTION = 'Tìm sách, xem còn bao nhiêu cuốn ở chi nhánh nào và đặt trước trực tuyến tại thư viện SmartBook.';

interface PageMeta {
  title?: string;
  description?: string;
  image?: string | null;
  type?: 'website' | 'book';
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

/**
 * Title, description and Open Graph tags for public pages. This is a client-rendered
 * SPA, so crawlers that execute JS and link-preview tools that read the live DOM get
 * per-page tags; the static defaults in index.html cover everything else.
 */
export function usePageMeta({ title, description, image, type = 'website' }: PageMeta) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SITE_NAME}` : DEFAULT_TITLE;
    const text = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 160);
    document.title = fullTitle;
    setMeta('name', 'description', text);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', text);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:url', window.location.href);
    if (image) setMeta('property', 'og:image', image);
    // Pages outside the public site (login, portal) don't set a title themselves.
    return () => { document.title = DEFAULT_TITLE; };
  }, [title, description, image, type]);
}
