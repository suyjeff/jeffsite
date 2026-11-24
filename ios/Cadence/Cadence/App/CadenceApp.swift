import SwiftUI

@main
struct CadenceApp: App {
    @State private var store = Store()

    init() {
        Prefs.registerDefaults()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}
