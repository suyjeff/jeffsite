import Foundation
import Observation
import SwiftUI
import os

/// The single source of truth. Views read plans from here and send every mutation through it,
/// so persistence and the "all done today" check live in one place.
@MainActor
@Observable
final class Store {
    private(set) var plans: [Plan] = []
    private(set) var today: Day = .today
    /// Bumped on every change to any plan. Views that hold a `Plan` snapshot compare this
    /// instead of whole plans (with all their history) to decide whether to re-render.
    private(set) var revision = 0

    /// Unsaved ruler positions for metric plans, keyed by plan. Not persisted.
    private var drafts: [UUID: Double] = [:]

    @ObservationIgnored private var saveTask: Task<Void, Never>?
    private let log = Logger(subsystem: "com.sujeff.cadence", category: "store")

    init() {
        load()
    }

    // MARK: Lookup

    func plan(_ id: UUID?) -> Plan? {
        guard let id else { return nil }
        return plans.first { $0.id == id }
    }

    func index(of id: UUID?) -> Int? {
        guard let id else { return nil }
        return plans.firstIndex { $0.id == id }
    }

    /// True once every routine planned for today is done (or deliberately skipped),
    /// with at least one actually done. Drives the "All done" moment.
    var allDoneToday: Bool {
        let routines = plans.filter { !$0.isMetric && $0.isPlanned(today) }
        guard !routines.isEmpty else { return false }
        let statuses = routines.map { $0.status(on: today) }
        return statuses.allSatisfy(\.isResolved) && statuses.contains(.done)
    }

    // MARK: Mutations

    func update(_ id: UUID, _ change: (inout Plan) -> Void) {
        guard let index = index(of: id) else { return }
        change(&plans[index])
        revision &+= 1
        scheduleSave()
    }

    func add(_ plan: Plan) {
        plans.append(plan)
        revision &+= 1
        scheduleSave()
    }

    func delete(_ id: UUID) {
        plans.removeAll { $0.id == id }
        revision &+= 1
        drafts[id] = nil
        scheduleSave()
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) {
        plans.move(fromOffsets: source, toOffset: destination)
        revision &+= 1
        scheduleSave()
    }

    func refreshToday() {
        let now = Day.today
        if now != today { today = now }
    }

    // MARK: Marking

    enum Change {
        case completed
        case progressed
        case cleared
        case skipped
        case logged
    }

    /// Whole-day toggle used by the card swipe and the check button on single-column plans.
    @discardableResult
    func toggleDone(_ id: UUID, on day: Day) -> Change? {
        guard let plan = plan(id) else { return nil }
        if plan.isMetric {
            // A logged value with an unsaved ruler change means "update", not "undo".
            if plan.value(on: day) != nil && !(day == today && hasDraftChange(plan)) {
                update(id) { $0.setValue(nil, on: day) }
                return .cleared
            }
            let value = draft(for: plan, on: day)
            update(id) { $0.setValue(value, on: day) }
            drafts[id] = nil
            return .logged
        }
        guard plan.isPlanned(day) else { return nil }
        if plan.status(on: day) == .done {
            update(id) { $0.setDay(nil, on: day) }
            return .cleared
        }
        update(id) { $0.setDay(.done, on: day) }
        return .completed
    }

    @discardableResult
    func toggleSkipped(_ id: UUID, on day: Day) -> Change? {
        guard let plan = plan(id) else { return nil }
        guard plan.isMetric || plan.isPlanned(day) else { return nil }
        if plan.status(on: day) == .skipped {
            update(id) { $0.setDay(nil, on: day) }
            return .cleared
        }
        update(id) { $0.setDay(.skipped, on: day) }
        return .skipped
    }

    /// Multi-column plans: the check button completes the next open column (AM, then PM).
    @discardableResult
    func advance(_ id: UUID, on day: Day) -> Change? {
        guard let plan = plan(id) else { return nil }
        let planned = plan.plannedColumns(on: day)
        if let next = planned.first(where: { plan.mark(on: day, column: $0) != .done }) {
            update(id) { $0.setMark(.done, on: day, column: next) }
            return self.plan(id)?.status(on: day) == .done ? .completed : .progressed
        }
        update(id) { $0.setDay(nil, on: day) }
        return .cleared
    }

    @discardableResult
    func toggleColumn(_ id: UUID, on day: Day, column: Int, mark: Mark = .done) -> Change? {
        guard let plan = plan(id), plan.plannedColumns(on: day).contains(column) else { return nil }
        if plan.mark(on: day, column: column) == mark {
            update(id) { $0.setMark(nil, on: day, column: column) }
            return .cleared
        }
        update(id) { $0.setMark(mark, on: day, column: column) }
        if mark == .skipped { return .skipped }
        return self.plan(id)?.status(on: day) == .done ? .completed : .progressed
    }

    /// Removes every mark and value from a day. Nil when there was nothing to clear.
    @discardableResult
    func clearDay(_ id: UUID, on day: Day) -> Change? {
        guard let plan = plan(id) else { return nil }
        guard !plan.record(on: day).isEmpty else { return nil }
        update(id) { plan in
            if plan.isMetric { plan.setValue(nil, on: day) }
            plan.setDay(nil, on: day)
        }
        if day == today { drafts[id] = nil }
        return .cleared
    }

    func setValue(_ id: UUID, on day: Day, value: Double?) {
        update(id) { $0.setValue(value, on: day) }
        if day == today { drafts[id] = nil }
    }

    // MARK: Metric drafts

    func draft(for plan: Plan, on day: Day) -> Double {
        if day == today, let draft = drafts[plan.id] { return draft }
        return plan.value(on: day) ?? plan.latestValue(onOrBefore: day) ?? Self.defaultValue(for: plan)
    }

    func setDraft(_ value: Double, for id: UUID) {
        drafts[id] = value
    }

    func hasDraftChange(_ plan: Plan) -> Bool {
        guard let draft = drafts[plan.id], let logged = plan.value(on: today) else { return false }
        return abs(draft - logged) > plan.step / 2
    }

    static func defaultValue(for plan: Plan) -> Double {
        switch plan.unit.lowercased() {
        case "lb", "lbs": 170
        case "kg": 75
        case "st": 12
        case "%": 20
        case "bpm": 60
        case "h", "hr", "hrs", "hours": 8
        case "min": 30
        case "steps": 8000
        case "kcal": 2000
        default: 0
        }
    }

    // MARK: Editing the sheet

    /// Writes one cell of a week. Editing a week that was repeating an earlier one gives it
    /// its own copy first, so the change carries forward from here, not backward.
    func setCell(_ id: UUID, week weekStart: Day, weekday: Int, column: Int, text: String) {
        update(id) { plan in
            var week = plan.resolvedWeek(weekStart).plan
            week.resize(columns: plan.columnCount)
            week.set(text, weekday: weekday, column: column)
            plan.weeks[weekStart.key] = week
        }
    }

    func copyPreviousWeek(_ id: UUID, into weekStart: Day) {
        update(id) { plan in
            var week = plan.resolvedWeek(weekStart.adding(-7)).plan
            week.resize(columns: plan.columnCount)
            plan.weeks[weekStart.key] = week
        }
    }

    func clearWeek(_ id: UUID, week weekStart: Day) {
        update(id) { plan in
            plan.weeks[weekStart.key] = WeekPlan(columns: plan.columnCount)
        }
    }

    /// Drops this week's own sheet so it repeats the previous one again.
    func revertWeek(_ id: UUID, week weekStart: Day) {
        update(id) { plan in
            plan.weeks[weekStart.key] = nil
        }
    }

    /// Copies one cell's text to every day of the week (habits).
    func fillWeek(_ id: UUID, week weekStart: Day, column: Int, text: String) {
        update(id) { plan in
            var week = plan.resolvedWeek(weekStart).plan
            week.resize(columns: plan.columnCount)
            for weekday in 0..<7 { week.set(text, weekday: weekday, column: column) }
            plan.weeks[weekStart.key] = week
        }
    }

    func setColumns(_ id: UUID, _ columns: [String]) {
        update(id) { plan in
            plan.columns = columns.isEmpty ? [""] : columns
            // Read the count before mutating: reading `plan` while writing `plan.weeks`
            // is an overlapping access.
            let count = plan.columnCount
            for key in Array(plan.weeks.keys) {
                plan.weeks[key]?.resize(columns: count)
            }
        }
    }

    func setOverride(_ id: UUID, on day: Day, items: [String]?) {
        update(id) { plan in
            plan.overrides[day.key] = items
        }
    }

    // MARK: Persistence

    private static var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("Cadence", isDirectory: true).appendingPathComponent("plans.json")
    }

    private struct Snapshot: Codable {
        var version = 1
        var plans: [Plan]
    }

    private func load() {
        let url = Self.fileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            plans = SeedData.plans(today: today)
            saveNow()
            return
        }
        do {
            let data = try Data(contentsOf: url)
            plans = try JSONDecoder().decode(Snapshot.self, from: data).plans
        } catch {
            // Never overwrite a file we couldn't read: set it aside, then start fresh.
            log.error("Could not read saved plans: \(error.localizedDescription, privacy: .public)")
            let backup = url.deletingPathExtension().appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.moveItem(at: url, to: backup)
            plans = SeedData.plans(today: today)
        }
    }

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    func saveNow() {
        saveTask?.cancel()
        do {
            let url = Self.fileURL
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Snapshot(plans: plans))
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            log.error("Could not save plans: \(error.localizedDescription, privacy: .public)")
        }
    }
}
