#!/usr/bin/env python3
"""Windows Computer Use helper — same JSON protocol as mac_helper.py.

Uses win32gui / win32api / win32process / psutil / pyperclip / screeninfo
to replicate macOS-specific Quartz/AppKit functionality on Windows.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import mss
from PIL import Image

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault("PYAUTOGUI_HIDE_SUPPORT_PROMPT", "1")

import pyautogui  # noqa: E402

# The desktop app decodes helper stdout as UTF-8. On Windows, redirected Python
# stdout defaults to the active ANSI code page (for example GBK), which mangles
# localized app names from the registry. Force UTF-8 at process start so JSON
# responses stay stable regardless of the user's system locale.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

# ---------------------------------------------------------------------------
# Key mapping — Windows uses 'win' instead of 'command'
# ---------------------------------------------------------------------------
KEY_MAP = {
    "a": "a", "b": "b", "c": "c", "d": "d", "e": "e",
    "f": "f", "g": "g", "h": "h", "i": "i", "j": "j",
    "k": "k", "l": "l", "m": "m", "n": "n", "o": "o",
    "p": "p", "q": "q", "r": "r", "s": "s", "t": "t",
    "u": "u", "v": "v", "w": "w", "x": "x", "y": "y",
    "z": "z",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    # Modifier keys — map macOS names to Windows equivalents
    "cmd": "win",
    "command": "win",
    "meta": "win",
    "super": "win",
    "ctrl": "ctrl",
    "control": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "option": "alt",
    "opt": "alt",
    "fn": "fn",
    # Navigation / editing
    "escape": "esc",
    "esc": "esc",
    "enter": "enter",
    "return": "enter",
    "tab": "tab",
    "space": "space",
    "backspace": "backspace",
    "delete": "delete",
    "forwarddelete": "delete",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "capslock": "capslock",
    # Function keys
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
    # Symbols
    "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\",
    ";": ";", "'": "'", ",": ",", ".": ".", "/": "/", "`": "`",
}


def normalize_key(name: str) -> str:
    key = name.strip().lower()
    if key not in KEY_MAP:
        raise ValueError(f"Unsupported key: {name}")
    return KEY_MAP[key]


# ---------------------------------------------------------------------------
# JSON output helpers
# ---------------------------------------------------------------------------

def json_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


def bool_env(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value not in {"0", "false", "False", ""}


# ---------------------------------------------------------------------------
# Display / Monitor helpers (via screeninfo + ctypes)
# ---------------------------------------------------------------------------

def get_displays() -> list[dict[str, Any]]:
    """Enumerate monitors via screeninfo, with DPI scale from ctypes."""
    from screeninfo import get_monitors

    displays: list[dict[str, Any]] = []
    for idx, m in enumerate(get_monitors()):
        scale_factor = _get_monitor_scale(m)
        name = m.name or f"Display {idx + 1}"
        displays.append({
            "id": idx,
            "displayId": idx,
            "width": m.width,
            "height": m.height,
            "scaleFactor": scale_factor,
            "originX": m.x,
            "originY": m.y,
            "isPrimary": m.is_primary if hasattr(m, "is_primary") else (idx == 0),
            "name": name,
            "label": name,
        })
    return displays


def _get_monitor_scale(monitor: Any) -> float:
    """Get the DPI scale factor for a monitor. Returns 1.0 on failure."""
    try:
        import ctypes
        # SetProcessDPIAware so we get real pixel values
        ctypes.windll.user32.SetProcessDPIAware()
        # Get DPI for the primary — simplified; per-monitor DPI is complex
        hdc = ctypes.windll.user32.GetDC(0)
        dpi = ctypes.windll.gdi32.GetDeviceCaps(hdc, 88)  # LOGPIXELSX
        ctypes.windll.user32.ReleaseDC(0, hdc)
        return dpi / 96.0
    except Exception:
        return 1.0


def choose_display(display_id: int | None) -> dict[str, Any]:
    displays = get_displays()
    if not displays:
        raise RuntimeError("No active displays found")
    if display_id is None:
        for display in displays:
            if display["isPrimary"]:
                return display
        return displays[0]
    for display in displays:
        if display["displayId"] == display_id or display["id"] == display_id:
            return display
    raise RuntimeError(f"Unknown display: {display_id}")


# ---------------------------------------------------------------------------
# Screen capture (mss — cross-platform, identical to mac_helper)
# ---------------------------------------------------------------------------

def capture_display(display_id: int | None, resize: tuple[int, int] | None = None) -> dict[str, Any]:
    display = choose_display(display_id)
    monitor = {
        "left": display["originX"],
        "top": display["originY"],
        "width": display["width"],
        "height": display["height"],
    }
    with mss.mss() as sct:
        raw = sct.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {
        "base64": base64_data,
        "width": image.width,
        "height": image.height,
        "displayWidth": display["width"],
        "displayHeight": display["height"],
        "displayId": display["displayId"],
        "originX": display["originX"],
        "originY": display["originY"],
        "display": display,
    }


def capture_region(region: dict[str, int], resize: tuple[int, int] | None = None) -> dict[str, Any]:
    with mss.mss() as sct:
        raw = sct.grab(region)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    base64_data = base64.b64encode(buffer.getvalue()).decode("ascii")
    return {"base64": base64_data, "width": image.width, "height": image.height}


def crop_patch(image: Image.Image, x_percent: float, y_percent: float, grid_size: int) -> bytes | None:
    if image.width <= 0 or image.height <= 0:
        return None
    clamped_x = max(0.0, min(100.0, x_percent))
    clamped_y = max(0.0, min(100.0, y_percent))
    center_x = round((clamped_x / 100.0) * image.width)
    center_y = round((clamped_y / 100.0) * image.height)
    half = grid_size // 2
    crop_x = max(0, center_x - half)
    crop_y = max(0, center_y - half)
    crop_w = min(grid_size, image.width - crop_x)
    crop_h = min(grid_size, image.height - crop_y)
    if crop_w <= 0 or crop_h <= 0:
        return None
    return image.crop((crop_x, crop_y, crop_x + crop_w, crop_y + crop_h)).convert("RGB").tobytes()


def validate_click_target(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        last_base64 = str(payload.get("lastScreenshotBase64") or "")
        last_path = Path(str(payload.get("lastScreenshotPath") or ""))
        target_width = int(payload.get("targetWidth") or 0)
        target_height = int(payload.get("targetHeight") or 0)
        if target_width <= 0 or target_height <= 0:
            return {"valid": True, "skipped": True}
        x_percent = float(payload.get("xPercent") or 0.0)
        y_percent = float(payload.get("yPercent") or 0.0)
        grid_size = int(payload.get("gridSize") or 9)
        if last_base64:
            last_image = Image.open(BytesIO(base64.b64decode(last_base64))).convert("RGB")
        elif last_path.exists():
            last_image = Image.open(last_path).convert("RGB")
        else:
            return {"valid": True, "skipped": True}
        fresh = capture_display(payload.get("displayId"), (target_width, target_height))
        fresh_image = Image.open(BytesIO(base64.b64decode(fresh["base64"]))).convert("RGB")
        last_patch = crop_patch(last_image, x_percent, y_percent, grid_size)
        fresh_patch = crop_patch(fresh_image, x_percent, y_percent, grid_size)
        if last_patch is None or fresh_patch is None:
            return {"valid": True, "skipped": True}
        if last_patch == fresh_patch:
            return {"valid": True, "skipped": False}
        return {
            "valid": False,
            "skipped": False,
            "warning": "Screen content at the target location changed since the last screenshot. Take a new screenshot before clicking.",
        }
    except Exception:
        return {"valid": True, "skipped": True}


# ---------------------------------------------------------------------------
# Window management (win32gui)
# ---------------------------------------------------------------------------

def list_windows() -> list[dict[str, Any]]:
    """List visible on-screen windows with their bounds."""
    import win32gui

    results: list[dict[str, Any]] = []

    def _enum_cb(hwnd: int, _: Any) -> None:
        if not win32gui.IsWindowVisible(hwnd):
            return
        title = win32gui.GetWindowText(hwnd)
        try:
            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
        except Exception:
            return
        width = right - left
        height = bottom - top
        if width <= 1 or height <= 1:
            return
        # Get the process name as owner
        owner = _get_window_process_name(hwnd)
        results.append({
            "hwnd": hwnd,
            "ownerName": owner,
            "title": title,
            "bounds": {"x": left, "y": top, "width": width, "height": height},
        })

    win32gui.EnumWindows(_enum_cb, None)
    return results


def _get_window_process_name(hwnd: int) -> str:
    """Get the exe name of the process owning a window handle."""
    try:
        import win32process
        import psutil
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        return proc.name()
    except Exception:
        return ""


def _get_window_process_info(hwnd: int) -> dict[str, str] | None:
    try:
        import win32process
        import psutil

        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        bundle_id = Path(exe_path).stem if exe_path else Path(proc.name()).stem
        return {
            "bundleId": bundle_id,
            "displayName": proc.name(),
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Application management
# ---------------------------------------------------------------------------

def _get_exe_path_for_pid(pid: int) -> str | None:
    try:
        import psutil
        return psutil.Process(pid).exe()
    except Exception:
        return None


def installed_apps() -> list[dict[str, Any]]:
    """List installed programs from Windows registry and Start Menu shortcuts."""
    import winreg

    results: dict[str, dict[str, Any]] = {}
    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]

    for hive, sub_key in reg_paths:
        try:
            key = winreg.OpenKey(hive, sub_key)
        except OSError:
            continue
        try:
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                    i += 1
                except OSError:
                    break
                try:
                    app_key = winreg.OpenKey(key, name)
                except OSError:
                    continue
                try:
                    display_name = winreg.QueryValueEx(app_key, "DisplayName")[0]
                except OSError:
                    winreg.CloseKey(app_key)
                    continue
                # Use the registry key name as a stable identifier (like bundleId)
                try:
                    install_location = winreg.QueryValueEx(app_key, "InstallLocation")[0]
                except OSError:
                    install_location = ""
                try:
                    display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                except OSError:
                    display_icon = ""
                normalized_icon = str(display_icon).split(",")[0].strip().strip('"')
                normalized_install_location = str(install_location).strip().strip('"')

                bundle_id = name
                for candidate in (normalized_icon, normalized_install_location):
                    if not candidate:
                        continue
                    candidate_path = Path(candidate)
                    if candidate_path.suffix.lower() == ".exe":
                        bundle_id = candidate_path.stem
                        break

                app_path = normalized_icon or normalized_install_location or ""
                if bundle_id not in results:
                    results[bundle_id] = {
                        "bundleId": bundle_id,
                        "displayName": str(display_name),
                        "path": app_path,
                    }
                winreg.CloseKey(app_key)
        finally:
            winreg.CloseKey(key)

    return sorted(results.values(), key=lambda item: item["displayName"].lower())


def running_apps() -> list[dict[str, Any]]:
    """List running GUI applications."""
    import psutil

    apps: list[dict[str, Any]] = []
    seen: set[str] = set()

    for proc in psutil.process_iter(["pid", "name", "exe"]):
        try:
            name = proc.info["name"] or ""
            exe_path = proc.info["exe"] or ""
            if not name or name in seen:
                continue
            # Skip system/background processes (no window)
            if not exe_path:
                continue
            seen.add(name)
            # Use exe name (without .exe) as bundleId
            bundle_id = Path(exe_path).stem if exe_path else name
            apps.append({"bundleId": bundle_id, "displayName": name})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return sorted(apps, key=lambda item: item["displayName"].lower())


def app_display_name(bundle_id: str) -> str | None:
    """Find display name for a given bundleId (exe stem or registry key)."""
    import psutil
    for proc in psutil.process_iter(["name", "exe"]):
        try:
            exe = proc.info["exe"] or ""
            if exe and Path(exe).stem == bundle_id:
                return proc.info["name"]
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return None


def frontmost_app() -> dict[str, str] | None:
    """Get the currently focused (foreground) application."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return None


def app_under_point(x: int, y: int) -> dict[str, str] | None:
    """Find the app whose window is under the given screen coordinate."""
    import win32gui
    import win32process
    import psutil

    hwnd = win32gui.WindowFromPoint((x, y))
    if not hwnd:
        return frontmost_app()
    # Walk up to the top-level owner
    root = win32gui.GetAncestor(hwnd, 3)  # GA_ROOTOWNER = 3
    if root:
        hwnd = root
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        proc = psutil.Process(pid)
        exe_path = proc.exe()
        return {
            "bundleId": Path(exe_path).stem,
            "displayName": proc.name(),
        }
    except Exception:
        return frontmost_app()


def find_window_displays(bundle_ids: list[str]) -> list[dict[str, Any]]:
    """For each bundleId, find which display(s) its windows are on."""
    if not bundle_ids:
        return []

    displays = get_displays()
    windows = list_windows()

    # Build exe-stem -> ownerName mapping
    names_by_bundle: dict[str, str | None] = {}
    for bid in bundle_ids:
        names_by_bundle[bid] = app_display_name(bid)

    result = []
    for bundle_id in bundle_ids:
        target_name = names_by_bundle.get(bundle_id)
        display_ids: set[int] = set()
        for window in windows:
            owner = window["ownerName"]
            if not owner:
                continue
            # Match by exe name
            owner_stem = Path(owner).stem if owner.endswith(".exe") else owner
            if target_name and owner != target_name and owner_stem != bundle_id:
                continue
            if not target_name and owner_stem != bundle_id and owner != bundle_id:
                continue
            # Check which displays this window overlaps
            wx = window["bounds"]["x"]
            wy = window["bounds"]["y"]
            ww = window["bounds"]["width"]
            wh = window["bounds"]["height"]
            for display in displays:
                dx = display["originX"]
                dy = display["originY"]
                dw = display["width"]
                dh = display["height"]
                # Check rectangle intersection
                if wx < dx + dw and wx + ww > dx and wy < dy + dh and wy + wh > dy:
                    display_ids.add(int(display["displayId"]))
        result.append({"bundleId": bundle_id, "displayIds": sorted(display_ids)})
    return result


SYSTEM_HIDE_EXEMPT_NAMES = {
    "applicationframehost",
    "dwm",
    "explorer",
    "kira",
    "lockapp",
    "searchhost",
    "shellexperiencehost",
    "startmenuexperiencehost",
    "systemsettings",
    "taskmgr",
    "textinputhost",
    "widgets",
    "windowsterminal",
}


def _window_intersects_display(window: dict[str, Any], display_id: int | None) -> bool:
    if display_id is None:
        return True
    display = choose_display(display_id)
    bounds = window["bounds"]
    wx = bounds["x"]
    wy = bounds["y"]
    ww = bounds["width"]
    wh = bounds["height"]
    dx = display["originX"]
    dy = display["originY"]
    dw = display["width"]
    dh = display["height"]
    return wx < dx + dw and wx + ww > dx and wy < dy + dh and wy + wh > dy


def _hide_candidates(exempt_bundle_ids: list[str], display_id: int | None) -> list[dict[str, Any]]:
    exempt = {str(item).lower() for item in exempt_bundle_ids if item}
    candidates: dict[str, dict[str, Any]] = {}
    for window in list_windows():
        if not _window_intersects_display(window, display_id):
            continue
        hwnd = int(window.get("hwnd") or 0)
        if hwnd <= 0:
            continue
        app = _get_window_process_info(hwnd)
        if not app:
            continue
        bundle_id = app["bundleId"]
        normalized = bundle_id.lower()
        display_name = app["displayName"]
        if normalized in exempt or display_name.lower() in exempt or normalized in SYSTEM_HIDE_EXEMPT_NAMES:
            continue
        existing = candidates.setdefault(bundle_id, {
            "bundleId": bundle_id,
            "displayName": display_name,
            "hwnds": [],
        })
        existing["hwnds"].append(hwnd)
    return sorted(candidates.values(), key=lambda item: str(item["displayName"]).lower())


def preview_hide_set(exempt_bundle_ids: list[str], display_id: int | None) -> list[dict[str, str]]:
    return [
        {"bundleId": item["bundleId"], "displayName": item["displayName"]}
        for item in _hide_candidates(exempt_bundle_ids, display_id)
    ]


def prepare_for_action(exempt_bundle_ids: list[str], display_id: int | None) -> list[str]:
    import win32con
    import win32gui

    hidden: list[str] = []
    for target in _hide_candidates(exempt_bundle_ids, display_id):
        bundle_id = str(target["bundleId"])
        did_hide = False
        for hwnd in target.get("hwnds") or []:
            try:
                win32gui.ShowWindow(int(hwnd), win32con.SW_MINIMIZE)
                did_hide = True
            except Exception:
                continue
        if did_hide:
            hidden.append(bundle_id)
    return hidden


def restore_apps(bundle_ids: list[str]) -> list[str]:
    import win32con
    import win32gui

    requested = {str(item).lower() for item in bundle_ids if item}
    if not requested:
        return []
    restored: set[str] = set()
    for window in list_windows():
        hwnd = int(window.get("hwnd") or 0)
        if hwnd <= 0:
            continue
        app = _get_window_process_info(hwnd)
        if not app:
            continue
        bundle_id = app["bundleId"]
        if bundle_id.lower() not in requested and app["displayName"].lower() not in requested:
            continue
        try:
            win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
            restored.add(bundle_id)
        except Exception:
            continue
    return sorted(restored)


def open_app(bundle_id: str) -> None:
    """Open an application by its bundleId (exe path or program name)."""
    # Try to find the exe path from registry
    import winreg
    exe_path = None

    reg_paths = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, sub_key in reg_paths:
        try:
            key = winreg.OpenKey(hive, sub_key)
            i = 0
            while True:
                try:
                    name = winreg.EnumKey(key, i)
                    i += 1
                except OSError:
                    break
                try:
                    app_key = winreg.OpenKey(key, name)
                except OSError:
                    continue
                try:
                    display_icon = winreg.QueryValueEx(app_key, "DisplayIcon")[0]
                except OSError:
                    display_icon = ""
                try:
                    install_location = winreg.QueryValueEx(app_key, "InstallLocation")[0]
                except OSError:
                    install_location = ""

                normalized_icon = str(display_icon).split(",")[0].strip().strip('"')
                normalized_install_location = str(install_location).strip().strip('"')

                derived_bundle_id = name
                for candidate in (normalized_icon, normalized_install_location):
                    if not candidate:
                        continue
                    candidate_path = Path(candidate)
                    if candidate_path.suffix.lower() == ".exe":
                        derived_bundle_id = candidate_path.stem
                        break

                if name == bundle_id or derived_bundle_id == bundle_id:
                    exe_path = normalized_icon or normalized_install_location or None
                    winreg.CloseKey(app_key)
                    break
                winreg.CloseKey(app_key)
            winreg.CloseKey(key)
            if exe_path:
                break
        except OSError:
            continue

    if exe_path and Path(exe_path).exists():
        os.startfile(exe_path)
    else:
        # Fallback: try to run it directly
        try:
            subprocess.Popen([bundle_id], shell=True)
        except Exception:
            raise RuntimeError(f"App not found for identifier: {bundle_id}")


# ---------------------------------------------------------------------------
# Clipboard (pyperclip — cross-platform)
# ---------------------------------------------------------------------------

def read_clipboard() -> str:
    import pyperclip
    try:
        return pyperclip.paste() or ""
    except Exception:
        return ""


def write_clipboard(text: str) -> None:
    import pyperclip
    pyperclip.copy(text)


def paste_clipboard() -> None:
    pyautogui.hotkey("ctrl", "v", interval=0.02)


def paste_text(text: str) -> None:
    original = read_clipboard()
    try:
        write_clipboard(text)
        paste_clipboard()
        time.sleep(0.10)
    finally:
        try:
            write_clipboard(original)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Permissions — Windows doesn't have macOS-style TCC
# ---------------------------------------------------------------------------

def check_permissions() -> dict[str, bool | None]:
    """Windows does not require explicit accessibility/screen-recording
    permissions like macOS TCC. Always report as granted."""
    return {
        "accessibility": True,
        "screenRecording": True,
    }


# ---------------------------------------------------------------------------
# Input actions (pyautogui — identical to mac_helper)
# ---------------------------------------------------------------------------

def click(x: int, y: int, button: str, count: int, modifiers: list[str] | None) -> None:
    pyautogui.moveTo(x, y)
    if modifiers:
        normalized = [normalize_key(m) for m in modifiers]
        for key in normalized:
            pyautogui.keyDown(key)
        try:
            pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)
        finally:
            for key in reversed(normalized):
                pyautogui.keyUp(key)
    else:
        pyautogui.click(x=x, y=y, button=button, clicks=count, interval=0.08)


def scroll(x: int, y: int, delta_x: int, delta_y: int) -> None:
    pyautogui.moveTo(x, y)
    if delta_y:
        pyautogui.scroll(int(delta_y), x=x, y=y)
    if delta_x:
        pyautogui.hscroll(int(delta_x), x=x, y=y)


def key_action(sequence: str, repeat: int = 1) -> None:
    parts = [normalize_key(part) for part in sequence.split("+") if part.strip()]
    for _ in range(max(1, repeat)):
        if len(parts) == 1:
            pyautogui.press(parts[0])
        else:
            pyautogui.hotkey(*parts, interval=0.02)
        time.sleep(0.01)


def hold_keys(keys: list[str], duration_ms: int) -> None:
    normalized = [normalize_key(k) for k in keys]
    for key in normalized:
        pyautogui.keyDown(key)
    try:
        time.sleep(max(duration_ms, 0) / 1000)
    finally:
        for key in reversed(normalized):
            pyautogui.keyUp(key)


def type_text(text: str) -> None:
    pyautogui.write(text, interval=0.008)


# ---------------------------------------------------------------------------
# Main dispatcher — exact same command protocol as mac_helper.py
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    payload = json.loads(args.payload)

    try:
        command = args.command
        if command == "check_permissions":
            perms = check_permissions()
            json_output({"ok": True, "result": perms})
            return 0
        if command == "list_displays":
            json_output({"ok": True, "result": get_displays()})
            return 0
        if command == "get_display_size":
            json_output({"ok": True, "result": choose_display(payload.get("displayId"))})
            return 0
        if command == "screenshot":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("displayId"), resize)
            json_output({"ok": True, "result": result})
            return 0
        if command == "resolve_prepare_capture":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            result = capture_display(payload.get("preferredDisplayId"), resize)
            result["hidden"] = []
            result["resolvedDisplayId"] = result["displayId"]
            json_output({"ok": True, "result": result})
            return 0
        if command == "zoom":
            resize = None
            if payload.get("targetWidth") and payload.get("targetHeight"):
                resize = (int(payload["targetWidth"]), int(payload["targetHeight"]))
            region = {
                "left": int(payload["x"]),
                "top": int(payload["y"]),
                "width": int(payload["width"]),
                "height": int(payload["height"]),
            }
            json_output({"ok": True, "result": capture_region(region, resize)})
            return 0
        if command == "validate_click_target":
            json_output({"ok": True, "result": validate_click_target(payload)})
            return 0
        if command == "prepare_for_action":
            json_output({"ok": True, "result": prepare_for_action(
                list(payload.get("exemptBundleIds") or []),
                payload.get("displayId"),
            )})
            return 0
        if command == "preview_hide_set":
            json_output({"ok": True, "result": preview_hide_set(
                list(payload.get("exemptBundleIds") or []),
                payload.get("displayId"),
            )})
            return 0
        if command == "restore_apps":
            json_output({"ok": True, "result": restore_apps(list(payload.get("bundleIds") or []))})
            return 0
        if command == "find_window_displays":
            json_output({"ok": True, "result": find_window_displays(list(payload.get("bundleIds") or []))})
            return 0
        if command == "key":
            key_action(str(payload["keySequence"]), int(payload.get("repeat") or 1))
            json_output({"ok": True, "result": True})
            return 0
        if command == "hold_key":
            hold_keys(list(payload.get("keyNames") or []), int(payload.get("durationMs") or 0))
            json_output({"ok": True, "result": True})
            return 0
        if command == "type":
            type_text(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        if command == "click":
            click(int(payload["x"]), int(payload["y"]), str(payload.get("button") or "left"), int(payload.get("count") or 1), payload.get("modifiers"))
            json_output({"ok": True, "result": True})
            return 0
        if command == "drag":
            from_point = payload.get("from")
            if from_point:
                pyautogui.moveTo(int(from_point["x"]), int(from_point["y"]))
            pyautogui.dragTo(int(payload["to"]["x"]), int(payload["to"]["y"]), duration=0.2, button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "move_mouse":
            pyautogui.moveTo(int(payload["x"]), int(payload["y"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "scroll":
            scroll(int(payload["x"]), int(payload["y"]), int(payload.get("deltaX") or 0), int(payload.get("deltaY") or 0))
            json_output({"ok": True, "result": True})
            return 0
        if command == "mouse_down":
            pyautogui.mouseDown(button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "mouse_up":
            pyautogui.mouseUp(button="left")
            json_output({"ok": True, "result": True})
            return 0
        if command == "cursor_position":
            x, y = pyautogui.position()
            json_output({"ok": True, "result": {"x": int(x), "y": int(y)}})
            return 0
        if command == "frontmost_app":
            json_output({"ok": True, "result": frontmost_app()})
            return 0
        if command == "app_under_point":
            json_output({"ok": True, "result": app_under_point(int(payload["x"]), int(payload["y"]))})
            return 0
        if command == "list_installed_apps":
            json_output({"ok": True, "result": installed_apps()})
            return 0
        if command == "list_running_apps":
            json_output({"ok": True, "result": running_apps()})
            return 0
        if command == "open_app":
            open_app(str(payload["bundleId"]))
            json_output({"ok": True, "result": True})
            return 0
        if command == "read_clipboard":
            json_output({"ok": True, "result": read_clipboard()})
            return 0
        if command == "write_clipboard":
            write_clipboard(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        if command == "paste_clipboard":
            paste_clipboard()
            json_output({"ok": True, "result": True})
            return 0
        if command == "paste_text":
            paste_text(str(payload.get("text") or ""))
            json_output({"ok": True, "result": True})
            return 0
        error_output(f"Unknown command: {command}", code="bad_command")
        return 2
    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
