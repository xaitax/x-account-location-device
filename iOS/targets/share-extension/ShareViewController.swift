import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

/**
 * X-Posed Share Extension
 * 
 * Appears in the iOS share sheet when users share content.
 * Extracts usernames from X/Twitter URLs and opens the main app.
 */
class ShareViewController: UIViewController {
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Set up a simple loading view
        view.backgroundColor = UIColor(red: 10/255, green: 14/255, blue: 20/255, alpha: 1)
        
        let activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.color = UIColor(red: 0, green: 212/255, blue: 1, alpha: 1)
        activityIndicator.center = view.center
        activityIndicator.startAnimating()
        view.addSubview(activityIndicator)
        
        // Process shared content
        handleSharedContent()
    }
    
    private func handleSharedContent() {
        guard let extensionContext = extensionContext,
              let inputItems = extensionContext.inputItems as? [NSExtensionItem] else {
            completeWithError()
            return
        }
        
        // Look for URL in shared content
        for item in inputItems {
            guard let attachments = item.attachments else { continue }
            
            for attachment in attachments {
                // Handle URLs
                if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    attachment.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] (item, error) in
                        if let url = item as? URL {
                            self?.processURL(url)
                        } else {
                            self?.completeWithError()
                        }
                    }
                    return
                }
                
                // Handle plain text (might be a URL string)
                if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] (item, error) in
                        if let text = item as? String, let url = URL(string: text) {
                            self?.processURL(url)
                        } else if let text = item as? String {
                            // Maybe it's just a username
                            self?.processUsername(text)
                        } else {
                            self?.completeWithError()
                        }
                    }
                    return
                }
            }
        }
        
        completeWithError()
    }
    
    private func processURL(_ url: URL) {
        let urlString = url.absoluteString.lowercased()
        
        // Check if it's an X or Twitter profile URL
        let patterns = [
            "x\\.com/([a-zA-Z0-9_]+)",
            "twitter\\.com/([a-zA-Z0-9_]+)",
            "mobile\\.x\\.com/([a-zA-Z0-9_]+)",
            "mobile\\.twitter\\.com/([a-zA-Z0-9_]+)"
        ]
        
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                let range = NSRange(urlString.startIndex..., in: urlString)
                if let match = regex.firstMatch(in: urlString, options: [], range: range) {
                    if let usernameRange = Range(match.range(at: 1), in: urlString) {
                        let username = String(urlString[usernameRange])
                        // Filter out common paths that aren't usernames
                        let invalidPaths = ["home", "explore", "notifications", "messages", "search", "settings", "i", "login", "signup", "compose"]
                        if !invalidPaths.contains(username.lowercased()) {
                            openMainApp(with: username)
                            return
                        }
                    }
                }
            }
        }
        
        // Not a profile URL
        completeWithError()
    }
    
    private func processUsername(_ text: String) {
        var username = text.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // Remove @ prefix if present
        if username.hasPrefix("@") {
            username = String(username.dropFirst())
        }
        
        // Validate username format
        let usernameRegex = "^[a-zA-Z0-9_]{1,15}$"
        if let regex = try? NSRegularExpression(pattern: usernameRegex) {
            let range = NSRange(username.startIndex..., in: username)
            if regex.firstMatch(in: username, options: [], range: range) != nil {
                openMainApp(with: username.lowercased())
                return
            }
        }
        
        completeWithError()
    }
    
    private func openMainApp(with username: String) {
        // Store username in shared container for the main app to pick up
        if let userDefaults = UserDefaults(suiteName: "group.com.xposed.mobile.shared") {
            userDefaults.set(username, forKey: "pendingLookupUsername")
            userDefaults.synchronize()
        }
        
        // Open the main app via custom URL scheme
        let urlString = "xposed://lookup/\(username)"
        if let url = URL(string: urlString) {
            // Use openURL to launch the main app
            var responder: UIResponder? = self
            while responder != nil {
                if let application = responder as? UIApplication {
                    application.open(url, options: [:], completionHandler: nil)
                    break
                }
                responder = responder?.next
            }
            
            // Also try the selector method (works in extensions)
            let selector = NSSelectorFromString("openURL:")
            responder = self
            while responder != nil {
                if responder!.responds(to: selector) {
                    responder!.perform(selector, with: url)
                    break
                }
                responder = responder?.next
            }
        }
        
        // Complete the extension
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
    
    private func completeWithError() {
        DispatchQueue.main.async { [weak self] in
            let alert = UIAlertController(
                title: "Invalid Content",
                message: "Please share an X profile URL or username.",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self?.extensionContext?.cancelRequest(withError: NSError(domain: "com.xposed.share", code: 1, userInfo: nil))
            })
            self?.present(alert, animated: true)
        }
    }
}