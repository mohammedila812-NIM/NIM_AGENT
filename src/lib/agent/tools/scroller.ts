/** Scroll commands executed in page context via scripting. */
export function scrollPage(
  direction: 'up' | 'down' | 'to_element',
  pixels?: number,
  selector?: string,
): void {
  if (typeof window === 'undefined') return;

  if (direction === 'to_element' && selector) {
    const el = document.querySelector(selector);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const amount = pixels ?? window.innerHeight * 0.8;
  window.scrollBy({
    top: direction === 'down' ? amount : -amount,
    behavior: 'smooth',
  });
}
