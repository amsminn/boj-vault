// Mapping from BOJ's internal category IDs (the N in /board/list/{N})
// to URL slugs and visible Korean labels.
//
// Derived from the BOJ board sidebar:
//   - 공지       → /board/list/notice    (ID 1)
//   - 자유       → /board/list/free      (ID 2)
//   - 질문       → /board/list/question  (ID 3)
//   - 오타/오역/요청 → /board/list/typo      (ID 6)
//   - 홍보       → /board/list/ad        (ID 9)
//
// Unknown IDs fall back to `category-{id}` with an empty display name; the
// caller is expected to surface the row's visible category text in that case.

interface CategoryMeta {
  slug: string;
  name: string;
}

const CATEGORIES: Record<number, CategoryMeta> = {
  1: { slug: 'notice', name: '공지' },
  2: { slug: 'free', name: '자유' },
  3: { slug: 'question', name: '질문' },
  6: { slug: 'typo', name: '오타/오역/요청' },
  9: { slug: 'ad', name: '홍보' },
};

export function categorySlugFromId(id: number): string {
  const meta = CATEGORIES[id];
  if (meta) return meta.slug;
  // eslint-disable-next-line no-console
  console.warn(`[board-categories] unknown category id: ${id} — falling back to category-${id}`);
  return `category-${id}`;
}

export function categoryNameFromId(id: number): string {
  return CATEGORIES[id]?.name ?? '';
}
