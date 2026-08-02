import SwiftUI
import WebKit
import SafariServices

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

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        private var observer: NSObjectProtocol?

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
    }
}
