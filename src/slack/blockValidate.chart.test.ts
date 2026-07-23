import { describe, it, expect } from "vitest";
import type { AuthoredChartBlock } from "./blockSchema.js";
import { validateChart } from "./blockValidate.js";

function fields(chart: AuthoredChartBlock): string[] {
  return validateChart(chart, "chart").map((e) => e.field);
}

describe("validateChart — pie", () => {
  it("accepts a valid pie chart", () => {
    const errors = validateChart(
      {
        chart_type: "pie",
        segments: [
          { label: "A", value: 1 },
          { label: "B", value: 2 },
        ],
      },
      "chart",
    );
    expect(errors).toEqual([]);
  });

  it("rejects a pie chart carrying series", () => {
    const errors = validateChart(
      {
        chart_type: "pie",
        segments: [{ label: "A", value: 1 }],
        series: [{ name: "S", data: [{ label: "X", value: 1 }] }],
      },
      "chart",
    );
    expect(
      errors.some((e) => e.field === "chart.series" && /takes `segments`/.test(e.message)),
    ).toBe(true);
  });

  it("rejects a pie chart with no segments", () => {
    expect(fields({ chart_type: "pie" })).toContain("chart.segments");
  });

  it("rejects more than 12 segments", () => {
    const segments = Array.from({ length: 13 }, (_, i) => ({ label: `s${i}`, value: i + 1 }));
    const err = validateChart({ chart_type: "pie", segments }, "chart").find(
      (e) => e.field === "chart.segments",
    );
    expect(err?.limit).toBe(12);
  });

  it("rejects a segment label over 20 chars", () => {
    const errors = validateChart(
      { chart_type: "pie", segments: [{ label: "x".repeat(21), value: 1 }] },
      "chart",
    );
    expect(errors.some((e) => e.field === "chart.segments[0].label")).toBe(true);
  });
});

describe("validateChart — series charts", () => {
  const okSeries = { name: "S", data: [{ label: "X", value: 1 }] };

  it("accepts a valid bar chart", () => {
    expect(validateChart({ chart_type: "bar", series: [okSeries] }, "chart")).toEqual([]);
  });

  it("rejects a series chart carrying segments", () => {
    const errors = validateChart(
      { chart_type: "line", series: [okSeries], segments: [{ label: "A", value: 1 }] },
      "chart",
    );
    expect(
      errors.some((e) => e.field === "chart.segments" && /takes `series`/.test(e.message)),
    ).toBe(true);
  });

  it("rejects more than 12 series", () => {
    const series = Array.from({ length: 13 }, (_, i) => ({
      name: `n${i}`,
      data: [{ label: "X", value: 1 }],
    }));
    const err = validateChart({ chart_type: "area", series }, "chart").find(
      (e) => e.field === "chart.series",
    );
    expect(err?.limit).toBe(12);
  });

  it("rejects a series with more than 20 data points", () => {
    const data = Array.from({ length: 21 }, (_, i) => ({ label: `p${i}`, value: i }));
    const err = validateChart({ chart_type: "bar", series: [{ name: "S", data }] }, "chart").find(
      (e) => e.field === "chart.series[0].data",
    );
    expect(err?.limit).toBe(20);
  });

  it("rejects duplicate series names", () => {
    const errors = validateChart(
      {
        chart_type: "bar",
        series: [
          { name: "Dup", data: [{ label: "X", value: 1 }] },
          { name: "Dup", data: [{ label: "Y", value: 2 }] },
        ],
      },
      "chart",
    );
    expect(errors.some((e) => /duplicated/.test(e.message))).toBe(true);
  });
});

describe("validateChart — shared caps", () => {
  it("rejects a title over 50 chars", () => {
    const errors = validateChart(
      { chart_type: "pie", title: "t".repeat(51), segments: [{ label: "A", value: 1 }] },
      "chart",
    );
    expect(errors.some((e) => e.field === "chart.title")).toBe(true);
  });

  it("rejects explicit categories that omit a data-point label", () => {
    const errors = validateChart(
      {
        chart_type: "bar",
        series: [
          {
            name: "S",
            data: [
              { label: "Jan", value: 1 },
              { label: "Feb", value: 2 },
            ],
          },
        ],
        axis_config: { categories: ["Jan"] },
      },
      "chart",
    );
    const err = errors.find((e) => e.field === "chart.axis_config.categories");
    expect(err).toBeDefined();
    expect(err?.message).toMatch(/"Feb"/);
  });

  it("accepts explicit categories that cover every data-point label", () => {
    const errors = validateChart(
      {
        chart_type: "bar",
        series: [{ name: "S", data: [{ label: "Jan", value: 1 }] }],
        axis_config: { categories: ["Jan", "Feb"] },
      },
      "chart",
    );
    expect(errors).toEqual([]);
  });

  it("rejects axis labels over 50 chars", () => {
    const errors = validateChart(
      {
        chart_type: "bar",
        series: [{ name: "S", data: [{ label: "X", value: 1 }] }],
        axis_config: { x_label: "x".repeat(51) },
      },
      "chart",
    );
    expect(errors.some((e) => e.field === "chart.axis_config.x_label")).toBe(true);
  });

  it("namespaces field paths by the given prefix", () => {
    const errors = validateChart({ chart_type: "pie" }, "actions[2].chart");
    expect(errors[0].field.startsWith("actions[2].chart")).toBe(true);
  });
});
