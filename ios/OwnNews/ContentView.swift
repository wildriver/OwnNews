import SwiftUI
import WebKit
import SafariServices
import AuthenticationServices
import CryptoKit

private let APP_HOST = "ownnews-web.pages.dev"
/// 起動時に開くURL。スクリーンショット撮影用に起動引数 -initialPath /welcome 等で上書きできる
private let APP_URL: URL = {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: "-initialPath"), i + 1 < args.count {
        return URL(string: "https://\(APP_HOST)\(args[i + 1])")!
    }
    return URL(string: "https://\(APP_HOST)/")!
}()

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea(edges: .bottom)
    }
}

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // ログイン状態などを保持する永続ストア
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        // UAに識別子を付与し、Web側が「ネイティブアプリ内」を検出できるようにする
        // （PWAインストール案内の非表示などに使う）
        config.applicationNameForUserAgent = "OwnNewsApp/1.0"
        // Web側から Sign in with Apple を起動するブリッジ
        // （ログインページが window.webkit.messageHandlers.appleSignIn.postMessage({}) を呼ぶ）
        config.userContentController.add(context.coordinator, name: "appleSignIn")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic

        // 引っ張って更新
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        context.coordinator.webView = webView
        webView.load(URLRequest(url: APP_URL))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
                             WKScriptMessageHandler,
                             ASAuthorizationControllerDelegate,
                             ASAuthorizationControllerPresentationContextProviding {
        weak var webView: WKWebView?
        private var observer: NSObjectProtocol?
        /// Sign in with Apple のリプレイ攻撃対策nonce（生値）。ハッシュをAppleへ、生値をSupabaseへ渡す
        private var appleNonce: String?

        override init() {
            super.init()
            // 通知タップからのURLオープン
            observer = NotificationCenter.default.addObserver(
                forName: .openURLInWebView, object: nil, queue: .main
            ) { [weak self] note in
                if let url = note.object as? URL {
                    self?.webView?.load(URLRequest(url: url))
                }
            }
        }

        deinit {
            if let observer { NotificationCenter.default.removeObserver(observer) }
        }

        @objc func reload(_ sender: UIRefreshControl) {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                sender.endRefreshing()
            }
        }

        // アプリ外のリンク（ニュース記事など）はアプリ内Safariで開く
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url,
                  navigationAction.navigationType == .linkActivated else {
                decisionHandler(.allow)
                return
            }
            if url.host != APP_HOST, url.scheme?.hasPrefix("http") == true {
                presentSafari(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // target=_blank も同様にアプリ内Safariへ
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url, url.scheme?.hasPrefix("http") == true {
                if url.host == APP_HOST {
                    webView.load(URLRequest(url: url))
                } else {
                    presentSafari(url)
                }
            }
            return nil
        }

        private func presentSafari(_ url: URL) {
            guard let root = UIApplication.shared.connectedScenes
                .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
                .first?.rootViewController else { return }
            let safari = SFSafariViewController(url: url)
            root.present(safari, animated: true)
        }

        // ---- Sign in with Apple（Webからのブリッジ） ----

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "appleSignIn" else { return }
            startAppleSignIn()
        }

        private func startAppleSignIn() {
            let nonce = Self.randomNonce()
            appleNonce = nonce
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = Self.sha256(nonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }

        func authorizationController(controller: ASAuthorizationController,
                                     didCompleteWithAuthorization authorization: ASAuthorization) {
            guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = cred.identityToken,
                  let token = String(data: tokenData, encoding: .utf8),
                  let nonce = appleNonce,
                  let payload = try? JSONSerialization.data(withJSONObject: ["token": token, "nonce": nonce]),
                  let json = String(data: payload, encoding: .utf8) else {
                webView?.evaluateJavaScript("window.__onAppleSignInError && window.__onAppleSignInError()")
                return
            }
            // Web側(supabase-js)が signInWithIdToken でセッションを確立する
            webView?.evaluateJavaScript("window.__onAppleSignIn && window.__onAppleSignIn(\(json))")
        }

        func authorizationController(controller: ASAuthorizationController,
                                     didCompleteWithError error: Error) {
            // ユーザーによるキャンセルはエラー扱いにしない
            if let e = error as? ASAuthorizationError, e.code == .canceled { return }
            webView?.evaluateJavaScript("window.__onAppleSignInError && window.__onAppleSignInError()")
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            webView?.window ?? ASPresentationAnchor()
        }

        /// 英数字のランダムnonce（Firebase/Supabaseのサンプル実装に準拠）
        private static func randomNonce(length: Int = 32) -> String {
            let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
            var result = ""
            while result.count < length {
                var random: UInt8 = 0
                guard SecRandomCopyBytes(kSecRandomDefault, 1, &random) == errSecSuccess else { continue }
                if random < charset.count {
                    result.append(charset[Int(random)])
                }
            }
            return result
        }

        private static func sha256(_ input: String) -> String {
            SHA256.hash(data: Data(input.utf8))
                .map { String(format: "%02x", $0) }
                .joined()
        }
    }
}
