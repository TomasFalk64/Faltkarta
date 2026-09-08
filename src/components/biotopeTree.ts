export type BiotopeNode = {
  id: number;
  label: string;
  children: BiotopeNode[];
};

export type BiotopeRow = { node: BiotopeNode; key: string; depth: number; path: string[] };

// Search across all levels, then allow each matching branch to be browsed normally.
export function biotopeRows(nodes: BiotopeNode[], query: string, expanded: Set<string>): BiotopeRow[] {
  const search = query.trim().toLocaleLowerCase("sv-SE");
  const candidates: BiotopeRow[] = [];
  function find(items: BiotopeNode[], path: string[], parentKey: string) {
    items.forEach((node, index) => {
      const key = `${parentKey}/${index}`;
      if (node.label.toLocaleLowerCase("sv-SE").includes(search)) {
        candidates.push({ node, key, depth: 0, path });
      }
      find(node.children, [...path, node.label], key);
    });
  }
  if (search) find(nodes, [], "");
  else candidates.push(...nodes.map((node, index) => ({ node, key: `/${index}`, depth: 0, path: [] })));

  const rows: BiotopeRow[] = [];
  const seen = new Set<string>();
  function append(row: BiotopeRow) {
    if (seen.has(row.key)) return;
    seen.add(row.key);
    rows.push(row);
    if (expanded.has(row.key)) {
      row.node.children.forEach((node, index) => {
        append({ node, key: `${row.key}/${index}`, depth: row.depth + 1, path: [...row.path, row.node.label] });
      });
    }
  }
  candidates.forEach(append);
  return rows;
}

export function biotopeAncestors(nodes: BiotopeNode[], selectedId?: number, parentKey = ""): string[] {
  for (const [index, node] of nodes.entries()) {
    const key = `${parentKey}/${index}`;
    if (node.id === selectedId) return [key];
    const branch = biotopeAncestors(node.children, selectedId, key);
    if (branch.length) return [key, ...branch];
  }
  return [];
}
