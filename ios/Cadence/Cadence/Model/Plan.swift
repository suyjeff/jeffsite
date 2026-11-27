import Foundation

enum PlanKind: String, Codable, Sendable {
    /// A schedule: a weekly sheet you write and check off (training, skincare, habits).
    case routine
    /// A scale: a number you log once a day (weight, sleep, steps…).
    case metric
    /// A streak: one yes-or-no a day ("did I do it?"), nothing to write.
    case streak
}

enum Mark: String, Codable, Sendable {
    case done
    case skipped
}

/// One week of a routine, written like a sheet: 7 rows (Sun…Sat) × N columns.
struct WeekPlan: Codable, Hashable, Sendable {
    var cells: [[String]]

    init(columns: Int) {
        cells = Array(repeating: Array(repeating: "", count: max(columns, 1)), count: 7)
    }

    init(cells: [[String]]) {
        self.cells = cells
    }

    func text(weekday: Int, column: Int) -> String {
        guard cells.indices.contains(weekday), cells[weekday].indices.contains(column) else { return "" }
        return cells[weekday][column]
    }

    mutating func set(_ text: String, weekday: Int, column: Int) {
        guard (0..<7).contains(weekday), column >= 0 else { return }
        while cells.count < 7 { cells.append([]) }
        while cells[weekday].count <= column { cells[weekday].append("") }
        cells[weekday][column] = text
    }

    mutating func resize(columns: Int) {
        let count = max(columns, 1)
        cells = (0..<7).map { weekday in
            let row = cells.indices.contains(weekday) ? cells[weekday] : []
            return (0..<count).map { row.indices.contains($0) ? row[$0] : "" }
        }
    }

    var isBlank: Bool {
        cells.allSatisfy { row in row.allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    }
}

/// Everything recorded for one plan on one day.
struct DayRecord: Codable, Hashable, Sendable {
    /// Column index → mark. A routine with AM/PM columns has up to two marks per day.
    var marks: [Int: Mark] = [:]
    /// Metric plans only.
    var value: Double?
    /// When the day (or the value) was completed, shown (muted) when the day is held.
    var completedAt: Date?
    /// A note for this one day of a scale ("after a long run"). Never carried to other days.
    var note: String?

    var isEmpty: Bool { marks.isEmpty && value == nil && (note ?? "").isEmpty }
}

/// How a day reads at a glance.
enum DayStatus: Equatable, Sendable {
    /// Nothing planned that day.
    case empty
    case pending
    /// Some columns done, some still open.
    case partial(done: Int, of: Int)
    case done
    case skipped

    var isComplete: Bool { self == .done }
    var isResolved: Bool {
        switch self {
        case .done, .skipped, .empty: true
        default: false
        }
    }
}

struct Plan: Identifiable, Codable, Hashable, Sendable {
    var id = UUID()
    var name: String
    var kind: PlanKind
    /// Column titles for routines ("AM", "PM"). A single unnamed column is `[""]`.
    var columns: [String]
    /// Metric plans: unit label and the ruler's step.
    var unit: String = ""
    var step: Double = 0.1
    /// Week start key → the sheet written for that week. A week without its own
    /// entry repeats the most recent earlier week, so a plan carries forward until changed.
    var weeks: [String: WeekPlan] = [:]
    /// Day key → one-off edits that replace a single day's text.
    var overrides: [String: [String]] = [:]
    /// Day key → marks and values.
    var records: [String: DayRecord] = [:]
    /// An SF Symbol chosen for the plan. Nil falls back to one for its kind.
    var icon: String?

    init(name: String, kind: PlanKind, columns: [String] = [""], unit: String = "", step: Double = 0.1) {
        self.name = name
        self.kind = kind
        self.columns = columns.isEmpty ? [""] : columns
        self.unit = unit
        self.step = step
    }

    var columnCount: Int { kind == .streak ? 1 : max(columns.count, 1) }
    var isMetric: Bool { kind == .metric }
    var isStreak: Bool { kind == .streak }

    /// The plan's icon: the chosen one, or its kind's.
    var symbol: String {
        if let icon, !icon.isEmpty { return icon }
        switch kind {
        case .routine: return columnCount > 1 ? "square.split.2x1" : "tablecells"
        case .metric: return "number"
        case .streak: return "flame"
        }
    }

    // MARK: Week plans

    /// The sheet that applies to the week starting at `weekStart`, and the week it was written for.
    func resolvedWeek(_ weekStart: Day) -> (plan: WeekPlan, source: Day?) {
        let key = weekStart.key
        if let own = weeks[key] { return (own, weekStart) }
        let earlier = weeks.keys.filter { $0 < key }.max()
        if let earlier, let plan = weeks[earlier] { return (plan, Day(key: earlier)) }
        return (WeekPlan(columns: columnCount), nil)
    }

    func hasOwnWeek(_ weekStart: Day) -> Bool { weeks[weekStart.key] != nil }

    /// The text planned in each column on `day`, trimmed.
    func items(on day: Day) -> [String] {
        // A streak is the same single yes-or-no every day.
        if isStreak { return [name.isEmpty ? "Did it" : name] }
        if let override = overrides[day.key] {
            return (0..<columnCount).map { override.indices.contains($0) ? clean(override[$0]) : "" }
        }
        let week = resolvedWeek(day.weekStart).plan
        return (0..<columnCount).map { clean(week.text(weekday: day.weekdayIndex, column: $0)) }
    }

    func plannedColumns(on day: Day) -> [Int] {
        if isMetric { return [0] }
        return items(on: day).enumerated().compactMap { $0.element.isEmpty ? nil : $0.offset }
    }

    func isPlanned(_ day: Day) -> Bool { !plannedColumns(on: day).isEmpty }

    private func clean(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Marks

    func record(on day: Day) -> DayRecord { records[day.key] ?? DayRecord() }

    func mark(on day: Day, column: Int) -> Mark? { records[day.key]?.marks[column] }

    func status(on day: Day) -> DayStatus {
        let record = record(on: day)
        if isMetric {
            if record.value != nil { return .done }
            return record.marks[0] == .skipped ? .skipped : .pending
        }
        let planned = plannedColumns(on: day)
        guard !planned.isEmpty else { return .empty }
        let done = planned.filter { record.marks[$0] == .done }.count
        let skipped = planned.filter { record.marks[$0] == .skipped }.count
        if done == planned.count { return .done }
        if skipped > 0 && done + skipped == planned.count && done == 0 { return .skipped }
        if done > 0 { return .partial(done: done, of: planned.count) }
        return .pending
    }

    mutating func setMark(_ mark: Mark?, on day: Day, column: Int) {
        var record = record(on: day)
        record.marks[column] = mark
        record.completedAt = status(after: record, on: day) == .done ? Date() : nil
        store(record, on: day)
    }

    /// Marks every planned column at once (the whole-card swipe).
    mutating func setDay(_ mark: Mark?, on day: Day) {
        var record = record(on: day)
        if isMetric {
            if mark == .skipped { record.value = nil }
            record.marks[0] = mark == .skipped ? .skipped : nil
        } else {
            for column in plannedColumns(on: day) { record.marks[column] = mark }
        }
        record.completedAt = mark == .done ? Date() : nil
        store(record, on: day)
    }

    mutating func setNote(_ note: String?, on day: Day) {
        var record = record(on: day)
        let trimmed = note?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        record.note = trimmed.isEmpty ? nil : trimmed
        store(record, on: day)
    }

    func note(on day: Day) -> String? { records[day.key]?.note }

    mutating func setValue(_ value: Double?, on day: Day) {
        var record = record(on: day)
        record.value = value
        record.marks[0] = nil
        record.completedAt = value == nil ? nil : Date()
        store(record, on: day)
    }

    private func status(after record: DayRecord, on day: Day) -> DayStatus {
        var copy = self
        copy.records[day.key] = record
        return copy.status(on: day)
    }

    private mutating func store(_ record: DayRecord, on day: Day) {
        records[day.key] = record.isEmpty ? nil : record
    }

    // MARK: Summaries

    /// Days done out of days planned, for the "3/7" pill.
    func progress(in days: [Day]) -> (done: Int, planned: Int) {
        var done = 0
        var planned = 0
        for day in days {
            let status = status(on: day)
            if status == .empty { continue }
            planned += 1
            if status == .done { done += 1 }
        }
        return (done, planned)
    }

    /// Consecutive completed days ending today (or yesterday, if today is still open).
    /// Days with nothing planned don't break a streak; a skip does.
    func streak(asOf today: Day) -> Int {
        var count = 0
        var day = today
        if !status(on: today).isComplete { day = today.adding(-1) }
        for _ in 0..<730 {
            switch status(on: day) {
            case .done: count += 1
            case .empty: break
            default: return count
            }
            day = day.adding(-1)
        }
        return count
    }

    // MARK: Metric values

    func value(on day: Day) -> Double? { records[day.key]?.value }

    func latestValue(onOrBefore day: Day) -> Double? {
        let key = day.key
        return records
            .filter { $0.key <= key && $0.value.value != nil }
            .max { $0.key < $1.key }?
            .value.value
    }

    func points(in days: [Day]) -> [MetricPoint] {
        days.compactMap { day in value(on: day).map { MetricPoint(day: day, value: $0) } }
    }

    /// Decimal places implied by the step: 0.1 → 1, 0.25 → 2, 1 → 0.
    var decimals: Int {
        var places = 0
        var scaled = step
        while places < 3 && abs(scaled.rounded() - scaled) > 0.000_1 {
            scaled *= 10
            places += 1
        }
        return places
    }

    func format(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(decimals)))
    }
}

struct MetricPoint: Identifiable, Hashable, Sendable {
    let day: Day
    let value: Double
    var id: String { day.key }
}
