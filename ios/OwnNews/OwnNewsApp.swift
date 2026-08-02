import SwiftUI
import UserNotifications

// OwnNews iOSラッパー。
// Webアプリ（ownnews-web.pages.dev）をWKWebViewで表示し、
// プッシュ通知だけネイティブ（APNs）で受ける。
// Web Push(VAPID)はWKWebViewでは動かないため、通知経路はAPNs一本に寄せる。

@main
struct OwnNewsApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            // 上部セーフエリアは尊重する（Webページの固定ヘッダーが
            // ステータスバー/Dynamic Islandと重ならないように）。下はWebView側で処理
            ContentView()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // スクリーンショット撮影時は許可ダイアログを出さない（simctl launch ... -uiScreenshots）
        if CommandLine.arguments.contains("-uiScreenshots") { return true }
        // 通知許可はWebの購読ボタンからではなくアプリ起動時に求める
        // （箱アプリなのでネイティブUIは持たない方針）
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
                Self.scheduleDailyNotifications()
            }
        }
        return true
    }

    /// 毎日の定時通知（ローカル通知）。サーバ不要で「ニュースを読むきっかけ」を作る。
    /// 動的な内容（見落としニュース等）を送りたくなったらAPNsリモートPushに置き換える。
    static func scheduleDailyNotifications() {
        let slots: [(hour: Int, title: String, body: String)] = [
            (8,  "朝のニュース", "おはようございます。今朝の世の中の動きをチェックしましょう"),
            (12, "昼のニュース", "昼休みのひとときに、午前中のニュースをどうぞ"),
            (15, "午後のニュース", "午後のニュースが届いています。少し息抜きしませんか"),
            (18, "夕方のニュース", "今日の主要ニュースを夕方のうちにおさらいしましょう"),
            (22, "夜のニュース", "一日の締めくくりに、今日のニュースを振り返りましょう"),
        ]
        let center = UNUserNotificationCenter.current()
        // 再起動のたびに予約し直す（重複防止のため既存の予約を全消しして入れ直す）
        center.removeAllPendingNotificationRequests()
        for slot in slots {
            let content = UNMutableNotificationContent()
            content.title = slot.title
            content.body = slot.body
            content.sound = .default
            content.userInfo = ["url": "https://ownnews-web.pages.dev/"]

            var date = DateComponents()
            date.hour = slot.hour
            date.minute = 0
            let trigger = UNCalendarNotificationTrigger(dateMatching: date, repeats: true)
            let request = UNNotificationRequest(
                identifier: "daily-news-\(slot.hour)",
                content: content,
                trigger: trigger
            )
            center.add(request)
        }
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        print("APNs device token: \(token)")
        // TODO: サーバ側のAPNs送信基盤ができたら、このトークンを
        // Supabaseのdevice_tokensテーブルにPOSTする
        TokenStore.shared.latestToken = token
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs registration failed: \(error)")
    }

    // フォアグラウンド受信時もバナーを出す
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    // 通知タップでURLが指定されていればWebViewで開く
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if let urlString = userInfo["url"] as? String, let url = URL(string: urlString) {
            NotificationCenter.default.post(name: .openURLInWebView, object: url)
        }
        completionHandler()
    }
}

/// APNsトークンの一時保管（サーバ送信配線までのつなぎ）
final class TokenStore {
    static let shared = TokenStore()
    var latestToken: String?
}

extension Notification.Name {
    static let openURLInWebView = Notification.Name("openURLInWebView")
}
