#include <ApplicationServices/ApplicationServices.h>
#include <AppKit/AppKit.h>
#include <napi.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <map>
#include <set>
#include <string>
#include <thread>
#include <vector>

namespace {

using KeyCode = CGKeyCode;

struct KeyStroke {
  KeyCode code;
  bool shift;
};

struct AppInfo {
  std::string bundleId;
  std::string displayName;
  std::string path;
};

struct DisplayInfo {
  uint32_t id;
  CGRect bounds;
};

std::string LowerAscii(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });
  return value;
}

std::string NSStringToString(NSString* value) {
  if (!value) return "";
  const char* utf8 = [value UTF8String];
  return utf8 ? std::string(utf8) : "";
}

NSString* StringToNSString(const std::string& value) {
  return [NSString stringWithUTF8String:value.c_str()];
}

Napi::Object AppInfoToObject(Napi::Env env, const AppInfo& app) {
  Napi::Object result = Napi::Object::New(env);
  if (!app.bundleId.empty()) result.Set("bundleId", app.bundleId);
  if (!app.displayName.empty()) result.Set("displayName", app.displayName);
  if (!app.path.empty()) result.Set("path", app.path);
  return result;
}

Napi::Array AppInfoArrayToNapi(Napi::Env env, const std::vector<AppInfo>& apps) {
  Napi::Array result = Napi::Array::New(env, apps.size());
  for (uint32_t i = 0; i < apps.size(); ++i) {
    result.Set(i, AppInfoToObject(env, apps[i]));
  }
  return result;
}

std::map<std::string, KeyCode> BuildNamedKeyMap() {
  return {
    {"a", 0}, {"s", 1}, {"d", 2}, {"f", 3}, {"h", 4}, {"g", 5}, {"z", 6}, {"x", 7}, {"c", 8}, {"v", 9},
    {"b", 11}, {"q", 12}, {"w", 13}, {"e", 14}, {"r", 15}, {"y", 16}, {"t", 17}, {"1", 18}, {"2", 19},
    {"3", 20}, {"4", 21}, {"6", 22}, {"5", 23}, {"=", 24}, {"9", 25}, {"7", 26}, {"-", 27}, {"8", 28},
    {"0", 29}, {"]", 30}, {"o", 31}, {"u", 32}, {"[", 33}, {"i", 34}, {"p", 35}, {"return", 36},
    {"enter", 36}, {"l", 37}, {"j", 38}, {"'", 39}, {"k", 40}, {";", 41}, {"\\", 42}, {",", 43},
    {"/", 44}, {"n", 45}, {"m", 46}, {".", 47}, {"tab", 48}, {"space", 49}, {"`", 50},
    {"delete", 51}, {"backspace", 51}, {"escape", 53}, {"esc", 53}, {"command", 55}, {"cmd", 55},
    {"shift", 56}, {"capslock", 57}, {"option", 58}, {"alt", 58}, {"control", 59}, {"ctrl", 59},
    {"rightshift", 60}, {"rightoption", 61}, {"rightcontrol", 62}, {"fn", 63}, {"f17", 64}, {"volumeup", 72},
    {"volumedown", 73}, {"mute", 74}, {"f18", 79}, {"f19", 80}, {"f20", 90}, {"f5", 96}, {"f6", 97},
    {"f7", 98}, {"f3", 99}, {"f8", 100}, {"f9", 101}, {"f11", 103}, {"f13", 105}, {"f16", 106},
    {"f14", 107}, {"f10", 109}, {"f12", 111}, {"f15", 113}, {"help", 114}, {"home", 115},
    {"pageup", 116}, {"forwarddelete", 117}, {"end", 119}, {"f2", 120}, {"pagedown", 121}, {"f1", 122},
    {"left", 123}, {"right", 124}, {"down", 125}, {"up", 126}
  };
}

const std::map<std::string, KeyCode>& NamedKeyMap() {
  static const std::map<std::string, KeyCode> keys = BuildNamedKeyMap();
  return keys;
}

std::map<char, KeyStroke> BuildAsciiMap() {
  std::map<char, KeyStroke> keys;
  const std::string letters = "abcdefghijklmnopqrstuvwxyz";
  for (char ch : letters) {
    auto it = NamedKeyMap().find(std::string(1, ch));
    if (it != NamedKeyMap().end()) {
      keys[ch] = {it->second, false};
      keys[static_cast<char>(std::toupper(static_cast<unsigned char>(ch)))] = {it->second, true};
    }
  }
  const std::vector<std::pair<char, KeyStroke>> punctuation = {
    {'0', {29, false}}, {'1', {18, false}}, {'2', {19, false}}, {'3', {20, false}}, {'4', {21, false}},
    {'5', {23, false}}, {'6', {22, false}}, {'7', {26, false}}, {'8', {28, false}}, {'9', {25, false}},
    {')', {29, true}}, {'!', {18, true}}, {'@', {19, true}}, {'#', {20, true}}, {'$', {21, true}},
    {'%', {23, true}}, {'^', {22, true}}, {'&', {26, true}}, {'*', {28, true}}, {'(', {25, true}},
    {'-', {27, false}}, {'_', {27, true}}, {'=', {24, false}}, {'+', {24, true}},
    {'[', {33, false}}, {'{', {33, true}}, {']', {30, false}}, {'}', {30, true}},
    {'\\', {42, false}}, {'|', {42, true}}, {';', {41, false}}, {':', {41, true}},
    {'\'', {39, false}}, {'"', {39, true}}, {',', {43, false}}, {'<', {43, true}},
    {'.', {47, false}}, {'>', {47, true}}, {'/', {44, false}}, {'?', {44, true}},
    {'`', {50, false}}, {'~', {50, true}}, {' ', {49, false}}, {'\t', {48, false}},
    {'\n', {36, false}}, {'\r', {36, false}}
  };
  for (const auto& item : punctuation) {
    keys[item.first] = item.second;
  }
  return keys;
}

const std::map<char, KeyStroke>& AsciiMap() {
  static const std::map<char, KeyStroke> keys = BuildAsciiMap();
  return keys;
}

Napi::Value BoolResult(const Napi::CallbackInfo& info, bool value) {
  return Napi::Boolean::New(info.Env(), value);
}

double ReadNumber(const Napi::Env& env, const Napi::Object& object, const char* name) {
  Napi::Value value = object.Get(name);
  if (!value.IsNumber()) {
    Napi::TypeError::New(env, std::string("Expected numeric ") + name).ThrowAsJavaScriptException();
    return 0;
  }
  return value.As<Napi::Number>().DoubleValue();
}

std::string ReadString(const Napi::Env& env, const Napi::Object& object, const char* name, const std::string& fallback = "") {
  Napi::Value value = object.Get(name);
  if (value.IsUndefined() || value.IsNull()) {
    return fallback;
  }
  if (!value.IsString()) {
    Napi::TypeError::New(env, std::string("Expected string ") + name).ThrowAsJavaScriptException();
    return fallback;
  }
  return value.As<Napi::String>().Utf8Value();
}

int ReadInt(const Napi::Object& object, const char* name, int fallback) {
  Napi::Value value = object.Get(name);
  if (!value.IsNumber()) {
    return fallback;
  }
  return value.As<Napi::Number>().Int32Value();
}

bool AccessibilityTrusted() {
  return AXIsProcessTrusted();
}

CGEventFlags FlagsForModifiers(const std::vector<std::string>& modifiers) {
  CGEventFlags flags = 0;
  for (const std::string& modifier : modifiers) {
    const std::string key = LowerAscii(modifier);
    if (key == "shift") flags |= kCGEventFlagMaskShift;
    else if (key == "command" || key == "cmd" || key == "meta" || key == "super") flags |= kCGEventFlagMaskCommand;
    else if (key == "control" || key == "ctrl") flags |= kCGEventFlagMaskControl;
    else if (key == "option" || key == "alt" || key == "opt") flags |= kCGEventFlagMaskAlternate;
    else if (key == "fn") flags |= kCGEventFlagMaskSecondaryFn;
  }
  return flags;
}

std::vector<std::string> ReadStringArray(const Napi::Object& object, const char* name) {
  std::vector<std::string> out;
  Napi::Value value = object.Get(name);
  if (!value.IsArray()) return out;
  Napi::Array array = value.As<Napi::Array>();
  for (uint32_t i = 0; i < array.Length(); ++i) {
    Napi::Value item = array.Get(i);
    if (item.IsString()) {
      out.push_back(item.As<Napi::String>().Utf8Value());
    }
  }
  return out;
}

CGMouseButton MouseButtonForName(const std::string& value) {
  const std::string button = LowerAscii(value);
  if (button == "right") return kCGMouseButtonRight;
  if (button == "middle") return kCGMouseButtonCenter;
  return kCGMouseButtonLeft;
}

CGEventType MouseDownType(CGMouseButton button) {
  if (button == kCGMouseButtonRight) return kCGEventRightMouseDown;
  if (button == kCGMouseButtonCenter) return kCGEventOtherMouseDown;
  return kCGEventLeftMouseDown;
}

CGEventType MouseUpType(CGMouseButton button) {
  if (button == kCGMouseButtonRight) return kCGEventRightMouseUp;
  if (button == kCGMouseButtonCenter) return kCGEventOtherMouseUp;
  return kCGEventLeftMouseUp;
}

CGEventType MouseDraggedType(CGMouseButton button) {
  if (button == kCGMouseButtonRight) return kCGEventRightMouseDragged;
  if (button == kCGMouseButtonCenter) return kCGEventOtherMouseDragged;
  return kCGEventLeftMouseDragged;
}

void PostEvent(CGEventRef event) {
  if (!event) return;
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

void MoveMouseTo(CGPoint point) {
  PostEvent(CGEventCreateMouseEvent(nullptr, kCGEventMouseMoved, point, kCGMouseButtonLeft));
}

void MouseDown(CGPoint point, CGMouseButton button, CGEventFlags flags = 0) {
  CGEventRef event = CGEventCreateMouseEvent(nullptr, MouseDownType(button), point, button);
  if (event) CGEventSetFlags(event, flags);
  PostEvent(event);
}

void MouseUp(CGPoint point, CGMouseButton button, CGEventFlags flags = 0) {
  CGEventRef event = CGEventCreateMouseEvent(nullptr, MouseUpType(button), point, button);
  if (event) CGEventSetFlags(event, flags);
  PostEvent(event);
}

void MouseDrag(CGPoint point, CGMouseButton button) {
  PostEvent(CGEventCreateMouseEvent(nullptr, MouseDraggedType(button), point, button));
}

CGPoint CurrentMousePoint() {
  CGEventRef event = CGEventCreate(nullptr);
  if (!event) return CGPointMake(0, 0);
  CGPoint point = CGEventGetLocation(event);
  CFRelease(event);
  return point;
}

void PostKey(KeyCode code, bool down, CGEventFlags flags = 0) {
  CGEventRef event = CGEventCreateKeyboardEvent(nullptr, code, down);
  if (event) CGEventSetFlags(event, flags);
  PostEvent(event);
}

void SendKeyCodeStroke(KeyCode code, CGEventFlags flags = 0) {
  PostKey(code, true, flags);
  std::this_thread::sleep_for(std::chrono::milliseconds(8));
  PostKey(code, false, flags);
}

bool IsModifierName(const std::string& raw) {
  const std::string key = LowerAscii(raw);
  return key == "command" || key == "cmd" || key == "meta" || key == "super"
    || key == "shift"
    || key == "control" || key == "ctrl"
    || key == "option" || key == "alt" || key == "opt"
    || key == "fn";
}

KeyCode ModifierKeyCode(const std::string& raw) {
  const std::string key = LowerAscii(raw);
  if (key == "shift") return 56;
  if (key == "control" || key == "ctrl") return 59;
  if (key == "option" || key == "alt" || key == "opt") return 58;
  if (key == "fn") return 63;
  return 55;
}

bool LookupKeyCode(const std::string& raw, KeyCode* code) {
  const std::string key = LowerAscii(raw);
  auto it = NamedKeyMap().find(key);
  if (it == NamedKeyMap().end()) return false;
  *code = it->second;
  return true;
}

bool SendKeyStroke(const std::string& keyName, CGEventFlags flags = 0) {
  KeyCode code = 0;
  if (!LookupKeyCode(keyName, &code)) {
    return false;
  }
  SendKeyCodeStroke(code, flags);
  return true;
}

std::vector<std::string> SplitKeySequence(const std::string& sequence) {
  std::vector<std::string> out;
  std::string current;
  for (char ch : sequence) {
    if (ch == '+') {
      if (!current.empty()) out.push_back(current);
      current.clear();
    } else if (!std::isspace(static_cast<unsigned char>(ch))) {
      current.push_back(ch);
    }
  }
  if (!current.empty()) out.push_back(current);
  return out;
}

std::vector<AppInfo> RunningAppsVector() {
  std::vector<AppInfo> apps;
  std::set<std::string> seen;
  @autoreleasepool {
    NSArray<NSRunningApplication*>* running = [[NSWorkspace sharedWorkspace] runningApplications];
    for (NSRunningApplication* app in running) {
      std::string bundleId = NSStringToString([app bundleIdentifier]);
      if (bundleId.empty() || seen.count(bundleId)) continue;
      seen.insert(bundleId);
      std::string name = NSStringToString([app localizedName]);
      apps.push_back({bundleId, name.empty() ? bundleId : name, ""});
    }
  }
  std::sort(apps.begin(), apps.end(), [](const AppInfo& left, const AppInfo& right) {
    return LowerAscii(left.displayName) < LowerAscii(right.displayName);
  });
  return apps;
}

NSRunningApplication* RunningApplicationForBundleId(const std::string& bundleId) {
  @autoreleasepool {
    NSArray<NSRunningApplication*>* running = [[NSWorkspace sharedWorkspace] runningApplications];
    NSString* target = StringToNSString(bundleId);
    for (NSRunningApplication* app in running) {
      if ([[app bundleIdentifier] isEqualToString:target]) {
        return app;
      }
    }
  }
  return nil;
}

AppInfo AppInfoForRunningApplication(NSRunningApplication* app) {
  if (!app) return {};
  std::string bundleId = NSStringToString([app bundleIdentifier]);
  if (bundleId.empty()) return {};
  std::string name = NSStringToString([app localizedName]);
  return {bundleId, name.empty() ? bundleId : name, ""};
}

std::vector<DisplayInfo> ActiveDisplays() {
  std::vector<DisplayInfo> displays;
  CGDirectDisplayID ids[32];
  uint32_t count = 0;
  if (CGGetActiveDisplayList(32, ids, &count) != kCGErrorSuccess) return displays;
  for (uint32_t i = 0; i < count; ++i) {
    displays.push_back({ids[i], CGDisplayBounds(ids[i])});
  }
  return displays;
}

NSArray* WindowInfoList() {
  return [(NSArray*)CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  ) autorelease];
}

bool WindowIsCandidate(NSDictionary* window) {
  NSNumber* layer = window[(id)kCGWindowLayer];
  if (layer && [layer intValue] != 0) return false;
  NSNumber* onscreen = window[(id)kCGWindowIsOnscreen];
  if (onscreen && ![onscreen boolValue]) return false;
  NSDictionary* bounds = window[(id)kCGWindowBounds];
  if (!bounds) return false;
  CGRect rect = CGRectZero;
  if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &rect)) return false;
  return rect.size.width > 1 && rect.size.height > 1;
}

CGRect WindowBounds(NSDictionary* window) {
  CGRect rect = CGRectZero;
  NSDictionary* bounds = window[(id)kCGWindowBounds];
  if (bounds) CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)bounds, &rect);
  return rect;
}

std::map<std::string, AppInfo> RunningAppsByName() {
  std::map<std::string, AppInfo> apps;
  for (const AppInfo& app : RunningAppsVector()) {
    if (!app.displayName.empty()) apps[app.displayName] = app;
    if (!app.bundleId.empty()) apps[app.bundleId] = app;
  }
  return apps;
}

std::vector<AppInfo> InstalledAppsInRoot(NSURL* root) {
  std::vector<AppInfo> apps;
  if (!root) return apps;
  @autoreleasepool {
    NSFileManager* fileManager = [NSFileManager defaultManager];
    NSDirectoryEnumerator<NSURL*>* enumerator = [fileManager enumeratorAtURL:root
      includingPropertiesForKeys:@[NSURLIsDirectoryKey]
      options:NSDirectoryEnumerationSkipsHiddenFiles
      errorHandler:^BOOL(NSURL* url, NSError* error) {
        return YES;
      }];
    for (NSURL* url in enumerator) {
      if (![[url pathExtension] isEqualToString:@"app"]) continue;
      NSNumber* isDirectory = nil;
      [url getResourceValue:&isDirectory forKey:NSURLIsDirectoryKey error:nil];
      if (![isDirectory boolValue]) continue;
      [enumerator skipDescendants];
      NSBundle* bundle = [NSBundle bundleWithURL:url];
      NSString* bundleId = [bundle bundleIdentifier];
      if (!bundleId) continue;
      NSString* name = [[bundle localizedInfoDictionary] objectForKey:@"CFBundleDisplayName"];
      if (!name) name = [[bundle infoDictionary] objectForKey:@"CFBundleDisplayName"];
      if (!name) name = [[bundle infoDictionary] objectForKey:@"CFBundleName"];
      if (!name) name = [[url URLByDeletingPathExtension] lastPathComponent];
      apps.push_back({
        NSStringToString(bundleId),
        NSStringToString(name),
        NSStringToString([url path])
      });
    }
  }
  return apps;
}

std::vector<AppInfo> InstalledAppsVector() {
  std::vector<AppInfo> out;
  std::set<std::string> seen;
  @autoreleasepool {
    NSArray<NSURL*>* roots = @[
      [NSURL fileURLWithPath:@"/Applications"],
      [NSURL fileURLWithPath:[NSHomeDirectory() stringByAppendingPathComponent:@"Applications"]],
      [NSURL fileURLWithPath:@"/System/Applications"],
      [NSURL fileURLWithPath:@"/System/Applications/Utilities"],
      [NSURL fileURLWithPath:@"/System/Cryptexes/App/System/Applications"],
      [NSURL fileURLWithPath:@"/System/Volumes/Preboot/Cryptexes/App/System/Applications"]
    ];
    for (NSURL* root in roots) {
      BOOL isDir = NO;
      if (![[NSFileManager defaultManager] fileExistsAtPath:[root path] isDirectory:&isDir] || !isDir) continue;
      for (const AppInfo& app : InstalledAppsInRoot(root)) {
        if (app.bundleId.empty() || seen.count(app.bundleId)) continue;
        seen.insert(app.bundleId);
        out.push_back(app);
      }
    }
  }
  std::sort(out.begin(), out.end(), [](const AppInfo& left, const AppInfo& right) {
    return LowerAscii(left.displayName) < LowerAscii(right.displayName);
  });
  return out;
}

std::vector<std::string> ReadBundleIds(const Napi::Object& object, const char* name) {
  return ReadStringArray(object, name);
}

bool RectIntersectsDisplay(CGRect rect, uint32_t displayId) {
  if (displayId == 0) return true;
  CGRect displayRect = CGRectNull;
  for (const DisplayInfo& display : ActiveDisplays()) {
    if (display.id == displayId) {
      displayRect = display.bounds;
      break;
    }
  }
  if (CGRectIsNull(displayRect)) return true;
  return !CGRectIsNull(CGRectIntersection(rect, displayRect));
}

std::vector<AppInfo> HideCandidates(const std::vector<std::string>& exemptBundleIds, uint32_t displayId) {
  std::set<std::string> exempt;
  for (std::string bundleId : exemptBundleIds) exempt.insert(LowerAscii(bundleId));
  const std::set<std::string> systemExempt = {
    "com.apple.dock",
    "com.apple.finder",
    "com.apple.loginwindow",
    "com.apple.systemevents",
    "com.apple.systemuiserver",
    "com.apple.windowmanager",
    "com.kira.app"
  };
  std::map<std::string, AppInfo> runningByName = RunningAppsByName();
  std::map<std::string, AppInfo> candidates;
  @autoreleasepool {
    NSArray* windows = WindowInfoList();
    for (NSDictionary* window in windows) {
      if (!WindowIsCandidate(window)) continue;
      CGRect rect = WindowBounds(window);
      if (!RectIntersectsDisplay(rect, displayId)) continue;
      std::string owner = NSStringToString(window[(id)kCGWindowOwnerName]);
      if (owner.empty()) continue;
      auto appIt = runningByName.find(owner);
      if (appIt == runningByName.end()) continue;
      std::string bundle = LowerAscii(appIt->second.bundleId);
      if (bundle.empty() || exempt.count(bundle) || systemExempt.count(bundle)) continue;
      candidates[appIt->second.bundleId] = appIt->second;
    }
  }
  std::vector<AppInfo> out;
  for (const auto& item : candidates) out.push_back(item.second);
  std::sort(out.begin(), out.end(), [](const AppInfo& left, const AppInfo& right) {
    return LowerAscii(left.displayName) < LowerAscii(right.displayName);
  });
  return out;
}

Napi::Value FrontmostApp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    AppInfo app = AppInfoForRunningApplication([[NSWorkspace sharedWorkspace] frontmostApplication]);
    if (app.bundleId.empty()) return env.Null();
    return AppInfoToObject(env, app);
  }
}

Napi::Value AppUnderPoint(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  CGPoint point = CGPointMake(ReadNumber(env, payload, "x"), ReadNumber(env, payload, "y"));
  std::map<std::string, AppInfo> runningByName = RunningAppsByName();
  @autoreleasepool {
    NSArray* windows = WindowInfoList();
    for (NSDictionary* window in windows) {
      if (!WindowIsCandidate(window)) continue;
      if (!CGRectContainsPoint(WindowBounds(window), point)) continue;
      std::string owner = NSStringToString(window[(id)kCGWindowOwnerName]);
      auto appIt = runningByName.find(owner);
      if (appIt != runningByName.end()) {
        return AppInfoToObject(env, appIt->second);
      }
    }
  }
  return FrontmostApp(info);
}

Napi::Value ListRunningApps(const Napi::CallbackInfo& info) {
  return AppInfoArrayToNapi(info.Env(), RunningAppsVector());
}

Napi::Value ListInstalledApps(const Napi::CallbackInfo& info) {
  return AppInfoArrayToNapi(info.Env(), InstalledAppsVector());
}

Napi::Value OpenApp(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  std::string bundleId = ReadString(env, payload, "bundleId", "");
  @autoreleasepool {
    NSWorkspace* workspace = [NSWorkspace sharedWorkspace];
    NSURL* url = [workspace URLForApplicationWithBundleIdentifier:StringToNSString(bundleId)];
    if (!url) {
      Napi::Error::New(env, "App not found for bundle identifier: " + bundleId).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    __block NSError* launchError = nil;
    __block BOOL completed = NO;
    NSWorkspaceOpenConfiguration* configuration = [NSWorkspaceOpenConfiguration configuration];
    [workspace openApplicationAtURL:url configuration:configuration completionHandler:^(NSRunningApplication* app, NSError* error) {
      launchError = [error retain];
      completed = YES;
    }];
    NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:5.0];
    while (!completed && [deadline timeIntervalSinceNow] > 0) {
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.02]];
    }
    if (!completed || launchError) {
      std::string message = launchError ? NSStringToString([launchError localizedDescription]) : "Timed out opening app " + bundleId;
      [launchError release];
      Napi::Error::New(env, message).ThrowAsJavaScriptException();
      return env.Undefined();
    }
    [launchError release];
  }
  return BoolResult(info, true);
}

Napi::Value PreviewHideSet(const Napi::CallbackInfo& info) {
  Napi::Object payload = info[0].As<Napi::Object>();
  uint32_t displayId = static_cast<uint32_t>(ReadInt(payload, "displayId", 0));
  return AppInfoArrayToNapi(info.Env(), HideCandidates(ReadBundleIds(payload, "exemptBundleIds"), displayId));
}

Napi::Value PrepareForAction(const Napi::CallbackInfo& info) {
  Napi::Object payload = info[0].As<Napi::Object>();
  uint32_t displayId = static_cast<uint32_t>(ReadInt(payload, "displayId", 0));
  std::vector<AppInfo> targets = HideCandidates(ReadBundleIds(payload, "exemptBundleIds"), displayId);
  Napi::Array result = Napi::Array::New(info.Env());
  uint32_t index = 0;
  @autoreleasepool {
    for (const AppInfo& target : targets) {
      NSRunningApplication* app = RunningApplicationForBundleId(target.bundleId);
      if (!app) continue;
      if ([app hide]) {
        result.Set(index++, target.bundleId);
      }
    }
  }
  return result;
}

Napi::Value RestoreApps(const Napi::CallbackInfo& info) {
  Napi::Object payload = info[0].As<Napi::Object>();
  std::vector<std::string> bundleIds = ReadBundleIds(payload, "bundleIds");
  Napi::Array result = Napi::Array::New(info.Env());
  uint32_t index = 0;
  @autoreleasepool {
    for (const std::string& bundleId : bundleIds) {
      NSRunningApplication* app = RunningApplicationForBundleId(bundleId);
      if (!app) continue;
      if ([app unhide]) {
        result.Set(index++, bundleId);
      }
    }
  }
  return result;
}

Napi::Value FindWindowDisplays(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  std::vector<std::string> bundleIds = ReadBundleIds(payload, "bundleIds");
  std::map<std::string, AppInfo> runningByName = RunningAppsByName();
  std::map<std::string, std::set<uint32_t>> displayIdsByBundle;
  for (const std::string& bundleId : bundleIds) displayIdsByBundle[bundleId] = {};
  std::vector<DisplayInfo> displays = ActiveDisplays();
  @autoreleasepool {
    NSArray* windows = WindowInfoList();
    for (NSDictionary* window in windows) {
      if (!WindowIsCandidate(window)) continue;
      std::string owner = NSStringToString(window[(id)kCGWindowOwnerName]);
      auto appIt = runningByName.find(owner);
      if (appIt == runningByName.end()) continue;
      auto targetIt = displayIdsByBundle.find(appIt->second.bundleId);
      if (targetIt == displayIdsByBundle.end()) continue;
      CGRect rect = WindowBounds(window);
      for (const DisplayInfo& display : displays) {
        if (!CGRectIsNull(CGRectIntersection(rect, display.bounds))) {
          targetIt->second.insert(display.id);
        }
      }
    }
  }
  Napi::Array result = Napi::Array::New(env, bundleIds.size());
  for (uint32_t i = 0; i < bundleIds.size(); ++i) {
    Napi::Object item = Napi::Object::New(env);
    item.Set("bundleId", bundleIds[i]);
    const auto& ids = displayIdsByBundle[bundleIds[i]];
    Napi::Array idArray = Napi::Array::New(env, ids.size());
    uint32_t index = 0;
    for (uint32_t id : ids) idArray.Set(index++, id);
    item.Set("displayIds", idArray);
    result.Set(i, item);
  }
  return result;
}

Napi::Value IsTrustedAccessibilityClient(const Napi::CallbackInfo& info) {
  return BoolResult(info, AccessibilityTrusted());
}

Napi::Value CursorPosition(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  CGPoint point = CurrentMousePoint();
  Napi::Object result = Napi::Object::New(env);
  result.Set("x", Napi::Number::New(env, point.x));
  result.Set("y", Napi::Number::New(env, point.y));
  return result;
}

Napi::Value MoveMouse(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  MoveMouseTo(CGPointMake(ReadNumber(env, payload, "x"), ReadNumber(env, payload, "y")));
  return BoolResult(info, true);
}

Napi::Value Click(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  CGPoint point = CGPointMake(ReadNumber(env, payload, "x"), ReadNumber(env, payload, "y"));
  CGMouseButton button = MouseButtonForName(ReadString(env, payload, "button", "left"));
  int count = std::max(1, ReadInt(payload, "count", 1));
  CGEventFlags flags = FlagsForModifiers(ReadStringArray(payload, "modifiers"));
  MoveMouseTo(point);
  for (int i = 0; i < count; ++i) {
    MouseDown(point, button, flags);
    std::this_thread::sleep_for(std::chrono::milliseconds(35));
    MouseUp(point, button, flags);
    std::this_thread::sleep_for(std::chrono::milliseconds(80));
  }
  return BoolResult(info, true);
}

Napi::Value MouseDownAction(const Napi::CallbackInfo& info) {
  CGPoint point = CurrentMousePoint();
  MouseDown(point, kCGMouseButtonLeft);
  return BoolResult(info, true);
}

Napi::Value MouseUpAction(const Napi::CallbackInfo& info) {
  CGPoint point = CurrentMousePoint();
  MouseUp(point, kCGMouseButtonLeft);
  return BoolResult(info, true);
}

Napi::Value Drag(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  CGPoint from = CurrentMousePoint();
  Napi::Value fromValue = payload.Get("from");
  if (fromValue.IsObject()) {
    Napi::Object fromObject = fromValue.As<Napi::Object>();
    from = CGPointMake(ReadNumber(env, fromObject, "x"), ReadNumber(env, fromObject, "y"));
  }
  Napi::Object toObject = payload.Get("to").As<Napi::Object>();
  CGPoint to = CGPointMake(ReadNumber(env, toObject, "x"), ReadNumber(env, toObject, "y"));
  MoveMouseTo(from);
  std::this_thread::sleep_for(std::chrono::milliseconds(40));
  MouseDown(from, kCGMouseButtonLeft);
  const int steps = 12;
  for (int i = 1; i <= steps; ++i) {
    const double t = static_cast<double>(i) / static_cast<double>(steps);
    CGPoint point = CGPointMake(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    MouseDrag(point, kCGMouseButtonLeft);
    std::this_thread::sleep_for(std::chrono::milliseconds(12));
  }
  MouseUp(to, kCGMouseButtonLeft);
  return BoolResult(info, true);
}

Napi::Value Scroll(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  CGPoint point = CGPointMake(ReadNumber(env, payload, "x"), ReadNumber(env, payload, "y"));
  int deltaX = ReadInt(payload, "deltaX", 0);
  int deltaY = ReadInt(payload, "deltaY", 0);
  MoveMouseTo(point);
  CGEventRef event = CGEventCreateScrollWheelEvent(
    nullptr,
    kCGScrollEventUnitLine,
    2,
    deltaY,
    deltaX
  );
  PostEvent(event);
  return BoolResult(info, true);
}

Napi::Value KeyAction(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  std::string sequence = ReadString(env, payload, "keySequence", "");
  int repeat = std::max(1, ReadInt(payload, "repeat", 1));
  std::vector<std::string> parts = SplitKeySequence(sequence);
  for (int iteration = 0; iteration < repeat; ++iteration) {
    std::vector<KeyCode> modifierCodes;
    std::vector<std::string> normalKeys;
    CGEventFlags flags = 0;
    for (const std::string& part : parts) {
      if (IsModifierName(part)) {
        modifierCodes.push_back(ModifierKeyCode(part));
        flags |= FlagsForModifiers({part});
      } else {
        normalKeys.push_back(part);
      }
    }
    for (KeyCode modifier : modifierCodes) {
      PostKey(modifier, true, flags);
    }
    if (normalKeys.empty() && !modifierCodes.empty()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    for (const std::string& key : normalKeys) {
      if (!SendKeyStroke(key, flags)) {
        Napi::TypeError::New(env, "Unsupported key: " + key).ThrowAsJavaScriptException();
        return env.Undefined();
      }
    }
    for (auto it = modifierCodes.rbegin(); it != modifierCodes.rend(); ++it) {
      PostKey(*it, false, flags);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return BoolResult(info, true);
}

Napi::Value HoldKey(const Napi::CallbackInfo& info) {
  Napi::Object payload = info[0].As<Napi::Object>();
  std::vector<std::string> keyNames = ReadStringArray(payload, "keyNames");
  int durationMs = std::max(0, ReadInt(payload, "durationMs", 0));
  std::vector<KeyCode> codes;
  for (const std::string& name : keyNames) {
    KeyCode code = 0;
    if (LookupKeyCode(name, &code)) {
      codes.push_back(code);
    } else {
      Napi::TypeError::New(info.Env(), "Unsupported key: " + name).ThrowAsJavaScriptException();
      return info.Env().Undefined();
    }
  }
  for (KeyCode code : codes) {
    PostKey(code, true);
  }
  std::this_thread::sleep_for(std::chrono::milliseconds(durationMs));
  for (auto it = codes.rbegin(); it != codes.rend(); ++it) {
    PostKey(*it, false);
  }
  return BoolResult(info, true);
}

Napi::Value TypeText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object payload = info[0].As<Napi::Object>();
  std::string text = ReadString(env, payload, "text", "");
  for (char ch : text) {
    auto it = AsciiMap().find(ch);
    if (it == AsciiMap().end()) {
      Napi::TypeError::New(env, "Native key typing supports ASCII only; use clipboard paste for this text").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    CGEventFlags flags = it->second.shift ? kCGEventFlagMaskShift : 0;
    SendKeyCodeStroke(it->second.code, flags);
    std::this_thread::sleep_for(std::chrono::milliseconds(8));
  }
  return BoolResult(info, true);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isTrustedAccessibilityClient", Napi::Function::New(env, IsTrustedAccessibilityClient));
  exports.Set("cursorPosition", Napi::Function::New(env, CursorPosition));
  exports.Set("moveMouse", Napi::Function::New(env, MoveMouse));
  exports.Set("click", Napi::Function::New(env, Click));
  exports.Set("mouseDown", Napi::Function::New(env, MouseDownAction));
  exports.Set("mouseUp", Napi::Function::New(env, MouseUpAction));
  exports.Set("drag", Napi::Function::New(env, Drag));
  exports.Set("scroll", Napi::Function::New(env, Scroll));
  exports.Set("key", Napi::Function::New(env, KeyAction));
  exports.Set("holdKey", Napi::Function::New(env, HoldKey));
  exports.Set("typeText", Napi::Function::New(env, TypeText));
  exports.Set("frontmostApp", Napi::Function::New(env, FrontmostApp));
  exports.Set("appUnderPoint", Napi::Function::New(env, AppUnderPoint));
  exports.Set("listRunningApps", Napi::Function::New(env, ListRunningApps));
  exports.Set("listInstalledApps", Napi::Function::New(env, ListInstalledApps));
  exports.Set("openApp", Napi::Function::New(env, OpenApp));
  exports.Set("previewHideSet", Napi::Function::New(env, PreviewHideSet));
  exports.Set("prepareForAction", Napi::Function::New(env, PrepareForAction));
  exports.Set("restoreApps", Napi::Function::New(env, RestoreApps));
  exports.Set("findWindowDisplays", Napi::Function::New(env, FindWindowDisplays));
  return exports;
}

}  // namespace

NODE_API_MODULE(kira_mac_computer_use, Init)
