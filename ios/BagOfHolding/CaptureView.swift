import SwiftUI
import PhotosUI

struct CaptureView: View {
    @EnvironmentObject var model: CaptureModel
    @State private var showCamera = false
    @State private var showSettings = false
    @State private var photoItem: PhotosPickerItem?
    @FocusState private var textFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    talkButton
                        .padding(.top, 24)
                    statusLine
                    composer
                    if !model.recent.isEmpty { recentList }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(BagStyle.paper.ignoresSafeArea())
            .toolbarBackground(BagStyle.paper, for: .navigationBar)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 8) {
                        Image("BagMark").resizable().scaledToFit().frame(width: 26, height: 26)
                        Text("bag of holding").font(.system(.headline, design: .serif)).foregroundStyle(BagStyle.ink)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "key") }.foregroundStyle(BagStyle.muted)
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { img in
                    showCamera = false
                    if let img { model.pendingImage = img }
                }
                .ignoresSafeArea()
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { model.pendingImage = img }
                    photoItem = nil
                }
            }
            .onAppear { if !Settings.isConfigured { showSettings = true } }
        }
    }

    // MARK: hold to talk

    private var talkButton: some View {
        let recording = model.phase == .recording
        return ZStack {
            Circle()
                .fill(recording ? BagStyle.accentSoft : BagStyle.ink.opacity(0.05))
                .frame(width: 240, height: 240)
                .scaleEffect(recording ? 1 + CGFloat(model.level) * 0.25 : 1)
                .animation(.easeOut(duration: 0.08), value: model.level)
            Circle()
                .fill(recording ? BagStyle.accent : BagStyle.ink)
                .frame(width: 168, height: 168)
                .shadow(color: BagStyle.ink.opacity(recording ? 0 : 0.18), radius: 14, y: 8)
                .scaleEffect(recording ? 1.04 : 1)
                .animation(.spring(response: 0.25, dampingFraction: 0.7), value: recording)
            VStack(spacing: 6) {
                Image(systemName: recording ? "waveform" : "mic.fill")
                    .font(.system(size: 40, weight: .medium))
                    .symbolEffect(.variableColor.iterative, isActive: recording)
                Text(recording ? (model.autoRecording ? "tap to send" : "release to send") : "hold to talk")
                    .font(.footnote)
                    .opacity(0.8)
            }
            .foregroundStyle(BagStyle.paper)
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if model.phase != .recording && !model.autoRecording { Task { await model.startRecording() } }
                }
                .onEnded { value in
                    log.info("button released auto=\(model.autoRecording) phase=\(String(describing: model.phase), privacy: .public)")
                    if model.autoRecording {
                        Task { await model.stopAndSend() }
                    } else if model.phase == .recording {
                        // Slide well off the button to cancel instead of sending.
                        let d = hypot(value.translation.width, value.translation.height)
                        if d > 160 { model.cancelRecording() } else { Task { await model.stopAndSend() } }
                    }
                }
        )
        .accessibilityLabel("hold to talk")
    }

    private var statusLine: some View {
        Group {
            switch model.phase {
            case .idle:
                Text(model.pendingImage != nil ? "say or type something about the photo, or just send it" : " ")
            case .recording:
                Text(String(format: "%.0fs", model.elapsed))
                    .monospacedDigit()
            case .sending:
                Text("sending")
            case .sent:
                Text("in the bag").foregroundStyle(BagStyle.accent)
            case .failed(let m):
                Text(m).foregroundStyle(.red)
            }
        }
        .font(.system(.subheadline, design: .serif))
        .foregroundStyle(BagStyle.muted)
        .frame(minHeight: 20)
    }

    // MARK: type / photo

    private var composer: some View {
        VStack(spacing: 12) {
            if let img = model.pendingImage {
                HStack(spacing: 12) {
                    Image(uiImage: img)
                        .resizable().scaledToFill()
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Button("send photo") { model.sendPhotoAlone() }
                        .buttonStyle(.bordered)
                    Spacer()
                    Button { model.pendingImage = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                }
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField(model.pendingImage == nil ? "or type it" : "note about the photo", text: $model.text, axis: .vertical)
                    .lineLimit(1...5)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(BagStyle.card, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(BagStyle.line, lineWidth: 1))
                    .focused($textFocused)
                    .submitLabel(.send)
                    .onSubmit { model.sendText(); textFocused = false }
                Button { model.sendText(); textFocused = false } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 32)).foregroundStyle(BagStyle.accent)
                }
                .disabled(model.text.trimmingCharacters(in: .whitespaces).isEmpty && model.pendingImage == nil)
            }
            HStack(spacing: 18) {
                Button { showCamera = true } label: { Label("camera", systemImage: "camera") }
                PhotosPicker(selection: $photoItem, matching: .images) { Label("photo", systemImage: "photo.on.rectangle") }
                Spacer()
            }
            .font(.subheadline)
            .foregroundStyle(BagStyle.muted)
        }
    }

    // MARK: recent

    private var recentList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("recent").font(.system(.footnote, design: .serif)).foregroundStyle(BagStyle.muted)
            VStack(spacing: 0) {
                ForEach(Array(model.recent.enumerated()), id: \.element.id) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(item.kind.replacingOccurrences(of: "_", with: " "))
                            .font(.caption).foregroundStyle(BagStyle.accent)
                            .frame(width: 84, alignment: .leading)
                        Text(item.title ?? "")
                            .font(.subheadline).lineLimit(2).foregroundStyle(BagStyle.ink)
                        Spacer()
                        if item.status != "resolved" {
                            Text(item.status.replacingOccurrences(of: "_", with: " "))
                                .font(.caption2)
                                .foregroundStyle(item.status == "failed" ? .red : BagStyle.muted)
                        }
                    }
                    .padding(.vertical, 10).padding(.horizontal, 14)
                    if index < model.recent.count - 1 { Divider().overlay(BagStyle.line).padding(.leading, 14) }
                }
            }
            .background(BagStyle.card, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(BagStyle.line, lineWidth: 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .refreshable { await model.loadRecent() }
    }
}

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var server = Settings.server
    @State private var key = Settings.key

    var body: some View {
        NavigationStack {
            Form {
                Section("server") {
                    TextField("url", text: $server)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                }
                Section("key") {
                    SecureField("bag key", text: $key)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    Link("browse the bag", destination: URL(string: "https://bensonperry.com/bagofholding")!)
                }
            }
            .scrollContentBackground(.hidden)
            .background(BagStyle.paper)
            .navigationTitle("settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("done") {
                        Settings.server = server.trimmingCharacters(in: .whitespacesAndNewlines)
                        Settings.key = key.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task { await CaptureModel.shared.loadRecent() }
                        dismiss()
                    }
                }
            }
        }
    }
}
