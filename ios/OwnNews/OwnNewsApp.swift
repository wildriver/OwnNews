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
            ContentView()
                .ignoresSafeArea()
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // 通知許可はWebの購読ボタンからではなくアプリ起動時に求める
        // （箱アプリなのでネイティブUIは持たない方針）
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
        return true
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
