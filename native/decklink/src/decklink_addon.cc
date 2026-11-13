// Reach Presenter — Blackmagic DeckLink SDI output (node-addon-api).
//
// *** UNVERIFIED ***  Written against the documented DeckLink API (Desktop Video SDK 12.x–14.x) without the SDK
// headers or any hardware. It has never been compiled. Build it on the Mac (docs/decklink.md) and expect to fix
// small API drift (see the notes marked "SDK-VERSION" below).
//
// JS API (wrapped by src/main/services/outputs/decklink.ts):
//   driverVersion()  -> string | null            null = Desktop Video is not installed
//   apiVersion       -> string                   SDK version this addon was compiled against
//   listDevices()    -> Promise<Device[]>        rejects { code: 'NO_DRIVER' } without Desktop Video
//   open({ device, displayName?, mode, keying, keyLevel, align }) -> Promise<Handle>
//                       rejects { code: 'BUSY' | 'NO_DEVICE' | 'NO_MODE' | 'NO_KEYING' | 'NO_DRIVER' | 'FAILED' }
//   handle.pushFrame(bgra: Buffer, width, height)   copies and returns at once (never blocks on the card)
//   handle.stats()   -> { fresh, repeated, late, dropped, errors, buffered }
//   handle.close()   -> Promise<void>
//
// Threads: JS thread (pushFrame/stats), a libuv worker (list/open/close), and the driver's callback thread
// (ScheduledFrameCompleted). Shared state is guarded by `mu_`; heavy work (scaling, copying into the card's
// frame) happens on the callback thread OUTSIDE the lock, so pushFrame only ever waits for a pointer swap.
//
// Playback model: a small pool of BGRA frames is prerolled and scheduled back to back. Each time the card finishes
// showing a frame, the same frame object is refilled with the newest picture (or left as it is when nothing new
// arrived — "repeat the last frame") and scheduled again. Output therefore never stalls, whatever JS does.

#include <napi.h>

#include "DeckLinkAPI.h"
#include "DeckLinkAPIVersion.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
typedef CFStringRef DLString;
static std::string ToStd(DLString s) {
  if (!s) return "";
  CFIndex len = CFStringGetLength(s);
  CFIndex max = CFStringGetMaximumSizeForEncoding(len, kCFStringEncodingUTF8) + 1;
  std::string out(static_cast<size_t>(max), '\0');
  if (CFStringGetCString(s, &out[0], max, kCFStringEncodingUTF8)) out.resize(std::strlen(out.c_str()));
  else out.clear();
  CFRelease(s);
  return out;
}
#elif defined(__linux__)
typedef const char* DLString;
static std::string ToStd(DLString s) {
  if (!s) return "";
  std::string out(s);
  free(const_cast<char*>(s));
  return out;
}
#else
#error "The Reach DeckLink addon supports macOS (and Linux). Windows (COM/BSTR) is not implemented."
#endif

// SDK-VERSION: SDK 14.3 moved frame memory access to IDeckLinkVideoBuffer (StartAccess/GetBytes/EndAccess).
// Older SDKs use IDeckLinkVideoFrame::GetBytes. Override with -DREACH_DECKLINK_VIDEO_BUFFER=0/1 if this guess is wrong.
#ifndef REACH_DECKLINK_VIDEO_BUFFER
#if defined(BLACKMAGIC_DECKLINK_API_VERSION) && BLACKMAGIC_DECKLINK_API_VERSION >= 0x0e030000
#define REACH_DECKLINK_VIDEO_BUFFER 1
#else
#define REACH_DECKLINK_VIDEO_BUFFER 0
#endif
#endif

/* ───────────────────────────── small helpers ───────────────────────────── */

template <class T>
class Ref {  // minimal COM smart pointer
 public:
  Ref() = default;
  explicit Ref(T* p) : p_(p) {}
  ~Ref() { reset(); }
  Ref(const Ref&) = delete;
  Ref& operator=(const Ref&) = delete;
  Ref(Ref&& o) noexcept : p_(o.p_) { o.p_ = nullptr; }
  Ref& operator=(Ref&& o) noexcept {
    if (this != &o) { reset(); p_ = o.p_; o.p_ = nullptr; }
    return *this;
  }
  void reset() { if (p_) { p_->Release(); p_ = nullptr; } }
  T** out() { reset(); return &p_; }
  void** outv() { return reinterpret_cast<void**>(out()); }
  T* get() const { return p_; }
  T* operator->() const { return p_; }
  explicit operator bool() const { return p_ != nullptr; }

 private:
  T* p_ = nullptr;
};

static std::string FourCC(uint32_t v) {
  char c[5] = {static_cast<char>((v >> 24) & 0xff), static_cast<char>((v >> 16) & 0xff), static_cast<char>((v >> 8) & 0xff), static_cast<char>(v & 0xff), 0};
  return std::string(c);
}
static uint32_t FromFourCC(const std::string& s) {
  if (s.size() != 4) return 0;
  return (uint32_t(uint8_t(s[0])) << 24) | (uint32_t(uint8_t(s[1])) << 16) | (uint32_t(uint8_t(s[2])) << 8) | uint32_t(uint8_t(s[3]));
}

struct ModeInfo {
  uint32_t mode = 0;
  std::string name;
  long width = 0, height = 0;
  BMDTimeValue duration = 0;
  BMDTimeScale scale = 0;
  bool interlaced = false;
};

struct DeviceInfo {
  int index = 0;
  std::string name, displayName;
  int64_t persistentId = 0;
  bool hasPersistentId = false;
  int64_t subDevice = -1, subDevices = 0;
  bool canOutput = false, externalKeying = false, internalKeying = false;
  std::vector<ModeInfo> modes;
};

static ModeInfo ReadMode(IDeckLinkDisplayMode* m) {
  ModeInfo mi;
  mi.mode = static_cast<uint32_t>(m->GetDisplayMode());
  DLString s = nullptr;
  if (m->GetName(&s) == S_OK) mi.name = ToStd(s);
  mi.width = m->GetWidth();
  mi.height = m->GetHeight();
  m->GetFrameRate(&mi.duration, &mi.scale);
  BMDFieldDominance fd = m->GetFieldDominance();
  mi.interlaced = fd == bmdLowerFieldFirst || fd == bmdUpperFieldFirst;
  return mi;
}

/** Walk every DeckLink device. Returns false (code NO_DRIVER) when Desktop Video isn't installed. */
static bool Enumerate(std::vector<DeviceInfo>& out, std::string& code) {
  IDeckLinkIterator* raw = CreateDeckLinkIteratorInstance();
  if (!raw) { code = "NO_DRIVER"; return false; }
  Ref<IDeckLinkIterator> iter(raw);
  IDeckLink* d = nullptr;
  int index = 0;
  while (iter->Next(&d) == S_OK) {
    Ref<IDeckLink> dev(d);
    d = nullptr;
    DeviceInfo info;
    info.index = index++;
    DLString s = nullptr;
    if (dev->GetModelName(&s) == S_OK) info.name = ToStd(s);
    s = nullptr;
    if (dev->GetDisplayName(&s) == S_OK) info.displayName = ToStd(s);
    bool playback = true;
    Ref<IDeckLinkProfileAttributes> attr;  // SDK-VERSION: named IDeckLinkAttributes before SDK 11
    if (dev->QueryInterface(IID_IDeckLinkProfileAttributes, attr.outv()) == S_OK) {
      bool flag = false;
      int64_t v = 0;
      if (attr->GetFlag(BMDDeckLinkSupportsExternalKeying, &flag) == S_OK) info.externalKeying = flag;
      flag = false;
      if (attr->GetFlag(BMDDeckLinkSupportsInternalKeying, &flag) == S_OK) info.internalKeying = flag;
      if (attr->GetInt(BMDDeckLinkPersistentID, &v) == S_OK) { info.persistentId = v; info.hasPersistentId = true; }
      v = 0;
      if (attr->GetInt(BMDDeckLinkSubDeviceIndex, &v) == S_OK) info.subDevice = v;
      v = 0;
      if (attr->GetInt(BMDDeckLinkNumberOfSubDevices, &v) == S_OK) info.subDevices = v;
      v = 0;
      if (attr->GetInt(BMDDeckLinkVideoIOSupport, &v) == S_OK) playback = (v & bmdDeviceSupportsPlayback) != 0;
    }
    Ref<IDeckLinkOutput> output;
    if (playback && dev->QueryInterface(IID_IDeckLinkOutput, output.outv()) == S_OK) {
      info.canOutput = true;
      Ref<IDeckLinkDisplayModeIterator> mit;
      if (output->GetDisplayModeIterator(mit.out()) == S_OK) {
        IDeckLinkDisplayMode* m = nullptr;
        while (mit->Next(&m) == S_OK) {
          Ref<IDeckLinkDisplayMode> mode(m);
          m = nullptr;
          info.modes.push_back(ReadMode(mode.get()));
        }
      }
    }
    out.push_back(std::move(info));
  }
  return true;
}

/* ───────────────────────────── the player ───────────────────────────── */

struct OpenOptions {
  int deviceIndex = -1;
  std::string displayName;
  uint32_t mode = 0;
  std::string keying = "none";  // none | external | internal
  uint8_t keyLevel = 255;
  bool center = false;          // false = top-left (what LED processors expect), true = centred
};

struct Stats {
  double fresh = 0, repeated = 0, late = 0, dropped = 0, errors = 0;
};

class Player;

class OutputCallback final : public IDeckLinkVideoOutputCallback {
 public:
  explicit OutputCallback(Player* p) : player_(p) {}
  HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) override;
  HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, LPVOID* ppv) override {
    if (!ppv) return E_INVALIDARG;
    *ppv = nullptr;
#if defined(__APPLE__)
    CFUUIDBytes unknown = CFUUIDGetUUIDBytes(IUnknownUUID);
    bool isUnknown = std::memcmp(&iid, &unknown, sizeof(REFIID)) == 0;
#else
    bool isUnknown = std::memcmp(&iid, &IID_IUnknown, sizeof(REFIID)) == 0;
#endif
    if (isUnknown || std::memcmp(&iid, &IID_IDeckLinkVideoOutputCallback, sizeof(REFIID)) == 0) {
      *ppv = static_cast<IDeckLinkVideoOutputCallback*>(this);
      AddRef();
      return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG n = --refs_;
    if (n == 0) delete this;
    return n;
  }
  void Detach() { player_.store(nullptr); }

 private:
  std::atomic<Player*> player_;
  std::atomic<ULONG> refs_{1};
};

class Player {
 public:
  static constexpr int kPool = 3;  // frames in flight = preroll (≈100 ms at 29.97, 50 ms at 59.94)

  ~Player() { Close(); }

  /** Worker thread. Returns "" on success, else an error message (and sets code). */
  std::string Open(const OpenOptions& o, std::string& code) {
    IDeckLinkIterator* raw = CreateDeckLinkIteratorInstance();
    if (!raw) { code = "NO_DRIVER"; return "Desktop Video is not installed"; }
    Ref<IDeckLinkIterator> iter(raw);
    // Prefer the device with the remembered display name; fall back to the index.
    Ref<IDeckLink> byName, byIndex;
    IDeckLink* d = nullptr;
    int index = 0;
    while (iter->Next(&d) == S_OK) {
      Ref<IDeckLink> dev(d);
      d = nullptr;
      DLString s = nullptr;
      std::string dn;
      if (dev->GetDisplayName(&s) == S_OK) dn = ToStd(s);
      if (!byName && !o.displayName.empty() && dn == o.displayName) byName = std::move(dev);
      else if (!byIndex && index == o.deviceIndex) byIndex = std::move(dev);
      index++;
    }
    device_ = byName ? std::move(byName) : std::move(byIndex);
    if (!device_) { code = "NO_DEVICE"; return "DeckLink device not found"; }
    if (device_->QueryInterface(IID_IDeckLinkOutput, output_.outv()) != S_OK) { code = "NO_DEVICE"; Teardown(); return "This DeckLink port cannot output video"; }

    bool found = false;
    {
      Ref<IDeckLinkDisplayModeIterator> mit;
      if (output_->GetDisplayModeIterator(mit.out()) == S_OK) {
        IDeckLinkDisplayMode* m = nullptr;
        while (!found && mit->Next(&m) == S_OK) {
          Ref<IDeckLinkDisplayMode> mode(m);
          m = nullptr;
          if (static_cast<uint32_t>(mode->GetDisplayMode()) == o.mode) { mode_ = ReadMode(mode.get()); found = true; }
        }
      }
    }
    if (!found || mode_.width <= 0 || mode_.height <= 0 || mode_.duration <= 0) { code = "NO_MODE"; Teardown(); return "This DeckLink port does not offer that video mode"; }
    width_ = static_cast<int>(mode_.width);
    height_ = static_cast<int>(mode_.height);
    center_ = o.center;

    if (o.keying == "external" || o.keying == "internal") {
      bool external = o.keying == "external";
      Ref<IDeckLinkProfileAttributes> attr;
      bool supported = false;
      if (device_->QueryInterface(IID_IDeckLinkProfileAttributes, attr.outv()) == S_OK)
        attr->GetFlag(external ? BMDDeckLinkSupportsExternalKeying : BMDDeckLinkSupportsInternalKeying, &supported);
      if (!supported || device_->QueryInterface(IID_IDeckLinkKeyer, keyer_.outv()) != S_OK) {
        code = "NO_KEYING"; Teardown(); return external ? "This DeckLink port can't send fill + key" : "This DeckLink port can't key internally";
      }
      keyerExternal_ = external;
    }

    callback_ = new OutputCallback(this);
    if (output_->SetScheduledFrameCompletionCallback(callback_) != S_OK) { code = "FAILED"; Teardown(); return "Could not attach to the DeckLink output"; }

    HRESULT hr = output_->EnableVideoOutput(static_cast<BMDDisplayMode>(o.mode), bmdVideoOutputFlagDefault);
    if (hr == E_ACCESSDENIED) { code = "BUSY"; Teardown(); return "The DeckLink port is in use by another application"; }
    if (hr != S_OK) { code = "FAILED"; Teardown(); return "EnableVideoOutput failed (" + std::to_string(static_cast<long>(hr)) + ")"; }
    outputEnabled_ = true;

    if (keyer_) {
      if (keyer_->Enable(keyerExternal_) != S_OK) { code = "NO_KEYING"; Teardown(); return "Could not switch on keying"; }
      keyer_->SetLevel(o.keyLevel);
      keyerEnabled_ = true;
    }

    last_.assign(static_cast<size_t>(width_) * height_ * 4, 0);  // transparent black: nothing on the key either
    for (int i = 0; i < kPool; i++) {
      IDeckLinkMutableVideoFrame* f = nullptr;
      if (output_->CreateVideoFrame(width_, height_, width_ * 4, bmdFormat8BitBGRA, bmdFrameFlagDefault, &f) != S_OK || !f) {
        code = "FAILED"; Teardown(); return "Could not allocate DeckLink frames";
      }
      frames_.push_back(f);
      frameGen_.push_back(0);
      WithBytes(f, [&](uint8_t* p) { std::memset(p, 0, last_.size()); });
    }
    {
      std::lock_guard<std::mutex> lock(mu_);
      playing_ = true;
    }
    next_ = 0;
    for (auto* f : frames_) {
      if (output_->ScheduleVideoFrame(f, next_, mode_.duration, mode_.scale) != S_OK) { code = "FAILED"; Teardown(); return "Could not preroll frames"; }
      next_ += mode_.duration;
    }
    if (output_->StartScheduledPlayback(0, mode_.scale, 1.0) != S_OK) { code = "FAILED"; Teardown(); return "Could not start playback"; }
    started_ = true;
    return "";
  }

  /** JS thread. Copies the picture; never waits for the card. */
  void Push(const uint8_t* data, int w, int h) {
    std::vector<uint8_t> buf;
    {
      std::lock_guard<std::mutex> lock(mu_);
      if (!playing_) return;
      buf.swap(spare_);
    }
    buf.resize(static_cast<size_t>(w) * h * 4);
    std::memcpy(buf.data(), data, buf.size());
    std::lock_guard<std::mutex> lock(mu_);
    pending_.swap(buf);
    spare_.swap(buf);  // the older pending buffer becomes the spare
    pw_ = w;
    ph_ = h;
    fresh_ = true;
  }

  Stats GetStats() {
    std::lock_guard<std::mutex> lock(mu_);
    return stats_;
  }
  uint32_t Buffered() {
    uint32_t n = 0;
    if (output_ && started_) output_->GetBufferedVideoFrameCount(&n);
    return n;
  }

  /** Driver callback thread. */
  void Completed(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) {
    inCallback_++;
    struct Leave { std::atomic<int>& n; ~Leave() { n--; } } leave{inCallback_};
    if (result == bmdOutputFrameFlushed) return;
    int w = 0, h = 0;
    bool took = false;
    {
      std::lock_guard<std::mutex> lock(mu_);
      if (!playing_) return;
      if (result == bmdOutputFrameDisplayedLate) stats_.late++;
      if (result == bmdOutputFrameDropped) stats_.dropped++;
      if (fresh_) { work_.swap(pending_); w = pw_; h = ph_; fresh_ = false; took = true; }
    }
    if (took && w > 0 && h > 0 && work_.size() >= static_cast<size_t>(w) * h * 4) { Compose(work_.data(), w, h); lastGen_++; }

    IDeckLinkMutableVideoFrame* f = nullptr;
    size_t idx = 0;
    for (; idx < frames_.size(); idx++) if (static_cast<IDeckLinkVideoFrame*>(frames_[idx]) == frame) { f = frames_[idx]; break; }
    if (!f) return;
    bool refreshed = false;
    if (frameGen_[idx] != lastGen_) {
      refreshed = WithBytes(f, [&](uint8_t* p) { std::memcpy(p, last_.data(), last_.size()); });
      if (refreshed) frameGen_[idx] = lastGen_;
    }
    // Fell behind the hardware clock (late/dropped): jump ahead instead of dropping every frame from now on.
    if (result == bmdOutputFrameDisplayedLate || result == bmdOutputFrameDropped) {
      BMDTimeValue t = 0;
      double speed = 0;
      if (output_->GetScheduledStreamTime(mode_.scale, &t, &speed) == S_OK && next_ <= t)
        next_ = (t / mode_.duration + 2) * mode_.duration;
    }
    HRESULT hr = output_->ScheduleVideoFrame(f, next_, mode_.duration, mode_.scale);
    next_ += mode_.duration;
    std::lock_guard<std::mutex> lock(mu_);
    if (hr != S_OK) stats_.errors++;
    else if (refreshed) stats_.fresh++;
    else stats_.repeated++;
  }

  void Stopped() {
    std::lock_guard<std::mutex> lock(mu_);
    stopped_ = true;
    stoppedCv_.notify_all();
  }

  /** Worker thread (or destructor). Idempotent. */
  void Close() {
    {
      std::lock_guard<std::mutex> lock(mu_);
      if (closed_) return;
      closed_ = true;
      playing_ = false;
    }
    if (output_ && started_) {
      output_->StopScheduledPlayback(0, nullptr, 0);
      std::unique_lock<std::mutex> lock(mu_);
      stoppedCv_.wait_for(lock, std::chrono::milliseconds(1000), [&] { return stopped_; });
    }
    Teardown();
  }

  int width() const { return width_; }
  int height() const { return height_; }
  const ModeInfo& mode() const { return mode_; }

 private:
  template <class Fn>
  static bool WithBytes(IDeckLinkMutableVideoFrame* f, Fn fn) {
#if REACH_DECKLINK_VIDEO_BUFFER
    Ref<IDeckLinkVideoBuffer> buf;
    if (f->QueryInterface(IID_IDeckLinkVideoBuffer, buf.outv()) != S_OK) return false;
    if (buf->StartAccess(bmdBufferAccessWrite) != S_OK) return false;
    void* p = nullptr;
    bool ok = buf->GetBytes(&p) == S_OK && p;
    if (ok) fn(static_cast<uint8_t*>(p));
    buf->EndAccess(bmdBufferAccessWrite);
    return ok;
#else
    void* p = nullptr;
    if (f->GetBytes(&p) != S_OK || !p) return false;
    fn(static_cast<uint8_t*>(p));
    return true;
#endif
  }

  /** Place (or scale to fit) a BGRA picture into last_ (mode-sized). Callback thread only. */
  void Compose(const uint8_t* src, int sw, int sh) {
    const int W = width_, H = height_;
    if (sw == W && sh == H) { std::memcpy(last_.data(), src, last_.size()); return; }
    std::memset(last_.data(), 0, last_.size());
    if (sw <= W && sh <= H) {  // fits: place 1:1 (an LED processor maps exact pixels)
      int ox = center_ ? (W - sw) / 2 : 0, oy = center_ ? (H - sh) / 2 : 0;
      for (int y = 0; y < sh; y++) std::memcpy(&last_[(static_cast<size_t>(oy + y) * W + ox) * 4], src + static_cast<size_t>(y) * sw * 4, static_cast<size_t>(sw) * 4);
      return;
    }
    // Too big: bilinear scale down to fit, keeping the aspect ratio.
    double s = std::min(static_cast<double>(W) / sw, static_cast<double>(H) / sh);
    int dw = std::max(1, static_cast<int>(std::lround(sw * s))), dh = std::max(1, static_cast<int>(std::lround(sh * s)));
    int ox = center_ ? (W - dw) / 2 : 0, oy = center_ ? (H - dh) / 2 : 0;
    for (int y = 0; y < dh; y++) {
      double fy = std::max(0.0, (y + 0.5) * sh / dh - 0.5);
      int y0 = std::min(sh - 1, static_cast<int>(fy)), y1 = std::min(sh - 1, y0 + 1);
      double wy = fy - y0;
      uint8_t* out = &last_[(static_cast<size_t>(oy + y) * W + ox) * 4];
      const uint8_t* r0 = src + static_cast<size_t>(y0) * sw * 4;
      const uint8_t* r1 = src + static_cast<size_t>(y1) * sw * 4;
      for (int x = 0; x < dw; x++) {
        double fx = std::max(0.0, (x + 0.5) * sw / dw - 0.5);
        int x0 = std::min(sw - 1, static_cast<int>(fx)), x1 = std::min(sw - 1, x0 + 1);
        double wx = fx - x0;
        for (int c = 0; c < 4; c++) {
          double top = r0[x0 * 4 + c] * (1 - wx) + r0[x1 * 4 + c] * wx;
          double bot = r1[x0 * 4 + c] * (1 - wx) + r1[x1 * 4 + c] * wx;
          out[x * 4 + c] = static_cast<uint8_t>(std::lround(top * (1 - wy) + bot * wy));
        }
      }
    }
  }

  void Teardown() {
    if (output_) output_->SetScheduledFrameCompletionCallback(nullptr);
    if (callback_) callback_->Detach();
    // Let a callback that is already running finish before its frames go away.
    for (int i = 0; i < 200 && inCallback_.load() > 0; i++) std::this_thread::sleep_for(std::chrono::milliseconds(5));
    if (keyer_ && keyerEnabled_) keyer_->Disable();
    keyerEnabled_ = false;
    if (output_ && outputEnabled_) output_->DisableVideoOutput();
    outputEnabled_ = false;
    for (auto* f : frames_) f->Release();
    frames_.clear();
    frameGen_.clear();
    if (callback_) { callback_->Release(); callback_ = nullptr; }
    keyer_.reset();
    output_.reset();
    device_.reset();
  }

  std::mutex mu_;
  std::condition_variable stoppedCv_;
  bool playing_ = false, stopped_ = false, closed_ = false;
  bool started_ = false, outputEnabled_ = false, keyerEnabled_ = false, keyerExternal_ = false, center_ = false;
  std::atomic<int> inCallback_{0};

  Ref<IDeckLink> device_;
  Ref<IDeckLinkOutput> output_;
  Ref<IDeckLinkKeyer> keyer_;
  OutputCallback* callback_ = nullptr;
  std::vector<IDeckLinkMutableVideoFrame*> frames_;
  std::vector<uint64_t> frameGen_;
  ModeInfo mode_;
  int width_ = 0, height_ = 0;
  BMDTimeValue next_ = 0;

  // Guarded by mu_: newest picture from JS, a spare buffer to recycle, counters.
  std::vector<uint8_t> pending_, spare_;
  int pw_ = 0, ph_ = 0;
  bool fresh_ = false;
  Stats stats_;
  // Callback thread only.
  std::vector<uint8_t> work_, last_;
  uint64_t lastGen_ = 1;  // frames start at generation 0 so the first completion copies last_ in
};

HRESULT OutputCallback::ScheduledFrameCompleted(IDeckLinkVideoFrame* frame, BMDOutputFrameCompletionResult result) {
  Player* p = player_.load();
  if (p) p->Completed(frame, result);
  return S_OK;
}
HRESULT OutputCallback::ScheduledPlaybackHasStopped() {
  Player* p = player_.load();
  if (p) p->Stopped();
  return S_OK;
}

/* ───────────────────────────── N-API bindings ───────────────────────────── */

static Napi::Value RejectWith(Napi::Env env, Napi::Promise::Deferred& d, const std::string& message, const std::string& code) {
  Napi::Error e = Napi::Error::New(env, message);
  e.Set("code", Napi::String::New(env, code));
  d.Reject(e.Value());
  return d.Promise();
}

class ListWorker : public Napi::AsyncWorker {
 public:
  explicit ListWorker(Napi::Env env) : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)) {}
  Napi::Promise Promise() { return deferred_.Promise(); }
  void Execute() override {
    if (!Enumerate(devices_, code_)) SetError("Blackmagic Desktop Video is not installed");
  }
  void OnOK() override {
    Napi::Env env = Env();
    Napi::Array arr = Napi::Array::New(env, devices_.size());
    for (size_t i = 0; i < devices_.size(); i++) {
      const DeviceInfo& d = devices_[i];
      Napi::Object o = Napi::Object::New(env);
      o.Set("index", d.index);
      o.Set("name", d.name);
      o.Set("displayName", d.displayName);
      if (d.hasPersistentId) o.Set("persistentId", Napi::String::New(env, std::to_string(d.persistentId)));
      if (d.subDevice >= 0) o.Set("subDevice", static_cast<double>(d.subDevice));
      o.Set("subDevices", static_cast<double>(d.subDevices));
      o.Set("outputs", d.canOutput ? 1 : 0);
      o.Set("supportsKeying", d.externalKeying || d.internalKeying);
      o.Set("externalKeying", d.externalKeying);
      o.Set("internalKeying", d.internalKeying);
      Napi::Array modes = Napi::Array::New(env, d.modes.size());
      for (size_t j = 0; j < d.modes.size(); j++) {
        const ModeInfo& m = d.modes[j];
        Napi::Object mo = Napi::Object::New(env);
        mo.Set("id", FourCC(m.mode));
        mo.Set("name", m.name);
        mo.Set("width", static_cast<double>(m.width));
        mo.Set("height", static_cast<double>(m.height));
        mo.Set("fps", m.duration > 0 ? static_cast<double>(m.scale) / static_cast<double>(m.duration) : 0.0);
        mo.Set("frameDuration", static_cast<double>(m.duration));
        mo.Set("timeScale", static_cast<double>(m.scale));
        mo.Set("interlaced", m.interlaced);
        modes.Set(static_cast<uint32_t>(j), mo);
      }
      o.Set("modes", modes);
      arr.Set(static_cast<uint32_t>(i), o);
    }
    deferred_.Resolve(arr);
  }
  void OnError(const Napi::Error& e) override {
    Napi::Error err = Napi::Error::New(Env(), e.Message());
    err.Set("code", Napi::String::New(Env(), code_.empty() ? "FAILED" : code_));
    deferred_.Reject(err.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  std::vector<DeviceInfo> devices_;
  std::string code_;
};

class CloseWorker : public Napi::AsyncWorker {
 public:
  CloseWorker(Napi::Env env, std::shared_ptr<Player> p) : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), player_(std::move(p)) {}
  Napi::Promise Promise() { return deferred_.Promise(); }
  void Execute() override { player_->Close(); }
  void OnOK() override { deferred_.Resolve(Env().Undefined()); }
  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<Player> player_;
};

static Napi::Object MakeHandle(Napi::Env env, std::shared_ptr<Player> player) {
  Napi::Object h = Napi::Object::New(env);
  const ModeInfo& m = player->mode();
  h.Set("width", player->width());
  h.Set("height", player->height());
  h.Set("fps", m.duration > 0 ? static_cast<double>(m.scale) / static_cast<double>(m.duration) : 0.0);
  h.Set("pushFrame", Napi::Function::New(env, [player](const Napi::CallbackInfo& info) -> Napi::Value {
    Napi::Env env = info.Env();
    if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
      Napi::TypeError::New(env, "pushFrame(buffer, width, height)").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    Napi::Buffer<uint8_t> buf = info[0].As<Napi::Buffer<uint8_t>>();
    int w = info[1].As<Napi::Number>().Int32Value(), h = info[2].As<Napi::Number>().Int32Value();
    if (w <= 0 || h <= 0 || w > 16384 || h > 16384 || buf.Length() < static_cast<size_t>(w) * h * 4) {
      Napi::RangeError::New(env, "pushFrame: buffer is smaller than width*height*4").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    player->Push(buf.Data(), w, h);
    return env.Undefined();
  }, "pushFrame"));
  h.Set("stats", Napi::Function::New(env, [player](const Napi::CallbackInfo& info) -> Napi::Value {
    Napi::Env env = info.Env();
    Stats s = player->GetStats();
    Napi::Object o = Napi::Object::New(env);
    o.Set("fresh", s.fresh);
    o.Set("repeated", s.repeated);
    o.Set("late", s.late);
    o.Set("dropped", s.dropped);
    o.Set("errors", s.errors);
    o.Set("buffered", static_cast<double>(player->Buffered()));
    return o;
  }, "stats"));
  h.Set("close", Napi::Function::New(env, [player](const Napi::CallbackInfo& info) -> Napi::Value {
    auto* w = new CloseWorker(info.Env(), player);
    Napi::Promise p = w->Promise();
    w->Queue();
    return p;
  }, "close"));
  return h;
}

class OpenWorker : public Napi::AsyncWorker {
 public:
  OpenWorker(Napi::Env env, OpenOptions o) : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), opts_(std::move(o)), player_(std::make_shared<Player>()) {}
  Napi::Promise Promise() { return deferred_.Promise(); }
  void Execute() override {
    std::string err = player_->Open(opts_, code_);
    if (!err.empty()) SetError(err);
  }
  void OnOK() override { deferred_.Resolve(MakeHandle(Env(), player_)); }
  void OnError(const Napi::Error& e) override {
    Napi::Error err = Napi::Error::New(Env(), e.Message());
    err.Set("code", Napi::String::New(Env(), code_.empty() ? "FAILED" : code_));
    deferred_.Reject(err.Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  OpenOptions opts_;
  std::shared_ptr<Player> player_;
  std::string code_;
};

static Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  auto* w = new ListWorker(info.Env());
  Napi::Promise p = w->Promise();
  w->Queue();
  return p;
}

static Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Promise::Deferred d = Napi::Promise::Deferred::New(env);
  if (info.Length() < 1 || !info[0].IsObject()) return RejectWith(env, d, "open({ device, mode, keying, keyLevel })", "FAILED");
  Napi::Object o = info[0].As<Napi::Object>();
  OpenOptions opts;
  Napi::Value dev = o.Get("device");
  if (dev.IsNumber()) opts.deviceIndex = dev.As<Napi::Number>().Int32Value();
  else if (dev.IsString()) opts.displayName = dev.As<Napi::String>().Utf8Value();
  Napi::Value dn = o.Get("displayName");
  if (dn.IsString()) opts.displayName = dn.As<Napi::String>().Utf8Value();
  Napi::Value mode = o.Get("mode");
  if (mode.IsString()) opts.mode = FromFourCC(mode.As<Napi::String>().Utf8Value());
  if (!opts.mode) return RejectWith(env, d, "open: mode must be a 4-character DeckLink mode id (e.g. \"Hp29\")", "NO_MODE");
  Napi::Value keying = o.Get("keying");
  if (keying.IsString()) opts.keying = keying.As<Napi::String>().Utf8Value();
  Napi::Value level = o.Get("keyLevel");
  if (level.IsNumber()) opts.keyLevel = static_cast<uint8_t>(std::max(0, std::min(255, level.As<Napi::Number>().Int32Value())));
  Napi::Value align = o.Get("align");
  opts.center = align.IsString() && align.As<Napi::String>().Utf8Value() == "center";
  auto* w = new OpenWorker(env, std::move(opts));
  Napi::Promise p = w->Promise();
  w->Queue();
  return p;
}

static Napi::Value DriverVersion(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  IDeckLinkAPIInformation* raw = CreateDeckLinkAPIInformationInstance();
  if (!raw) return env.Null();
  Ref<IDeckLinkAPIInformation> api(raw);
  DLString s = nullptr;
  if (api->GetString(BMDDeckLinkAPIVersion, &s) == S_OK) return Napi::String::New(env, ToStd(s));
  return Napi::String::New(env, "unknown");
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices", Napi::Function::New(env, ListDevices, "listDevices"));
  exports.Set("open", Napi::Function::New(env, Open, "open"));
  exports.Set("driverVersion", Napi::Function::New(env, DriverVersion, "driverVersion"));
#ifdef BLACKMAGIC_DECKLINK_API_VERSION_STRING
  exports.Set("apiVersion", Napi::String::New(env, BLACKMAGIC_DECKLINK_API_VERSION_STRING));
#else
  exports.Set("apiVersion", Napi::String::New(env, "unknown"));
#endif
  return exports;
}

NODE_API_MODULE(reach_decklink, Init)
