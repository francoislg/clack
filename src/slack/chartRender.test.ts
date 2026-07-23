import { describe, it, expect } from "vitest";
import type { AuthoredChartBlock } from "./blockSchema.js";
import { renderChartForDelivery } from "./chartRender.js";

interface RenderedChart {
  type: string;
  title?: string;
  chart: {
    type: string;
    segments?: { label: string; value: number }[];
    series?: { name: string; data: { label: string; value: number }[] }[];
    axis_config?: { categories: string[]; x_label?: string; y_label?: string };
  };
}

function render(chart: AuthoredChartBlock): RenderedChart {
  const plain: RenderedChart = JSON.parse(JSON.stringify(renderChartForDelivery(chart)));
  return plain;
}

describe("renderChartForDelivery", () => {
  it("renders a pie chart with segments under chart.type pie", () => {
    const block = render({
      chart_type: "pie",
      title: "Votes",
      segments: [
        { label: "A", value: 3 },
        { label: "B", value: 5 },
      ],
    });
    expect(block.type).toBe("data_visualization");
    expect(block.title).toBe("Votes");
    expect(block.chart.type).toBe("pie");
    expect(block.chart.segments).toEqual([
      { label: "A", value: 3 },
      { label: "B", value: 5 },
    ]);
    expect(block.chart.series).toBeUndefined();
  });

  it("omits the title when absent", () => {
    const block = render({ chart_type: "pie", segments: [{ label: "A", value: 1 }] });
    expect(block.title).toBeUndefined();
  });

  it("renders a bar chart with series and derives categories from data labels", () => {
    const block = render({
      chart_type: "bar",
      series: [
        {
          name: "Sales",
          data: [
            { label: "Q1", value: 10 },
            { label: "Q2", value: 20 },
          ],
        },
      ],
    });
    expect(block.chart.type).toBe("bar");
    expect(block.chart.series?.[0].name).toBe("Sales");
    expect(block.chart.axis_config?.categories).toEqual(["Q1", "Q2"]);
    expect(block.chart.segments).toBeUndefined();
  });

  it("honors explicit axis_config categories and labels", () => {
    const block = render({
      chart_type: "line",
      series: [{ name: "S", data: [{ label: "Jan", value: 1 }] }],
      axis_config: { categories: ["Jan", "Feb"], x_label: "Month", y_label: "Count" },
    });
    expect(block.chart.axis_config).toEqual({
      categories: ["Jan", "Feb"],
      x_label: "Month",
      y_label: "Count",
    });
  });

  it("dedupes derived categories across series in first-seen order", () => {
    const block = render({
      chart_type: "area",
      series: [
        {
          name: "A",
          data: [
            { label: "X", value: 1 },
            { label: "Y", value: 2 },
          ],
        },
        {
          name: "B",
          data: [
            { label: "Y", value: 3 },
            { label: "Z", value: 4 },
          ],
        },
      ],
    });
    expect(block.chart.axis_config?.categories).toEqual(["X", "Y", "Z"]);
  });
});
