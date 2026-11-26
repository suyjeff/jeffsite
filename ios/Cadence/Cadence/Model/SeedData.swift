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
        switch template {
        case .schedule:
            var plan = Plan(name: "New schedule", kind: .routine)
            plan.weeks[today.weekStart.key] = WeekPlan(columns: 1)
            return plan
        case .scale:
            return Plan(name: "New scale", kind: .metric, unit: "", step: 1)
        case .streak:
            return Plan(name: "New streak", kind: .streak)
        }
    }
}

/// The three kinds of plan you can add. Training, skincare and habits are all schedules:
/// a week written like a sheet. What differs is only how a day is recorded.
enum PlanTemplate: String, CaseIterable, Identifiable {
    case schedule, scale, streak

    var id: String { rawValue }

    var title: String {
        switch self {
        case .schedule: "Schedule"
        case .scale: "Scale"
        case .streak: "Streak"
        }
    }

    var symbol: String {
        switch self {
        case .schedule: "tablecells"
        case .scale: "number"
        case .streak: "flame"
        }
    }
}

/// Icons a plan can wear: the set the app started with, plus more in the same style.
enum PlanIcons {
    /// What VoiceOver calls each icon.
    static func name(_ symbol: String) -> String {
        names[symbol] ?? symbol.replacingOccurrences(of: ".", with: " ")
    }

    private static let names = [
        "tablecells": "Sheet", "list.bullet": "List", "square.split.2x1": "Two columns", "number": "Number",
        "repeat": "Repeat", "flame": "Flame", "figure.run": "Running", "figure.walk": "Walking",
        "figure.strengthtraining.traditional": "Weights", "figure.yoga": "Yoga", "bicycle": "Cycling",
        "dumbbell": "Dumbbell", "drop": "Drop", "sparkles": "Sparkles", "sun.max": "Sun", "moon": "Moon",
        "bed.double": "Bed", "heart": "Heart", "book": "Book", "pencil": "Pencil", "brain.head.profile": "Mind",
        "leaf": "Leaf", "cup.and.saucer": "Cup", "fork.knife": "Meal", "pills": "Pills", "scalemass": "Scale",
        "timer": "Timer", "music.note": "Music", "paintbrush": "Paintbrush", "checkmark.seal": "Seal",
    ]

    static let all = [
        "tablecells", "list.bullet", "square.split.2x1", "number", "repeat", "flame",
        "figure.run", "figure.walk", "figure.strengthtraining.traditional", "figure.yoga", "bicycle", "dumbbell",
        "drop", "sparkles", "sun.max", "moon", "bed.double", "heart",
        "book", "pencil", "brain.head.profile", "leaf", "cup.and.saucer", "fork.knife",
        "pills", "scalemass", "timer", "music.note", "paintbrush", "checkmark.seal",
    ]
}
