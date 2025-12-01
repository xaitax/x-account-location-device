import WidgetKit
import SwiftUI

// MARK: - Data Models

struct LookupEntry: Codable, Identifiable {
    var id: String { username }
    let username: String
    let location: String
    let device: String?
    let timestamp: Double
    let isAccurate: Bool
    
    var flagEmoji: String {
        // Convert location to flag emoji
        let countryFlags: [String: String] = [
            "united states": "🇺🇸",
            "united kingdom": "🇬🇧",
            "germany": "🇩🇪",
            "france": "🇫🇷",
            "japan": "🇯🇵",
            "china": "🇨🇳",
            "india": "🇮🇳",
            "brazil": "🇧🇷",
            "canada": "🇨🇦",
            "australia": "🇦🇺",
            "russia": "🇷🇺",
            "spain": "🇪🇸",
            "italy": "🇮🇹",
            "netherlands": "🇳🇱",
            "poland": "🇵🇱",
            "sweden": "🇸🇪",
            "norway": "🇳🇴",
            "denmark": "🇩🇰",
            "finland": "🇫🇮",
            "switzerland": "🇨🇭",
            "austria": "🇦🇹",
            "belgium": "🇧🇪",
            "portugal": "🇵🇹",
            "ireland": "🇮🇪",
            "mexico": "🇲🇽",
            "argentina": "🇦🇷",
            "south korea": "🇰🇷",
            "singapore": "🇸🇬",
            "uae": "🇦🇪",
            "united arab emirates": "🇦🇪",
            "turkey": "🇹🇷",
            "israel": "🇮🇱",
            "south africa": "🇿🇦",
            "new zealand": "🇳🇿",
            "ukraine": "🇺🇦",
            "thailand": "🇹🇭",
            "vietnam": "🇻🇳",
            "indonesia": "🇮🇩",
            "philippines": "🇵🇭",
            "malaysia": "🇲🇾",
        ]
        
        let locationLower = location.lowercased()
        for (country, flag) in countryFlags {
            if locationLower.contains(country) {
                return flag
            }
        }
        
        // Check for country codes
        if locationLower.count == 2 {
            let base: UInt32 = 127397
            let chars = locationLower.uppercased().unicodeScalars.map { String(UnicodeScalar(base + $0.value)!) }
            if chars.count == 2 {
                return chars.joined()
            }
        }
        
        return "🌍"
    }
    
    var deviceEmoji: String {
        guard let device = device?.lowercased() else { return "" }
        if device.contains("iphone") || device.contains("ios") || device.contains("app store") {
            return "📱"
        } else if device.contains("android") {
            return "🤖"
        } else if device.contains("mac") || device.contains("windows") || device.contains("web") {
            return "💻"
        }
        return "📱"
    }
    
    var timeAgo: String {
        let date = Date(timeIntervalSince1970: timestamp / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct WidgetData: Codable {
    let entries: [LookupEntry]
    let lastUpdated: Double
}

// MARK: - Timeline Provider

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), data: sampleData)
    }
    
    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
        let entry = SimpleEntry(date: Date(), data: loadData())
        completion(entry)
    }
    
    func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
        let data = loadData()
        let entry = SimpleEntry(date: Date(), data: data)
        
        // Refresh every 15 minutes
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
    
    private func loadData() -> WidgetData {
        guard let sharedDefaults = UserDefaults(suiteName: "group.com.xposed.mobile.shared"),
              let jsonData = sharedDefaults.data(forKey: "widgetData"),
              let data = try? JSONDecoder().decode(WidgetData.self, from: jsonData) else {
            return sampleData
        }
        return data
    }
    
    private var sampleData: WidgetData {
        WidgetData(entries: [
            LookupEntry(username: "example", location: "United States", device: "iPhone", timestamp: Date().timeIntervalSince1970 * 1000, isAccurate: true)
        ], lastUpdated: Date().timeIntervalSince1970 * 1000)
    }
}

// MARK: - Widget Entry

struct SimpleEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
}

// MARK: - Widget Views

struct SmallWidgetView: View {
    let entry: SimpleEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "globe.americas.fill")
                    .foregroundColor(.cyan)
                Text("X-Posed")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                Spacer()
            }
            
            Spacer()
            
            if let latest = entry.data.entries.first {
                // Username
                Text("@\(latest.username)")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                
                // Location with flag
                HStack(spacing: 4) {
                    Text(latest.flagEmoji)
                        .font(.system(size: 20))
                    Text(latest.location)
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                        .lineLimit(1)
                }
                
                // Time ago
                Text(latest.timeAgo)
                    .font(.system(size: 9))
                    .foregroundColor(.cyan.opacity(0.7))
            } else {
                Text("No lookups yet")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
                Text("Tap to search")
                    .font(.system(size: 10))
                    .foregroundColor(.cyan)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color(red: 0.04, green: 0.05, blue: 0.08), Color(red: 0.02, green: 0.03, blue: 0.05)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .widgetURL(URL(string: "xposed://lookup"))
    }
}

struct MediumWidgetView: View {
    let entry: SimpleEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "globe.americas.fill")
                    .foregroundColor(.cyan)
                Text("X-Posed")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
                Spacer()
                Text("Recent")
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }
            .padding(.bottom, 4)
            
            if entry.data.entries.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 4) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 24))
                            .foregroundColor(.cyan.opacity(0.5))
                        Text("No lookups yet")
                            .font(.system(size: 12))
                            .foregroundColor(.gray)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                // Show up to 3 entries
                ForEach(entry.data.entries.prefix(3)) { lookup in
                    Link(destination: URL(string: "xposed://lookup/\(lookup.username)")!) {
                        HStack(spacing: 8) {
                            Text(lookup.flagEmoji)
                                .font(.system(size: 18))
                            
                            VStack(alignment: .leading, spacing: 2) {
                                Text("@\(lookup.username)")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundColor(.white)
                                    .lineLimit(1)
                                
                                Text(lookup.location)
                                    .font(.system(size: 10))
                                    .foregroundColor(.gray)
                                    .lineLimit(1)
                            }
                            
                            Spacer()
                            
                            VStack(alignment: .trailing, spacing: 2) {
                                if !lookup.isAccurate {
                                    Image(systemName: "shield.fill")
                                        .font(.system(size: 10))
                                        .foregroundColor(.orange)
                                }
                                Text(lookup.timeAgo)
                                    .font(.system(size: 9))
                                    .foregroundColor(.cyan.opacity(0.7))
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                
                Spacer()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color(red: 0.04, green: 0.05, blue: 0.08), Color(red: 0.02, green: 0.03, blue: 0.05)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .widgetURL(URL(string: "xposed://lookup"))
    }
}

struct LargeWidgetView: View {
    let entry: SimpleEntry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Image(systemName: "globe.americas.fill")
                    .foregroundColor(.cyan)
                    .font(.system(size: 18))
                Text("X-Posed")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(.white)
                Spacer()
                Text("Location Intelligence")
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }
            .padding(.bottom, 8)
            
            if entry.data.entries.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 8) {
                        Image(systemName: "magnifyingglass.circle.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.cyan.opacity(0.5))
                        Text("No lookups yet")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                        Text("Open X-Posed to search users")
                            .font(.system(size: 12))
                            .foregroundColor(.cyan)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                // Show up to 6 entries
                ForEach(entry.data.entries.prefix(6)) { lookup in
                    Link(destination: URL(string: "xposed://lookup/\(lookup.username)")!) {
                        HStack(spacing: 12) {
                            // Flag
                            ZStack {
                                Circle()
                                    .fill(Color.white.opacity(0.1))
                                    .frame(width: 36, height: 36)
                                Text(lookup.flagEmoji)
                                    .font(.system(size: 20))
                            }
                            
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text("@\(lookup.username)")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                    
                                    if !lookup.isAccurate {
                                        Image(systemName: "shield.fill")
                                            .font(.system(size: 10))
                                            .foregroundColor(.orange)
                                    }
                                }
                                
                                HStack(spacing: 4) {
                                    Text(lookup.location)
                                        .font(.system(size: 11))
                                        .foregroundColor(.gray)
                                        .lineLimit(1)
                                    
                                    if let _ = lookup.device {
                                        Text("•")
                                            .foregroundColor(.gray)
                                        Text(lookup.deviceEmoji)
                                            .font(.system(size: 11))
                                    }
                                }
                            }
                            
                            Spacer()
                            
                            Text(lookup.timeAgo)
                                .font(.system(size: 10))
                                .foregroundColor(.cyan.opacity(0.7))
                        }
                        .padding(.vertical, 6)
                    }
                    
                    if lookup.id != entry.data.entries.prefix(6).last?.id {
                        Divider()
                            .background(Color.white.opacity(0.1))
                    }
                }
                
                Spacer()
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [Color(red: 0.04, green: 0.05, blue: 0.08), Color(red: 0.02, green: 0.03, blue: 0.05)],
                startPoint: .top,
                endPoint: .bottom
            )
        )
        .widgetURL(URL(string: "xposed://lookup"))
    }
}

// MARK: - Widget Entry View

struct XPosedWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var widgetFamily
    
    var body: some View {
        switch widgetFamily {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}

// MARK: - Widget Definition

@main
struct XPosedWidget: Widget {
    let kind: String = "XPosedWidget"
    
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            XPosedWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("X-Posed")
        .description("Quick access to location lookups")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}

// MARK: - Preview

#Preview(as: .systemSmall) {
    XPosedWidget()
} timeline: {
    SimpleEntry(date: Date(), data: WidgetData(entries: [
        LookupEntry(username: "elonmusk", location: "United States", device: "iPhone", timestamp: Date().timeIntervalSince1970 * 1000, isAccurate: true)
    ], lastUpdated: Date().timeIntervalSince1970 * 1000))
}

#Preview(as: .systemMedium) {
    XPosedWidget()
} timeline: {
    SimpleEntry(date: Date(), data: WidgetData(entries: [
        LookupEntry(username: "elonmusk", location: "United States", device: "iPhone", timestamp: Date().timeIntervalSince1970 * 1000, isAccurate: true),
        LookupEntry(username: "xaitax", location: "Germany", device: "Web", timestamp: Date().timeIntervalSince1970 * 1000 - 3600000, isAccurate: false),
        LookupEntry(username: "jack", location: "United States", device: "iPhone", timestamp: Date().timeIntervalSince1970 * 1000 - 7200000, isAccurate: true)
    ], lastUpdated: Date().timeIntervalSince1970 * 1000))
}