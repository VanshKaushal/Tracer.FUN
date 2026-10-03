import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, HeatmapChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
  LegendComponent,
  CanvasRenderer,
]);
export function Chart({
  option,
  label,
  height = 230,
}: {
  option: echarts.EChartsCoreOption;
  label: string;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 180,
      animation:
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
        !document.hidden,
      textStyle: {
        fontFamily: "Inter, Segoe UI, sans-serif",
        color: "#92978e",
      },
      ...option,
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    const visibility = () =>
      chart.setOption({
        animation:
          !document.hidden &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      chart.dispose();
    };
  }, [option]);
  return (
    <div
      className="chart"
      ref={ref}
      style={{ height }}
      role="img"
      aria-label={label}
    />
  );
}
export function seriesChart(
  labels: string[],
  values: number[],
  type: "bar" | "line" = "bar",
) {
  return {
    grid: { top: 12, right: 12, bottom: 28, left: 50 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#20241c",
      borderColor: "#363d2d",
      textStyle: { color: "#edf1e8" },
    },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: "#30362a" } },
      axisTick: { show: false },
      axisLabel: { color: "#8e9686" },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#252a20" } },
      axisLabel: { color: "#8e9686" },
    },
    series: [
      {
        type,
        data: values,
        barMaxWidth: 22,
        smooth: 0.3,
        itemStyle: { color: "#b6e77d", borderRadius: [3, 3, 0, 0] },
        lineStyle: { width: 2, color: "#b6e77d" },
        areaStyle:
          type === "line" ? { color: "#b6e77d", opacity: 0.07 } : undefined,
        showSymbol: false,
      },
    ],
  };
}
