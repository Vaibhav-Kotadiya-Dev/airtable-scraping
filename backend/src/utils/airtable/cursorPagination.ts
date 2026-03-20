type CursorPage<T> = {
  items: T[];
  offset: string | undefined;
};

export async function fetchAllCursorPages<T>(
  opts: {
    pageSize?: number;
    fetchPage: (args: { pageSize: number; offset?: string }) => Promise<CursorPage<T>>;
  },
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 100;
  const results: T[] = [];
  let offset: string | undefined = undefined;

  while (true) {
    const page: CursorPage<T> =
      offset === undefined
        ? await opts.fetchPage({ pageSize })
        : await opts.fetchPage({ pageSize, offset });
    results.push(...page.items);
    if (!page.offset) break;
    offset = page.offset;
  }

  return results;
}

