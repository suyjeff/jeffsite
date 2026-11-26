import Charts
import SwiftUI

/// A quiet line chart for metric plans: plum line, soft fill, no grid.
/// Optional x labels for week and month cards; none for the Today sparkline.
struct MetricChart: View, Equatable {
    let points: [MetricPoint]
    /// The days the x axis should span, so a sparse week still spreads Sun…Sat.
    var domain: ClosedRange<Date>?
    var showsAxis = false
    var highlight: Day?

    private var yDomain: ClosedRange<Double> {
        let values = points.map(\.value)
        guard let low = values.min(), let high = values.max() else { return 0...1 }
        let pad = max((high - low) * 0.25, max(abs(high) * 0.004, 0.5))
        return (low - pad)...(high + pad)
    }

    var body: some View {
        Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value("Day", point.day.date),
                    yStart: .value("Floor", yDomain.lowerBound),
                    yEnd: .value("Value", point.value)
                )
                .interpolationMethod(.monotone)
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color.plum.opacity(0.16), Color.plum.opacity(0)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )

                LineMark(
                    x: .value("Day", point.day.date),
                    y: .value("Value", point.value)
                )
                .interpolationMethod(.monotone)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .foregroundStyle(Color.plum)

                if points.count <= 31 {
                    PointMark(
                        x: .value("Day", point.day.date),
                        y: .value("Value", point.value)
                    )
                    .symbolSize(point.day == highlight ? 60 : 16)
                    .foregroundStyle(Color.plum)
                }
            }
        }
        .chartYScale(domain: yDomain)
        .chartXScale(domain: domain ?? defaultDomain)
        .chartYAxis(.hidden)
        .chartXAxis(showsAxis ? .visible : .hidden)
        .chartXAxis {
            AxisMarks(values: .stride(by: .day)) { _ in
                AxisValueLabel(format: .dateTime.weekday(.narrow))
                    .font(.cadenceMicro)
                    .foregroundStyle(Color.inkSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var defaultDomain: ClosedRange<Date> {
        guard let first = points.first?.day, let last = points.last?.day else {
            return Self.domain(from: .today.adding(-3), to: .today.adding(3))
        }
        return Self.domain(from: first, to: last)
    }

    /// Days are plotted at noon, so pad half a day either side to keep the ends on the plot.
    static func domain(from first: Day, to last: Day) -> ClosedRange<Date> {
        first.date.addingTimeInterval(-43_200)...max(last, first).date.addingTimeInterval(43_200)
    }
}

/// Trend copy like "−0.6 since Nov 22".
enum TrendText {
    static func delta(_ plan: Plan, value: Double, before day: Day) -> String? {
        guard let previousDay = previousLoggedDay(plan, before: day),
              let previous = plan.value(on: previousDay) else { return nil }
        let change = value - previous
        let sign = change > 0 ? "+" : change < 0 ? "−" : "±"
        let when = previousDay == day.adding(-1)
            ? "YESTERDAY"
            : previousDay.date.formatted(.dateTime.month(.abbreviated).day()).uppercased()
        return "\(sign)\(plan.format(abs(change))) SINCE \(when)"
    }

    static func previousLoggedDay(_ plan: Plan, before day: Day) -> Day? {
        let key = day.key
        return plan.records
            .filter { $0.key < key && $0.value.value != nil }
            .map(\.key)
            .max()
            .flatMap { Day(key: $0) }
    }
}
