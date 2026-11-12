export const GRAPH_COLUMNS = [
  { key: 'refs', label: 'Branch / Tag' },
  { key: 'graph', label: 'Graph' },
  { key: 'subject', label: 'Commit message' },
  { key: 'author', label: 'Author' },
  { key: 'sha', label: 'SHA' },
  { key: 'time', label: 'Date' },
] as const;

export type GraphColumn = (typeof GRAPH_COLUMNS)[number]['key'];
export type GraphColumnWidths = Partial<Record<GraphColumn, number>>;
export const MAX_COLUMN_WIDTH = 1200;
// Five 8px gaps, a 2px selection border and 12px trailing padding.
export const COLUMN_SPACING = 54;

export function graphColumnMin(key: GraphColumn, graphWidth: number): number {
  return { refs: 100, graph: graphWidth, subject: 160, author: 72, sha: 56, time: 44 }[key];
}

export function graphColumnWidths(viewport: number, graphWidth: number, saved: GraphColumnWidths): Record<GraphColumn, number> {
  const widths = { refs: 190, graph: graphWidth ? Math.max(64, graphWidth) : 0, subject: 240, author: 120, sha: 64, time: 50 };
  for (const column of GRAPH_COLUMNS) {
    if (column.key === 'graph' && !graphWidth) continue;
    const value = saved[column.key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      widths[column.key] = Math.max(graphColumnMin(column.key, graphWidth), Math.min(MAX_COLUMN_WIDTH, value));
    }
  }
  if (saved.subject === undefined || !Number.isFinite(saved.subject)) {
    const spacing = graphWidth ? COLUMN_SPACING : COLUMN_SPACING - 8;
    widths.subject = Math.max(160, Math.min(MAX_COLUMN_WIDTH, viewport - spacing - widths.refs - widths.graph - widths.author - widths.sha - widths.time));
  }
  return widths;
}
