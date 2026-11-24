import Foundation

extension Calendar {
    /// Gregorian, weeks start on Sunday (matching the SUN…SAT layout in the design),
    /// following the device's time zone and locale as they change.
    static let app: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 1
        calendar.timeZone = .autoupdatingCurrent
        calendar.locale = .autoupdatingCurrent
        return calendar
    }()
}

/// A calendar date with no time component. Everything in the app is keyed by `Day`,
/// so time zones and DST never shift a check mark onto the wrong row.
struct Day: Hashable, Comparable, Identifiable, Sendable {
    let year: Int
    let month: Int
    let day: Int

    init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    init(_ date: Date) {
        let parts = Calendar.app.dateComponents([.year, .month, .day], from: date)
        self.init(year: parts.year ?? 2000, month: parts.month ?? 1, day: parts.day ?? 1)
    }

    init?(key: String) {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        self.init(year: parts[0], month: parts[1], day: parts[2])
    }

    static var today: Day { Day(Date()) }

    var id: String { key }

    /// Stable storage key, e.g. "2026-11-24". Sorts chronologically as a string.
    var key: String {
        let y = String(year)
        let m = month < 10 ? "0\(month)" : "\(month)"
        let d = day < 10 ? "0\(day)" : "\(day)"
        return "\(y)-\(m)-\(d)"
    }

    /// Noon on this day, which keeps date arithmetic clear of DST edges.
    var date: Date {
        Calendar.app.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) ?? Date()
    }

    func adding(_ days: Int) -> Day {
        Day(Calendar.app.date(byAdding: .day, value: days, to: date) ?? date)
    }

    func addingMonths(_ months: Int) -> Day {
        Day(Calendar.app.date(byAdding: .month, value: months, to: monthStart.date) ?? date)
    }

    /// 0 = Sunday … 6 = Saturday.
    var weekdayIndex: Int { Calendar.app.component(.weekday, from: date) - 1 }

    var weekStart: Day { adding(-weekdayIndex) }
    var weekDays: [Day] { (0..<7).map { weekStart.adding($0) } }

    var monthStart: Day { Day(year: year, month: month, day: 1) }
    var daysInMonth: Int { Calendar.app.range(of: .day, in: .month, for: date)?.count ?? 30 }
    var monthDays: [Day] { (0..<daysInMonth).map { monthStart.adding($0) } }

    func days(until other: Day) -> Int {
        Calendar.app.dateComponents([.day], from: date, to: other.date).day ?? 0
    }

    static func < (lhs: Day, rhs: Day) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }
}

// MARK: - Display

enum DayText {
    /// "SUNDAY" … "SATURDAY", localized, Sunday first.
    static let weekdays: [String] = Calendar.app.weekdaySymbols.map { $0.uppercased() }
    /// "SUN" … "SAT"
    static let shortWeekdays: [String] = Calendar.app.shortWeekdaySymbols.map { $0.uppercased() }

    static func monthTitle(_ day: Day) -> String {
        day.date.formatted(.dateTime.month(.wide).year()).uppercased()
    }

    /// "NOV 23 – 29" or "NOV 30 – DEC 6"
    static func weekRange(_ weekStart: Day) -> String {
        let end = weekStart.adding(6)
        let start = weekStart.date.formatted(.dateTime.month(.abbreviated).day())
        let endText = end.month == weekStart.month
            ? end.date.formatted(.dateTime.day())
            : end.date.formatted(.dateTime.month(.abbreviated).day())
        return "\(start) – \(endText)".uppercased()
    }

    static func long(_ day: Day) -> String {
        day.date.formatted(.dateTime.weekday(.wide).month(.wide).day())
    }

    static func time(_ date: Date) -> String {
        date.formatted(.dateTime.hour().minute()).uppercased()
    }
}
