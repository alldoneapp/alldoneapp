import UIKit
import UniformTypeIdentifiers

private enum ShareStorage {
    static let appGroup = "group.app.alldone.ios"
    static let token = "iosShare.token"
    static let endpointUrl = "iosShare.endpointUrl"
}

final class ShareViewController: UIViewController, UITextViewDelegate {
    private let textView = UITextView()
    private let addButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let statusLabel = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    private let requestId = UUID().uuidString

    private var credential: (token: String, endpoint: URL)?
    private var isSubmitting = false

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        loadCredential()
        loadSharedContent()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        textView.becomeFirstResponder()
    }

    private func configureView() {
        view.backgroundColor = .systemGroupedBackground

        let titleLabel = UILabel()
        titleLabel.text = "Add task"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.textAlignment = .center

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        addButton.setTitle("Add", for: .normal)
        addButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        addButton.addTarget(self, action: #selector(submit), for: .touchUpInside)

        let header = UIView()
        [cancelButton, titleLabel, addButton].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            header.addSubview($0)
        }

        textView.backgroundColor = .secondarySystemGroupedBackground
        textView.layer.cornerRadius = 12
        textView.font = .preferredFont(forTextStyle: .body)
        textView.delegate = self
        textView.autocapitalizationType = .sentences
        textView.returnKeyType = .done
        textView.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)

        statusLabel.font = .preferredFont(forTextStyle: .footnote)
        statusLabel.textColor = .secondaryLabel
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center

        let statusRow = UIStackView(arrangedSubviews: [activityIndicator, statusLabel])
        statusRow.axis = .horizontal
        statusRow.alignment = .center
        statusRow.spacing = 8

        let stack = UIStackView(arrangedSubviews: [header, textView, statusRow])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            header.heightAnchor.constraint(equalToConstant: 44),
            cancelButton.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            cancelButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            addButton.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            addButton.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            titleLabel.centerXAnchor.constraint(equalTo: header.centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            textView.heightAnchor.constraint(greaterThanOrEqualToConstant: 132),
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
        updateSubmitState()
    }

    private func loadCredential() {
        guard let defaults = UserDefaults(suiteName: ShareStorage.appGroup),
              let token = defaults.string(forKey: ShareStorage.token), !token.isEmpty,
              let endpointValue = defaults.string(forKey: ShareStorage.endpointUrl),
              let endpoint = URL(string: endpointValue) else {
            statusLabel.text = "Open Alldone once while signed in to enable sharing."
            updateSubmitState()
            return
        }
        credential = (token, endpoint)
        statusLabel.text = "The task will be assigned to a project automatically."
        updateSubmitState()
    }

    private func loadSharedContent() {
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let fallbackText = items.compactMap { $0.attributedContentText?.string }.first(where: { !$0.isEmpty })

        let group = DispatchGroup()
        let lock = NSLock()
        var sharedUrl: String?
        var sharedText: String?

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                    let value = (item as? URL)?.absoluteString ?? (item as? NSURL)?.absoluteString
                    if let value, !value.isEmpty {
                        lock.lock()
                        if sharedUrl == nil { sharedUrl = value }
                        lock.unlock()
                    }
                    group.leave()
                }
            }
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                    let value = (item as? String) ?? (item as? NSAttributedString)?.string
                    if let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        lock.lock()
                        if sharedText == nil { sharedText = value }
                        lock.unlock()
                    }
                    group.leave()
                }
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            self.textView.text = sharedUrl ?? sharedText ?? fallbackText ?? ""
            self.textView.selectedRange = NSRange(location: self.textView.text.count, length: 0)
            self.updateSubmitState()
        }
    }

    private func updateSubmitState() {
        let hasText = !textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        addButton.isEnabled = credential != nil && hasText && !isSubmitting
        cancelButton.isEnabled = !isSubmitting
        textView.isEditable = !isSubmitting
    }

    func textViewDidChange(_ textView: UITextView) {
        updateSubmitState()
    }

    func textView(
        _ textView: UITextView,
        shouldChangeTextIn range: NSRange,
        replacementText text: String
    ) -> Bool {
        if text == "\n" {
            submit()
            return false
        }
        let current = textView.text as NSString
        return current.replacingCharacters(in: range, with: text).count <= 500
    }

    @objc private func cancel() {
        extensionContext?.cancelRequest(withError: NSError(
            domain: "app.alldone.ios.ShareExtension",
            code: NSUserCancelledError
        ))
    }

    @objc private func submit() {
        guard !isSubmitting,
              let credential,
              let taskName = textView.text?.trimmingCharacters(in: .whitespacesAndNewlines),
              !taskName.isEmpty else { return }

        isSubmitting = true
        statusLabel.text = "Adding task…"
        activityIndicator.startAnimating()
        updateSubmitState()

        var request = URLRequest(url: credential.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "token": credential.token,
            "taskName": taskName,
            "requestId": requestId
        ])

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.handleResponse(data: data, response: response, error: error)
            }
        }.resume()
    }

    private func handleResponse(data: Data?, response: URLResponse?, error: Error?) {
        activityIndicator.stopAnimating()
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        let payload = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }

        if statusCode == 200, payload?["success"] as? Bool == true {
            statusLabel.text = "Task added"
            extensionContext?.completeRequest(returningItems: nil)
            return
        }

        isSubmitting = false
        if statusCode == 401 {
            statusLabel.text = "Open Alldone while signed in to reconnect sharing."
        } else if let message = payload?["error"] as? String, !message.isEmpty {
            statusLabel.text = message
        } else if error != nil {
            statusLabel.text = "Could not connect. Check your internet connection and try again."
        } else {
            statusLabel.text = "Could not add the task. Please try again."
        }
        updateSubmitState()
    }
}
