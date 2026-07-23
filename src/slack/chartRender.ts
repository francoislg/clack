import type { Block as SlackRawBlock } from "@slack/types";
import type { AuthoredChartBlock, AuthoredChartSeries } from "./blockSchema.js";

interface DataVisualizationBlock {
  type: "data_visualization";
  title?: string;
  chart: PieChart | SeriesChart;
}

interface PieChart {
  type: "pie";
  segments: { label: string; value: number }[];
}

interface SeriesChart {
  type: "bar" | "area" | "line";
  series: { name: string; data: { label: string; value: number }[] }[];
  axis_config: { categories: string[]; x_label?: string; y_label?: string };
}

/**
 * Category axis for a series chart. Slack requires every data-point label to appear in
 * `axis_config.categories`; when the author omits categories we derive them from the union of
 * data-point labels in first-seen order, so Claude never has to restate them.
 */
function resolveCategories(chart: AuthoredChartBlock, series: AuthoredChartSeries[]): string[] {
  const explicit = chart.axis_config?.categories;
  if (explicit && explicit.length > 0) return explicit;
  const seen: string[] = [];
  const known = new Set<string>();
  for (const s of series) {
    for (const point of s.data) {
      if (!known.has(point.label)) {
        known.add(point.label);
        seen.push(point.label);
      }
    }
  }
  return seen;
}

/**
 * Render a validated authored chart into a Slack `data_visualization` block. `chart_type` maps to
 * the nested `chart.type`; pie carries `segments`, the other three carry `series` + `axis_config`.
 * Assumes `validateChart` has already enforced the pie⇄series exclusivity and every cap.
 */
export function renderChartForDelivery(chart: AuthoredChartBlock): SlackRawBlock {
  if (chart.chart_type === "pie") {
    const block: DataVisualizationBlock = {
      type: "data_visualization",
      ...(chart.title !== undefined && { title: chart.title }),
      chart: { type: "pie", segments: chart.segments ?? [] },
    };
    return block;
  }
  const series = chart.series ?? [];
  const axis = chart.axis_config;
  const block: DataVisualizationBlock = {
    type: "data_visualization",
    ...(chart.title !== undefined && { title: chart.title }),
    chart: {
      type: chart.chart_type,
      series,
      axis_config: {
        categories: resolveCategories(chart, series),
        ...(axis?.x_label !== undefined && { x_label: axis.x_label }),
        ...(axis?.y_label !== undefined && { y_label: axis.y_label }),
      },
    },
  };
  return block;
}
