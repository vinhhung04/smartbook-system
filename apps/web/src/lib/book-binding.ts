// Cloth-binding tones for books that have no cover photo yet (and for every
// book's spine in 3D). The fallback cover prints the real title and author —
// it never pretends to be cover art.
const BINDINGS = ['#1F3A5F', '#2F5D50', '#7A3B2E', '#4B3F72', '#7A5F1C', '#3D4A55'];

export function bindingFor(title: string) {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return BINDINGS[hash % BINDINGS.length];
}
