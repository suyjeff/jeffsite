import Foundation

/// First-launch content, taken from the plans in the design so the app opens looking like the mocks.
enum SeedData {
    static func plans(today: Day = .today) -> [Plan] {
        // Start the sheets a few weeks back so recent history has something to show.
        let start = today.weekStart.adding(-21)
        return [training(start), skincare(start), habits(start), weight(today)]
    }

    static func training(_ start: Day) -> Plan {
        var plan = Plan(name: "Training", kind: .routine)
        let days = ["REST", "Run - 5mi Easy", "Strength - A", "Strength - B", "Run - 10K Steady", "Strength - A", "Strength - B"]
        plan.weeks[start.key] = WeekPlan(cells: days.map { [$0] })
        return plan
    }

    static func skincare(_ start: Day) -> Plan {
        var plan = Plan(name: "Skincare", kind: .routine, columns: ["AM", "PM"])
        let morning = "Cleanser, Vitamin C Serum, Moisturizer, Sunscreen"
        let retinol = "Cleanser, Retinol, Moisturizer, Snail Mucin"
        let azelaic = "Cleanser, Toner, Azelaic Acid, Moisturizer, Snail Mucin"
        let evenings = [retinol, azelaic, retinol, azelaic, retinol, azelaic, retinol]
        plan.weeks[start.key] = WeekPlan(cells: evenings.map { [morning, $0] })
        return plan
    }

    static func habits(_ start: Day) -> Plan {
        var plan = Plan(name: "Habits", kind: .routine)
        plan.weeks[start.key] = WeekPlan(cells: Array(repeating: ["Read 20 pages, phone out of the bedroom"], count: 7))
        return plan
    }

    static func weight(_ today: Day) -> Plan {
        Plan(name: "Weight", kind: .metric, unit: "lb", step: 0.1)
    }

    static func template(_ template: PlanTemplate, today: Day = .today) -> Plan {
        let start = today.weekStart
        switch template {
        case .training:
            var plan = Plan(name: "Training", kind: .routine)
            plan.weeks[start.key] = WeekPlan(columns: 1)
            return plan
        case .skincare:
            var plan = Plan(name: "Skincare", kind: .routine, columns: ["AM", "PM"])
            plan.weeks[start.key] = WeekPlan(columns: 2)
            return plan
        case .habit:
            var plan = Plan(name: "New habit", kind: .routine)
            plan.weeks[start.key] = WeekPlan(columns: 1)
            return plan
        case .number:
            return Plan(name: "Weight", kind: .metric, unit: "lb", step: 0.1)
        case .blank:
            var plan = Plan(name: "Untitled", kind: .routine)
            plan.weeks[start.key] = WeekPlan(columns: 1)
            return plan
        }
    }
}

enum PlanTemplate: String, CaseIterable, Identifiable {
    case training, skincare, habit, number, blank

    var id: String { rawValue }

    var title: String {
        switch self {
        case .training: "Training"
        case .skincare: "Skincare"
        case .habit: "Habit"
        case .number: "Daily number"
        case .blank: "Blank sheet"
        }
    }

    var detail: String {
        switch self {
        case .training: "A different session each day of the week"
        case .skincare: "Morning and evening columns"
        case .habit: "The same thing, every day"
        case .number: "Log one value a day, like weight"
        case .blank: "Start from an empty week"
        }
    }

    var symbol: String {
        switch self {
        case .training: "figure.run"
        case .skincare: "drop"
        case .habit: "repeat"
        case .number: "number"
        case .blank: "tablecells"
        }
    }
}
