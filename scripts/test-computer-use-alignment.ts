import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureKiraWorkspace } from "../src/core/kira-workspace.ts";
import { executeComputerUse, getComputerUseSessionState, parseComputerUseInput, releaseComputerUseSession } from "../src/core/tools/computer-use.ts";
import { isSystemComputerUseKeyCombo, normalizeComputerUseKeySequence } from "../src/core/tools/computer-use-keys.ts";
import {
  buildComputerUsePolicyDeniedGuidance,
  buildComputerUseTierGuidance,
  evaluateComputerUseAppPolicy,
  getDefaultComputerUseTier
} from "../src/core/tools/computer-use-policy.ts";
import { listInstalledAppsForDescription } from "../src/core/tools/computer-use-installed-apps.ts";
import { checkToolPermission, executeRegisteredTool } from "../src/core/tools/registry.ts";
import { getBuiltinToolDefinitions } from "../src/core/tools/registry.ts";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function appsDescription(tool: { inputSchema: Record<string, unknown> }): string {
  const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
  const apps = properties?.apps as Record<string, unknown> | undefined;
  return typeof apps?.description === "string" ? apps.description : "";
}

const magiComputerUseToolNames = [
  "request_access",
  "screenshot",
  "zoom",
  "left_click",
  "double_click",
  "triple_click",
  "right_click",
  "middle_click",
  "type",
  "key",
  "scroll",
  "left_click_drag",
  "mouse_move",
  "open_application",
  "switch_display",
  "list_granted_applications",
  "read_clipboard",
  "write_clipboard",
  "wait",
  "cursor_position",
  "hold_key",
  "left_mouse_down",
  "left_mouse_up",
  "computer_batch",
  "request_teach_access",
  "teach_step",
  "teach_batch"
] as const;

const magiBatchActionEnum = [
  "key",
  "type",
  "mouse_move",
  "left_click",
  "left_click_drag",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "scroll",
  "hold_key",
  "screenshot",
  "cursor_position",
  "left_mouse_down",
  "left_mouse_up",
  "wait"
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : [];
}

function summarizeComputerUseToolContract(tool: { name: string; inputSchema: Record<string, unknown> }): Record<string, unknown> {
  const properties = asRecord(tool.inputSchema.properties);
  const actions = asRecord(properties.actions);
  const actionProperty = asRecord(asRecord(asRecord(actions.items).properties).action);
  const steps = asRecord(properties.steps);
  const stepItem = asRecord(steps.items);
  const stepProperties = asRecord(stepItem.properties);
  const stepActions = asRecord(stepProperties.actions);
  const stepActionProperty = asRecord(asRecord(asRecord(stepActions.items).properties).action);

  return {
    name: tool.name,
    required: stringArray(tool.inputSchema.required),
    props: Object.keys(properties),
    ...(stringArray(actionProperty.enum).length ? { actionEnum: stringArray(actionProperty.enum) } : {}),
    ...(Object.keys(stepProperties).length ? { stepProps: Object.keys(stepProperties) } : {}),
    ...(stringArray(stepItem.required).length ? { stepRequired: stringArray(stepItem.required) } : {}),
    ...(stringArray(stepActionProperty.enum).length ? { stepActionEnum: stringArray(stepActionProperty.enum) } : {})
  };
}

async function main(): Promise<void> {
  const computerUse = read("src/core/tools/computer-use.ts");
  assert.match(computerUse, /callComputerUseHelper/);
  assert.match(computerUse, /display_info/);
  assert.match(computerUse, /switch_display/);
  assert.match(computerUse, /zoom/);
  assert.match(computerUse, /request_access/);
  assert.match(computerUse, /request_teach_access/);
  assert.match(computerUse, /teach_step/);
  assert.match(computerUse, /teach_batch/);
  assert.match(computerUse, /teachModeBySession/);
  assert.match(computerUse, /executeComputerUseTeachStep/);
  assert.match(computerUse, /executeComputerUseTeachBatch/);
  assert.match(computerUse, /list_granted_apps/);
  assert.match(computerUse, /takeZoom/);
  assert.match(computerUse, /Click coordinates still refer to the full screenshot/);
  assert.match(computerUse, /permissions/);
  assert.match(computerUse, /cursor_position/);
  assert.match(computerUse, /getCursorPosition/);
  assert.match(computerUse, /coordinateSpace: "image_pixels"/);
  assert.match(computerUse, /cursor is on a different monitor than your last screenshot/);
  assert.match(computerUse, /scroll/);
  assert.match(computerUse, /left_mouse_down/);
  assert.match(computerUse, /left_mouse_up/);
  assert.match(computerUse, /hold_key/);
  assert.match(computerUse, /triple_click/);
  assert.match(computerUse, /middle_click/);
  assert.match(computerUse, /read_clipboard/);
  assert.match(computerUse, /write_clipboard/);
  assert.match(computerUse, /parseKeySequence/);
  assert.match(computerUse, /mouseHoldStateBySession/);
  assert.match(computerUse, /getMouseHoldState/);
  assert.match(computerUse, /releaseHeldMouse/);
  assert.match(computerUse, /mouse button already held, call left_mouse_up first/);
  assert.match(computerUse, /Mouse button pressed/);
  assert.match(computerUse, /Mouse button released/);
  assert.match(computerUse, /open_app/);
  assert.match(computerUse, /open_application/);
  assert.match(computerUse, /list_granted_applications/);
  assert.match(computerUse, /computer_batch/);
  assert.match(computerUse, /left_click_drag/);
  assert.match(computerUse, /normalizeComputerUseInputShape/);
  assert.match(computerUse, /Magi-compatible action aliases are accepted/);
  assert.match(computerUse, /batch/);
  assert.match(computerUse, /executeComputerUseBatch/);
  assert.match(computerUse, /Mid-batch screenshot/);
  assert.match(computerUse, /skipDesktopPrepare: true/);
  assert.match(computerUse, /skipClickFreshness: true/);
  assert.match(computerUse, /failed: \{/);
  assert.match(computerUse, /remaining: actions\.length - completed\.length - 1/);
  assert.match(computerUse, /enforceInputPolicy/);
  assert.match(computerUse, /enforceObservedAppPolicy/);
  assert.match(computerUse, /enforceTargetPolicy/);
  assert.match(computerUse, /mergePolicyChecks/);
  assert.match(computerUse, /frontmost_app/);
  assert.match(computerUse, /app_under_point/);
  assert.match(computerUse, /Take a fresh screenshot if the window layout changed/);
  assert.match(computerUse, /Click at these coordinates would land on/);
  assert.match(computerUse, /currently in front/);
  assert.match(computerUse, /Do not try to bypass this restriction/);
  assert.match(computerUse, /FINDER_BUNDLE_ID/);
  assert.match(computerUse, /targetImageSize/);
  assert.match(computerUse, /Kira handles all display scaling/);
  assert.match(computerUse, /screenshotsBySession/);
  assert.match(computerUse, /selectedDisplaysBySession/);
  assert.match(computerUse, /displayPinnedBySession/);
  assert.match(computerUse, /displayResolvedForAppsBySession/);
  assert.match(computerUse, /switchComputerUseDisplay/);
  assert.match(computerUse, /resolveScreenshotDisplayId/);
  assert.match(computerUse, /resolveDisplayForGrantedApps/);
  assert.match(computerUse, /find_window_displays/);
  assert.match(computerUse, /pinComputerUseDisplay/);
  assert.match(computerUse, /clearComputerUseDisplaySelection/);
  assert.match(computerUse, /uniqueDisplayLabels/);
  assert.match(computerUse, /buildMonitorNote/);
  assert.match(computerUse, /Other attached monitors/);
  assert.match(computerUse, /Use switch_display to capture a different monitor/);
  assert.match(computerUse, /display selection reset to auto/);
  assert.match(computerUse, /getLastScreenshot\(context\)/);
  assert.match(computerUse, /setLastScreenshot\(context, screenshot\)/);
  assert.match(computerUse, /scalePoint\(rawX: number, rawY: number, context: ComputerUseContext\)/);
  assert.match(computerUse, /scalePoint/);
  assert.match(computerUse, /MIN_SCREENSHOT_BYTES/);
  assert.match(computerUse, /validateClickFreshness/);
  assert.match(computerUse, /validate_click_target/);
  assert.match(computerUse, /options: \{ targetActionKind\?: ComputerUseActionKind \} = \{\}/);
  assert.match(computerUse, /const targetActionKind = options\.targetActionKind \?\? actionKind/);
  assert.match(computerUse, /moveState\.held \? "mouse" : "mouse_position"/);
  assert.match(computerUse, /targetActionKind: moveState\.held \? "mouse_full" : "mouse_position"/);
  assert.match(computerUse, /targetActionKind: "mouse_full"/);
  assert.match(computerUse, /const scrollPolicy = await enforceInputPolicy\(input, context, "mouse", scrollPoint/);
  assert.match(computerUse, /targetActionKind: scrollState\.held \? "mouse_full" : "mouse"/);
  assert.match(computerUse, /policy = await enforceInputPolicy\(input, context, "mouse", cursor, \{\n      targetActionKind: state\.moved \? "mouse_full" : "mouse"\n    \}\)/);
  assert.doesNotMatch(computerUse, /async function leftMouseUp[\s\S]{0,300}if \(!state\.held\) \{\n    await helper\("mouse_up"/);
  assert.match(computerUse, /catch \(error\) \{\n    if \(state\.held\) \{\n      await releaseHeldMouse\(context, true\);\n    \}\n    throw error;\n  \}/);
  assert.match(computerUse, /validateMagiDurationSeconds/);
  assert.match(computerUse, /lastScreenshotBase64/);
  assert.match(computerUse, /lastScreenshotPath/);
  assert.match(computerUse, /input\.save_to_disk === true/);
  assert.match(computerUse, /saveImageFile/);
  assert.match(computerUse, /write_clipboard/);
  assert.match(computerUse, /paste_text/);
  assert.match(computerUse, /const MOVE_SETTLE_MS = 50/);
  assert.match(computerUse, /const COMPUTER_USE_BATCH_ACTIONS = \[/);
  assert.match(computerUse, /const NORMALIZED_COMPUTER_USE_BATCH_ACTIONS = new Set<ComputerUseBatchAction>/);
  assert.match(computerUse, /enum: COMPUTER_USE_BATCH_ACTIONS/);
  const batchActionBlock = computerUse.match(/const COMPUTER_USE_BATCH_ACTIONS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
  assert.doesNotMatch(batchActionBlock, /"hotkey"/);
  assert.doesNotMatch(batchActionBlock, /"frontmost_app"/);
  assert.doesNotMatch(batchActionBlock, /"app_under_point"/);
  assert.doesNotMatch(batchActionBlock, /"click"/);
  assert.doesNotMatch(batchActionBlock, /"move"/);
  assert.doesNotMatch(batchActionBlock, /"drag"/);
  assert.match(batchActionBlock, /"left_click"/);
  assert.match(batchActionBlock, /"mouse_move"/);
  assert.match(batchActionBlock, /"left_click_drag"/);
  assert.match(computerUse, /await helper\("click"[\s\S]{0,500}await wait\(MOVE_SETTLE_MS\)/);
  assert.match(computerUse, /await helper\("move_mouse", movePoint, context\);\n      await wait\(MOVE_SETTLE_MS\)/);
  assert.match(computerUse, /await helper\("drag"[\s\S]{0,360}await wait\(MOVE_SETTLE_MS\)/);
  assert.match(computerUse, /Post-action screenshot/);
  assert.match(computerUse, /includePostActionScreenshot/);
  assert.match(computerUse, /includePostActionScreenshot !== true/);
  assert.match(computerUse, /Teach steps return their own final screenshot when actions run/);
  assert.match(computerUse, /return formatJson\(\{ completed \}\);/);
  assert.match(computerUse, /function withPostActionScreenshot/);
  assert.match(computerUse, /includeFinalScreenshot\?: boolean/);
  assert.match(computerUse, /includeFinalScreenshot: false/);
  assert.match(computerUse, /return options\.includeFinalScreenshot === false \? message : withPostActionScreenshot/);
  assert.match(computerUse, /parseBatchResultPayload/);
  assert.match(computerUse, /parseAccessResultPayload/);
  assert.match(computerUse, /parseTeachStepResultPayload/);
  assert.match(computerUse, /stepsCompleted/);
  assert.match(computerUse, /stepFailed/);
  assert.match(computerUse, /teachModeActive/);
  assert.doesNotMatch(computerUse, /next: "Call screenshot next\. Subsequent control actions are limited to granted apps and their tiers\."/);
  assert.doesNotMatch(computerUse, /next: "Use teach_step or teach_batch next\./);
  assert.match(computerUse, /read_clipboard/);
  assert.match(computerUse, /readClipboardWithClickTierGuard/);
  assert.match(computerUse, /await syncClipboardStash\(context, frontmost \? findGrantForApp\(frontmost, context\)\?\.tier === "click" : false\)/);
  assert.match(computerUse, /await helper\("write_clipboard", \{ text: "" \}, context\)/);
  assert.match(computerUse, /clipboardStashBySession/);
  assert.match(computerUse, /syncClipboardStash/);
  assert.match(computerUse, /restoreClipboardStash/);
  assert.match(computerUse, /restoreComputerUseClipboard/);
  assert.match(computerUse, /Best effort: keep the stash so the next non-click-tier action can retry/);
  assert.match(computerUse, /assertClipboardWriteAllowed/);
  assert.match(computerUse, /write_clipboard is blocked because the next action would clear the clipboard anyway/);
  assert.match(computerUse, /a UI Paste button in this app cannot be used to inject text/);
  assert.match(computerUse, /windowLocations/);
  assert.match(computerUse, /checkComputerUseLock/);
  assert.match(computerUse, /acquireComputerUseLock/);
  assert.match(computerUse, /releaseComputerUseSession/);
  assert.match(computerUse, /defersComputerUseLockAcquire/);
  assert.match(computerUse, /action === "request_access" \|\| action === "list_granted_apps"/);
  assert.doesNotMatch(computerUse, /withComputerUseLock/);
  assert.match(computerUse, /resolveGrantedApp/);
  assert.match(computerUse, /zoom region exceeds screenshot bounds/);
  assert.match(computerUse, /blockSystemKeyCombo/);
  assert.match(computerUse, /Target app:/);
  assert.match(computerUse, /Target apps:/);
  assert.match(computerUse, /grantsBySession/);
  assert.match(computerUse, /computerUseSessionKey/);
  assert.match(computerUse, /requestComputerUseAccess/);
  assert.match(computerUse, /Call ComputerUse request_access first/);
  assert.match(computerUse, /requireComputerUseAllowlist/);
  assert.match(computerUse, /No applications are granted for this Computer Use session/);
  assert.match(computerUse, /grantFlagsBySession/);
  assert.match(computerUse, /resetComputerUseTurnState/);
  assert.match(computerUse, /getComputerUseSessionState/);
  assert.match(computerUse, /shouldHideHostWindowForAction/);
  assert.match(computerUse, /shouldPrepareDesktopForAction/);
  assert.match(computerUse, /hideHostWindow/);
  assert.match(computerUse, /hiddenAppsBySession/);
  assert.match(computerUse, /hiddenSinceLastScreenshotBySession/);
  assert.match(computerUse, /previousScreenshot \? await consumeHiddenAppsNote\(context\) : clearHiddenAppsNote\(context\)/);
  assert.match(computerUse, /function clearHiddenAppsNote/);
  assert.match(computerUse, /if \(displays\.length <= 1\) return \[\]/);
  assert.match(computerUse, /prepareDesktopForAction/);
  assert.match(computerUse, /const displayId = await resolveScreenshotDisplayId\(input, context\);\n  if \(!options\.skipDesktopPrepare\) \{\n    await prepareDesktopForAction\(context, displayId\);\n  \}/);
  assert.match(computerUse, /case "screenshot":\n      return formatScreenshot\(await takeScreenshot\(input, context, options\), input, context\.cwd\);/);
  assert.match(computerUse, /function shouldPrepareDesktopForAction\(action: ComputerUseAction\): boolean \{\n  return action === "frontmost_app"/);
  assert.doesNotMatch(computerUse, /function shouldPrepareDesktopForAction\(action: ComputerUseAction\): boolean \{\n  return action === "screenshot"/);
  assert.match(computerUse, /async function prepareDesktopForAction\(context: ComputerUseContext, displayId = effectiveDisplayId\(\{ action: "screenshot" \}, context\)\): Promise<void>/);
  assert.match(computerUse, /previewComputerUseHideSet/);
  assert.match(computerUse, /restoreComputerUseHiddenApps/);
  assert.match(computerUse, /prepare_for_action/);
  assert.match(computerUse, /preview_hide_set/);
  assert.match(computerUse, /ComputerUseApprovalPreview/);
  assert.match(computerUse, /previewComputerUseApproval/);
  assert.match(computerUse, /restore_apps/);
  assert.match(computerUse, /FAST_APP_LIST_TIMEOUT_MS/);
  assert.match(computerUse, /list_installed_apps", \{\}, context, \{ timeoutMs: FAST_APP_LIST_TIMEOUT_MS \}/);
  assert.match(computerUse, /willHide/);
  assert.match(computerUse, /policyDenied/);
  assert.match(computerUse, /userDenied/);
  assert.match(computerUse, /tierGuidance/);
  assert.match(computerUse, /screenshotFiltering/);
  assert.match(computerUse, /got hidden before this screenshot/);
  assert.match(computerUse, /approvalResponse/);
  assert.match(computerUse, /approvalGrantedApps/);
  assert.match(computerUse, /approvalDeniedApps/);
  assert.match(computerUse, /const requestedKeys = approvalKeysForValue\(requested\)/);
  assert.match(computerUse, /approvalKeysForValue/);
  assert.match(computerUse, /builtInAppForApproval/);
  assert.match(computerUse, /bundleId: SAFARI_BUNDLE_ID, displayName: "Safari"/);
  assert.match(computerUse, /granted\?: ComputerUseAppGrant\[\]/);
  assert.match(computerUse, /interface ComputerUseAccessDenial/);
  assert.match(computerUse, /denied\?: ComputerUseAccessDenial\[\]/);
  assert.match(computerUse, /addAccessDenial\(denied, undefined, appName, "not_installed"\)/);
  assert.match(computerUse, /grantedApps/);
  assert.match(computerUse, /deniedApps/);
  assert.match(computerUse, /userConsented/);
  assert.match(computerUse, /tccState/);
  assert.match(computerUse, /formatTccApprovalResult/);
  assert.match(computerUse, /recheckTccApprovalState/);
  assert.match(computerUse, /helper<Record<string, unknown>>\("check_permissions"/);
  assert.match(computerUse, /permission panel has been shown/);
  assert.match(computerUse, /teachModeActivated/);
  assert.match(computerUse, /teachModeExited/);
  assert.match(computerUse, /Cannot request additional Computer Use permissions during teach mode/);
  assert.match(computerUse, /Teach mode is already active/);
  assert.match(computerUse, /clipboardRead/);
  assert.match(computerUse, /clipboardWrite/);
  assert.match(computerUse, /systemKeyCombos/);
  assert.match(computerUse, /force clipboard paste when true/);
  assert.match(computerUse, /input\.viaClipboard === true/);
  assert.match(computerUse, /shouldUseClipboardForTyping\(input\.text \?\? "", context\)/);
  assert.match(computerUse, /await helper\("paste_text", \{ text: input\.text \?\? "" \}, context\)/);
  assert.doesNotMatch(computerUse, /await helper\("write_clipboard", \{ text: input\.text \?\? "" \}, context\);\n        await helper\("paste_clipboard", \{\}, context\)/);
  assert.match(computerUse, /text\.includes\("\\n"\)/);
  assert.match(computerUse, /os\.platform\(\) === "darwin"/);
  assert.match(computerUse, /os\.platform\(\) === "win32"/);
  assert.match(computerUse, /return \/\[\^\\u0000-\\u007f\]\/u\.test\(text\)/);
  assert.match(computerUse, /typeTextByGrapheme\(input\.text \?\? "", context\)/);
  assert.match(computerUse, /const INTER_GRAPHEME_SLEEP_MS = 8/);
  assert.match(computerUse, /function segmentGraphemes\(text: string\): string\[\]/);
  assert.match(computerUse, /Segmenter/);
  assert.match(computerUse, /granularity: "grapheme"/);
  assert.match(computerUse, /Typing aborted after \$\{index\} of \$\{graphemes\.length\} graphemes/);
  assert.match(computerUse, /grapheme === "\\n" \|\| grapheme === "\\r" \|\| grapheme === "\\r\\n"/);
  assert.match(computerUse, /keySequence: "return"/);
  assert.match(computerUse, /keySequence: "tab"/);
  assert.match(computerUse, /await helper\("type", \{ text: grapheme \}, context\)/);
  assert.match(computerUse, /blockSystemKeyComboUnlessGranted/);
  assert.match(computerUse, /systemKeyCombos.*grant.*request_access/);
  assert.doesNotMatch(computerUse, /mouseSwiftSource/);
  assert.doesNotMatch(computerUse, /execFileAsync\("screencapture"/);

  const macInstalledAppsHelper = read("runtime/mac_helper.py");
  assert.match(macInstalledAppsHelper, /\/System\/Cryptexes\/App\/System\/Applications/);
  assert.match(macInstalledAppsHelper, /\/System\/Volumes\/Preboot\/Cryptexes\/App\/System\/Applications/);

  const registryCompat = read("src/core/tools/registry.ts");
  assert.match(registryCompat, /COMPUTER_USE_COMPAT_TOOLS/);
  assert.match(registryCompat, /computerUseCompatTool/);
  assert.match(registryCompat, /callComputerUseAction/);
  assert.match(registryCompat, /checkComputerUseToolPermission/);
  assert.match(registryCompat, /name: "screenshot"/);
  assert.match(registryCompat, /name: "left_click"/);
  assert.match(registryCompat, /name: "mouse_move"/);
  assert.match(registryCompat, /name: "left_click_drag"/);
  assert.match(registryCompat, /name: "open_application"/);
  assert.match(registryCompat, /name: "list_granted_applications"/);
  assert.match(registryCompat, /name: "computer_batch"/);
  assert.match(registryCompat, /name: "request_teach_access"/);
  assert.match(registryCompat, /\.\.\.COMPUTER_USE_COMPAT_TOOLS/);
  assert.match(registryCompat, /executeComputerUse\(parsed/);
  assert.match(registryCompat, /deniedBundleIds: context\.computerUseDeniedBundleIds/);
  assert.match(registryCompat, /const computerUseBatchActionSchema/);
  assert.match(registryCompat, /save_to_disk: \{ type: "boolean"/);
  assert.match(registryCompat, /MODEL_HIDDEN_BUILTIN_TOOLS/);
  assert.match(registryCompat, /getComputerUseInstalledAppNamesHint/);
  assert.match(registryCompat, /Available applications on this machine/);
  assert.match(registryCompat, /filterComputerUseAppsForDescription/);
  assert.match(registryCompat, /callComputerUseHelperIfReady/);
  assert.match(registryCompat, /installedAppNamesRetryAt/);
  assert.match(registryCompat, /Date\.now\(\) \+ 30_000/);
  assert.match(registryCompat, /Number\.POSITIVE_INFINITY/);
  assert.match(registryCompat, /"Browser"/);
  assert.match(registryCompat, /"display_info"/);
  assert.match(registryCompat, /"list_installed_applications"/);
  assert.match(registryCompat, /\.filter\(\(tool\) => !MODEL_HIDDEN_BUILTIN_TOOLS\.has\(tool\.name\)\)/);
  assert.match(registryCompat, /name: "ComputerUse"/);
  assert.match(registryCompat, /name: "Browser"/);
  assert.match(registryCompat, /name: "open_application"[\s\S]*\}, \["app"\]\)/);
  assert.match(registryCompat, /name: "switch_display"[\s\S]*\}, \["display"\]\)/);
  assert.match(registryCompat, /Omit to drag from current cursor/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"click"/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"move"/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"drag"/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"hotkey"/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"frontmost_app"/);
  assert.doesNotMatch(registryCompat, /computerUseBatchActionSchema[\s\S]{0,700}"app_under_point"/);
  const visibleComputerUseTools = getBuiltinToolDefinitions()
    .map((tool) => tool.name)
    .filter((name) => [
      ...magiComputerUseToolNames,
      "display_info",
      "permissions",
      "frontmost_app",
      "app_under_point",
      "list_running_applications",
      "list_installed_applications",
      "ComputerUse"
    ].includes(name));
  assert.deepEqual(visibleComputerUseTools, magiComputerUseToolNames);
  assert.equal(getBuiltinToolDefinitions().some((tool) => tool.name === "Browser"), false);
  const defaultRequestAccess = getBuiltinToolDefinitions().find((tool) => tool.name === "request_access");
  const defaultTeachAccess = getBuiltinToolDefinitions().find((tool) => tool.name === "request_teach_access");
  assert.ok(defaultRequestAccess);
  assert.ok(defaultTeachAccess);
  assert.doesNotMatch(appsDescription(defaultRequestAccess), /Available applications on this machine/);
  assert.doesNotMatch(appsDescription(defaultTeachAccess), /Available applications on this machine/);
  const hintedTools = getBuiltinToolDefinitions({
    computerUseInstalledAppNames: ["Safari", "Keynote", "访达"]
  });
  const hintedRequestAccess = hintedTools.find((tool) => tool.name === "request_access");
  const hintedTeachAccess = hintedTools.find((tool) => tool.name === "request_teach_access");
  assert.ok(hintedRequestAccess);
  assert.ok(hintedTeachAccess);
  assert.match(
    appsDescription(hintedRequestAccess),
    /Available applications on this machine: Safari, Keynote, 访达\./
  );
  assert.match(
    appsDescription(hintedTeachAccess),
    /Available applications on this machine: Safari, Keynote, 访达\./
  );
  const hintedComputerUseToolContracts = hintedTools
    .filter((tool) => magiComputerUseToolNames.includes(tool.name as typeof magiComputerUseToolNames[number]))
    .map(summarizeComputerUseToolContract);
  assert.deepEqual(hintedComputerUseToolContracts, [
    { name: "request_access", required: ["apps", "reason"], props: ["apps", "reason", "clipboardRead", "clipboardWrite", "systemKeyCombos"] },
    { name: "screenshot", required: [], props: ["save_to_disk"] },
    { name: "zoom", required: ["region"], props: ["region", "save_to_disk"] },
    { name: "left_click", required: ["coordinate"], props: ["coordinate", "text"] },
    { name: "double_click", required: ["coordinate"], props: ["coordinate", "text"] },
    { name: "triple_click", required: ["coordinate"], props: ["coordinate", "text"] },
    { name: "right_click", required: ["coordinate"], props: ["coordinate", "text"] },
    { name: "middle_click", required: ["coordinate"], props: ["coordinate", "text"] },
    { name: "type", required: ["text"], props: ["text"] },
    { name: "key", required: ["text"], props: ["text", "repeat"] },
    { name: "scroll", required: ["coordinate", "scroll_direction", "scroll_amount"], props: ["coordinate", "scroll_direction", "scroll_amount"] },
    { name: "left_click_drag", required: ["coordinate"], props: ["coordinate", "start_coordinate"] },
    { name: "mouse_move", required: ["coordinate"], props: ["coordinate"] },
    { name: "open_application", required: ["app"], props: ["app"] },
    { name: "switch_display", required: ["display"], props: ["display"] },
    { name: "list_granted_applications", required: [], props: [] },
    { name: "read_clipboard", required: [], props: [] },
    { name: "write_clipboard", required: ["text"], props: ["text"] },
    { name: "wait", required: ["duration"], props: ["duration"] },
    { name: "cursor_position", required: [], props: [] },
    { name: "hold_key", required: ["text", "duration"], props: ["text", "duration"] },
    { name: "left_mouse_down", required: [], props: [] },
    { name: "left_mouse_up", required: [], props: [] },
    { name: "computer_batch", required: ["actions"], props: ["actions"], actionEnum: magiBatchActionEnum },
    { name: "request_teach_access", required: ["apps", "reason"], props: ["apps", "reason"] },
    { name: "teach_step", required: ["explanation", "next_preview", "actions"], props: ["explanation", "next_preview", "anchor", "actions"], actionEnum: magiBatchActionEnum },
    { name: "teach_batch", required: ["steps"], props: ["steps"], stepProps: ["explanation", "next_preview", "anchor", "actions"], stepRequired: ["explanation", "next_preview", "actions"], stepActionEnum: magiBatchActionEnum }
  ]);

  const appNames = read("src/core/tools/computer-use-app-names.ts");
  assert.match(appNames, /ALWAYS_KEEP_BUNDLE_IDS/);
  assert.match(appNames, /APP_NAME_ALLOWED/);
  assert.match(appNames, /APP_NAME_MAX_COUNT = 50/);
  assert.match(appNames, /filterComputerUseAppsForDescription/);

  const query = read("src/core/agent/query.ts");
  assert.match(query, /getComputerUseInstalledAppNamesHint/);
  assert.match(query, /getBuiltinAgentTools\(\{ computerUseInstalledAppNames: installedAppNames \}\)/);

  const installedAppsFallback = read("src/core/tools/computer-use-installed-apps.ts");
  assert.match(installedAppsFallback, /listInstalledAppsForDescription/);
  assert.match(installedAppsFallback, /\/usr\/bin\/plutil/);
  assert.match(installedAppsFallback, /\/System\/Cryptexes\/App\/System\/Applications/);
  assert.match(installedAppsFallback, /\/System\/Volumes\/Preboot\/Cryptexes\/App\/System\/Applications/);
  assert.match(registryCompat, /listInstalledAppsForDescription\(1_000\)/);
  const directInstalledApps = await listInstalledAppsForDescription(1_000);
  if (process.platform === "darwin") {
    assert.ok(directInstalledApps?.some((app) => app.bundleId === "com.apple.Safari" || app.displayName === "Safari"));
  }

  const keyPolicy = read("src/core/tools/computer-use-keys.ts");
  assert.match(keyPolicy, /BLOCKED_DARWIN/);
  assert.match(keyPolicy, /BLOCKED_WIN32/);
  assert.equal(normalizeComputerUseKeySequence("Command + Shift + Q"), "shift+meta+q");
  assert.equal(isSystemComputerUseKeyCombo("cmd+q", "darwin"), true);
  assert.equal(isSystemComputerUseKeyCombo("command+q+a", "darwin"), true);
  assert.equal(isSystemComputerUseKeyCombo("cmd+s", "darwin"), false);
  assert.equal(isSystemComputerUseKeyCombo("alt+f4", "win32"), true);

  const policy = read("src/core/tools/computer-use-policy.ts");
  assert.match(policy, /BROWSER_BUNDLE_IDS/);
  assert.match(policy, /TERMINAL_BUNDLE_IDS/);
  assert.match(policy, /TRADING_BUNDLE_IDS/);
  assert.match(policy, /POLICY_DENIED_BUNDLE_IDS/);
  assert.match(policy, /evaluateComputerUseAppPolicy/);
  assert.match(policy, /buildComputerUseTierGuidance/);
  assert.match(policy, /buildComputerUsePolicyDeniedGuidance/);
  assert.match(policy, /Use Bash for command-line work/);
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.apple.Terminal", displayName: "Terminal" }, "keyboard").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.apple.Terminal", displayName: "Terminal" }, "mouse").allowed,
    true
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.webull.desktop.v1", displayName: "Webull" }, "mouse").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.webull.desktop.v1", displayName: "Webull" }, "open_app").allowed,
    true
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.spotify.client", displayName: "Spotify" }, "mouse_position").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.kagi.kagimacOS", displayName: "Orion" }, "mouse").category,
    "browser"
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.google.android.studio", displayName: "Android Studio" }, "keyboard").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "au.com.shiftyjelly.PocketCasts", displayName: "Pocket Casts" }, "mouse_position").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ displayName: "Trader Workstation" }, "mouse").allowed,
    false
  );
  assert.equal(
    getDefaultComputerUseTier({ bundleId: "com.apple.Safari", displayName: "Safari" }),
    "read"
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.apple.Safari", displayName: "Safari" }, "mouse").allowed,
    false
  );
  assert.equal(
    evaluateComputerUseAppPolicy({ bundleId: "com.apple.Safari", displayName: "Safari" }, "open_app").allowed,
    true
  );
  assert.match(
    evaluateComputerUseAppPolicy({ bundleId: "com.apple.Safari", displayName: "Safari" }, "mouse").reason ?? "",
    /tier "read"/
  );
  assert.match(
    buildComputerUseTierGuidance([{ bundleId: "com.apple.Safari", displayName: "Safari", tier: "read" }]) ?? "",
    /visible in screenshots only/
  );
  assert.match(
    buildComputerUseTierGuidance([{ bundleId: "com.apple.Terminal", displayName: "Terminal", tier: "click" }]) ?? "",
    /Use Bash for command-line work/
  );
  assert.match(
    buildComputerUsePolicyDeniedGuidance([{ requestedName: "Spotify", displayName: "Spotify" }]) ?? "",
    /blocked by Computer Use policy/
  );

  const engine = read("src/main/engine.ts");
  assert.match(engine, /Coordinates are pixels from Kira's latest screenshot/);
  assert.match(engine, /normalizeComputerUseToolInput/);
  assert.match(engine, /COMPUTER_USE_TOOL_ACTIONS/);
  assert.match(engine, /request_access: "request_access"/);
  assert.match(engine, /left_click: "click"/);
  assert.match(engine, /computer_batch: "batch"/);
  assert.match(engine, /const computerUseInput = normalizeComputerUseToolInput/);
  assert.match(engine, /computerUseTeachStepResolver/);
  assert.match(engine, /showApprovalOverlay/);
  assert.match(engine, /closeApprovalOverlay/);
  assert.doesNotMatch(engine, /dialog\.showMessageBox/);
  assert.match(engine, /showTeachOverlay/);
  assert.match(engine, /closeTeachOverlay/);
  assert.match(engine, /hideMainWindowForTeachMode/);
  assert.match(engine, /hideMainWindowForComputerUse/);
  assert.match(engine, /restoreMainWindowFromTeachMode/);
  assert.match(engine, /restoreComputerUseHiddenApps/);
  assert.match(engine, /restoreComputerUseClipboard/);
  assert.match(engine, /releaseComputerUseSession/);
  assert.match(engine, /previewComputerUseApproval/);
  assert.match(engine, /resetComputerUseTurnState/);
  assert.match(engine, /computerUseHideHostWindow/);
  assert.match(engine, /computerUseTeachModeActivated/);
  assert.match(engine, /computerUseTeachModeExited/);
  assert.match(engine, /computerUseTccStateForApproval/);
  assert.match(engine, /computerUseApprovalPreview/);
  assert.match(engine, /computerUsePreview/);
  assert.match(engine, /request_access/);
  assert.match(engine, /request_teach_access/);
  assert.match(engine, /Accessibility:\\s\*granted/);
  assert.match(engine, /Screen Recording:\\s\*granted/);
  assert.match(engine, /Allow Kira to guide you\?/);
  assert.match(engine, /teaching overlay will appear/);
  assert.match(engine, /Each step waits for your Next or Exit choice/);

  const approvalOverlay = read("src/main/approval-overlay.ts");
  assert.match(approvalOverlay, /new BrowserWindow/);
  assert.match(approvalOverlay, /modal: true/);
  assert.match(approvalOverlay, /alwaysOnTop: true/);
  assert.match(approvalOverlay, /kira-approval:\/\/allow/);
  assert.match(approvalOverlay, /kira-approval:\/\/deny/);
  assert.match(approvalOverlay, /Apps/);
  assert.match(approvalOverlay, /Batch/);
  assert.match(approvalOverlay, /Reason/);
  assert.match(approvalOverlay, /clipboardRead/);
  assert.match(approvalOverlay, /clipboardWrite/);
  assert.match(approvalOverlay, /systemKeyCombos/);
  assert.match(approvalOverlay, /computerUsePreview/);
  assert.match(approvalOverlay, /willHideSection/);
  assert.match(approvalOverlay, /Before Control/);
  assert.match(approvalOverlay, /autoUnhideEnabled/);
  assert.match(approvalOverlay, /will be hidden while Kira works/);
  assert.match(approvalOverlay, /restored when Kira is done/);
  assert.match(approvalOverlay, /parseApprovalDecision/);
  assert.match(approvalOverlay, /readAppGrants/);
  assert.match(approvalOverlay, /readAppDenials/);
  assert.match(approvalOverlay, /grantedApps/);
  assert.match(approvalOverlay, /deniedApps/);
  assert.match(approvalOverlay, /data-flag/);
  assert.match(approvalOverlay, /Computer Use approval/);
  assert.match(approvalOverlay, /Requested Grants/);
  assert.match(approvalOverlay, /tccState/);
  assert.match(approvalOverlay, /macOS Permissions/);
  assert.match(approvalOverlay, /Accessibility/);
  assert.match(approvalOverlay, /Screen Recording/);
  assert.match(approvalOverlay, /Privacy_Accessibility/);
  assert.match(approvalOverlay, /Privacy_ScreenCapture/);
  assert.match(approvalOverlay, /openTccUrl/);
  assert.match(approvalOverlay, /readTccState/);
  assert.match(approvalOverlay, /allow\?computerUse/);
  assert.match(approvalOverlay, /Try again/);
  assert.match(approvalOverlay, /function deny\(\)/);
  assert.match(approvalOverlay, /userConsented: false/);
  assert.match(approvalOverlay, /grantedApps: \[\]/);
  assert.match(approvalOverlay, /deniedApps: data\.requestedApps/);
  assert.match(approvalOverlay, /if \(event\.key === "Escape"\) deny\(\)/);

  const teachOverlay = read("src/main/teach-overlay.ts");
  assert.match(teachOverlay, /new BrowserWindow/);
  assert.match(teachOverlay, /transparent: true/);
  assert.match(teachOverlay, /alwaysOnTop: true/);
  assert.match(teachOverlay, /screen\.getDisplayNearestPoint/);
  assert.match(teachOverlay, /kira-teach:\/\/next/);
  assert.match(teachOverlay, /kira-teach:\/\/exit/);
  assert.match(teachOverlay, /request\.anchor/);
  assert.match(teachOverlay, /Next/);
  assert.match(teachOverlay, /Exit/);

  const systemPrompt = read("src/core/agent/system-prompt.ts");
  assert.match(systemPrompt, /call request_access/);
  assert.match(systemPrompt, /request_teach_access/);
  assert.match(systemPrompt, /teach_step/);
  assert.match(systemPrompt, /teach_batch/);
  assert.match(systemPrompt, /terminal\/IDE\/script-runner apps/);
  assert.match(systemPrompt, /switch_display/);
  assert.doesNotMatch(systemPrompt, /call display_info/);
  assert.match(systemPrompt, /left_mouse_down/);
  assert.match(systemPrompt, /held mouse\/key actions/);

  const lock = read("src/core/tools/computer-use-lock.ts");
  assert.match(lock, /computer-use\.lock/);
  assert.match(lock, /checkComputerUseLock/);
  assert.match(lock, /acquireComputerUseLock/);
  assert.match(lock, /releaseComputerUseLock/);
  assert.match(lock, /writeFileSync\(lockPath, JSON\.stringify\(record\), \{ encoding: "utf8", flag: "wx" \}\)/);
  assert.match(lock, /process\.kill\(pid, 0\)/);

  const runtimeBridge = read("src/core/tools/computer-use-runtime.ts");
  assert.match(runtimeBridge, /runtimesRoot, "computer-use"/);
  assert.match(runtimeBridge, /requirements-win\.txt/);
  assert.match(runtimeBridge, /mac_helper\.py/);
  assert.match(runtimeBridge, /win_helper\.py/);
  assert.match(runtimeBridge, /timeoutMs\?: number/);
  assert.match(runtimeBridge, /timeoutMs: input\.timeoutMs \?\? 60_000/);
  assert.match(runtimeBridge, /PIP_INDEX_URL/);
  assert.match(runtimeBridge, /FALLBACK_PIP_INDEX_URL/);
  assert.match(runtimeBridge, /runPipInstall/);

  const registry = read("src/core/tools/registry.ts");
  assert.match(registry, /sessionId: context\.sessionId/);
  assert.match(registry, /teachStepResolver: context\.computerUseTeachStepResolver/);
  assert.match(registry, /hideHostWindow: context\.computerUseHideHostWindow/);
  assert.match(registry, /teachModeActivated: context\.computerUseTeachModeActivated/);
  assert.match(registry, /teachModeExited: context\.computerUseTeachModeExited/);
  assert.match(registry, /ToolApprovalDecision/);
  assert.match(registry, /computerUseApprovalResponse/);
  assert.match(registry, /approvalResponse: context\.computerUseApprovalResponse/);
  assert.match(registry, /switch_display/);
  assert.match(registry, /left_mouse_down/);
  assert.match(registry, /left_mouse_up/);
  assert.match(registry, /hold_key/);
  assert.match(registry, /triple_click/);
  assert.match(registry, /middle_click/);
  assert.match(registry, /read_clipboard/);
  assert.match(registry, /write_clipboard/);

  const macHelper = read("runtime/mac_helper.py");
  assert.match(macHelper, /import pyautogui/);
  assert.match(macHelper, /import mss/);
  assert.match(macHelper, /def detect_accessibility_permission/);
  assert.match(macHelper, /def capture_display/);
  assert.match(macHelper, /def validate_click_target/);
  assert.match(macHelper, /lastScreenshotBase64/);
  assert.match(macHelper, /Image\.open\(BytesIO\(base64\.b64decode\(last_base64\)\)\)/);
  assert.match(macHelper, /def crop_patch/);
  assert.match(macHelper, /Screen content at the target location changed since the last screenshot/);
  assert.match(macHelper, /def click/);
  assert.match(macHelper, /def scroll/);
  assert.match(macHelper, /def hold_keys/);
  assert.match(macHelper, /mouseDown/);
  assert.match(macHelper, /mouseUp/);
  assert.match(macHelper, /def paste_clipboard/);
  assert.match(macHelper, /def paste_text/);
  assert.match(macHelper, /original = read_clipboard\(\)/);
  assert.match(macHelper, /write_clipboard\(text\)\n        time\.sleep\(0\.04\)\n        paste_clipboard\(\)\n        time\.sleep\(0\.18\)/);
  assert.match(macHelper, /def preview_hide_set/);
  assert.match(macHelper, /def prepare_for_action/);
  assert.match(macHelper, /def restore_apps/);
  assert.match(macHelper, /SYSTEM_HIDE_EXEMPT_BUNDLE_IDS/);
  assert.match(macHelper, /app\.hide\(\)/);
  assert.match(macHelper, /app\.unhide\(\)/);

  const winHelper = read("runtime/win_helper.py");
  assert.match(winHelper, /import pyautogui/);
  assert.match(winHelper, /def paste_text/);
  assert.match(winHelper, /original = read_clipboard\(\)/);
  assert.match(winHelper, /write_clipboard\(text\)\n        paste_clipboard\(\)\n        time\.sleep\(0\.10\)/);
  assert.match(winHelper, /def capture_display/);
  assert.match(winHelper, /def validate_click_target/);
  assert.match(winHelper, /lastScreenshotBase64/);
  assert.match(winHelper, /Image\.open\(BytesIO\(base64\.b64decode\(last_base64\)\)\)/);
  assert.match(winHelper, /def crop_patch/);
  assert.match(winHelper, /Screen content at the target location changed since the last screenshot/);
  assert.match(winHelper, /mouseDown/);
  assert.match(winHelper, /mouseUp/);
  assert.match(winHelper, /def hold_keys/);
  assert.match(winHelper, /def preview_hide_set/);
  assert.match(winHelper, /def prepare_for_action/);
  assert.match(winHelper, /def restore_apps/);
  assert.match(winHelper, /SYSTEM_HIDE_EXEMPT_NAMES/);
  assert.match(winHelper, /SW_MINIMIZE/);
  assert.match(winHelper, /SW_RESTORE/);

  const builder = read("electron-builder.yml");
  assert.match(builder, /from: runtime/);

  assert.match(computerUse, /could not prepare the Computer Use runtime/);
  assert.match(computerUse, /dependency install\|pip/);

  const reusableWorkspace = "/Users/ktz/Documents/workspace";
  const temp = existsSync(path.join(reusableWorkspace, "runtimes", "computer-use", "requirements.sha256"))
    ? undefined
    : mkdtempSync(path.join(os.tmpdir(), "kira-cu-align-"));
  try {
    const workspace = temp ? path.join(temp, "KiraWorkspace") : reusableWorkspace;
    const project = path.join(workspace, "projects", "default");
    ensureKiraWorkspace(workspace);
    for (const sessionId of [
      "permission-session",
      "legacy-tier-session",
      "localized-safari-grant-session",
      "localized-grant-session",
      "unknown-grant-session",
      "fuzzy-grant-session",
      "user-denied-session",
      "structured-feedback-session",
      "structured-teach-feedback-session",
      "teach-policy-denied-session"
    ]) {
      await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId });
    }
    const readOnlyPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      mode: "auto",
      toolUse: {
        id: "display-info",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "display_info" }
      }
    });
    assert.equal(readOnlyPermission.decision, "allow");

    const emptyAllowlistScreenshot = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "empty-allowlist-screenshot-session",
      permissionMode: "auto",
      toolUse: {
        id: "empty-allowlist-screenshot",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "screenshot", includeImage: false }
      }
    });
    assert.equal(emptyAllowlistScreenshot.isError, true);
    assert.match(emptyAllowlistScreenshot.content, /No applications are granted/i);
    assert.match(emptyAllowlistScreenshot.content, /request_access/i);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "empty-allowlist-screenshot-session" });

    const switchAutoWithoutAllowlist = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "switch-auto-empty-allowlist-session",
      permissionMode: "auto",
      toolUse: {
        id: "switch-auto-empty-allowlist",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "switch_display", display: "auto" }
      }
    });
    assert.equal(switchAutoWithoutAllowlist.isError, undefined);
    assert.match(switchAutoWithoutAllowlist.content, /display selection reset to auto/i);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "switch-auto-empty-allowlist-session" });

    const accessPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      mode: "auto",
      toolUse: {
        id: "request-access",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_access", apps: ["Safari"], reason: "test visible browser control" }
      }
    });
    assert.equal(accessPermission.decision, "ask");

    await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Safari"],
      reason: "initial session grant"
    }), {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      approvalResponse: {
        granted: [{ bundleId: "com.apple.Safari", displayName: "Safari", tier: "read", grantedAt: new Date().toISOString() }],
        denied: [],
        userConsented: true
      }
    });
    const legacyGrantContext = { cwd: project, kiraWorkspaceRoot: workspace, sessionId: "legacy-tier-session" };
    await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Safari"],
      reason: "legacy grant backfill"
    }), {
      ...legacyGrantContext,
      approvalResponse: {
        granted: [{ bundleId: "com.apple.Safari", displayName: "Safari", grantedAt: new Date().toISOString() }],
        userConsented: true
      }
    });
    assert.equal(getComputerUseSessionState(legacyGrantContext).grants[0]?.tier, "read");
    await assert.rejects(
      executeComputerUse(parseComputerUseInput({ action: "click", x: 1, y: 1, app: "Safari" }), legacyGrantContext),
      /visible browser page.*cannot click, type, scroll, navigate, drag, or send shortcuts/
    );
    await assert.rejects(
      executeComputerUse(parseComputerUseInput({ action: "open_app", app: "Saf" }), legacyGrantContext),
      /not granted|request_access|could not identify/i
    );
    await assert.rejects(
      executeComputerUse(parseComputerUseInput({ action: "open_app", bundleId: "com.example.NotGranted" }), legacyGrantContext),
      /not granted|request_access|could not identify/i
    );
    await releaseComputerUseSession(legacyGrantContext);
    const localizedSafariGrantContext = { cwd: project, kiraWorkspaceRoot: workspace, sessionId: "localized-safari-grant-session" };
    await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Safari"],
      reason: "localized safari grant backfill"
    }), {
      ...localizedSafariGrantContext,
      approvalResponse: {
        granted: [{ bundleId: "com.apple.Safari", displayName: "Safari浏览器", grantedAt: new Date().toISOString() }],
        userConsented: true
      }
    });
    await assert.rejects(
      executeComputerUse(parseComputerUseInput({ action: "click", x: 1, y: 1, app: "Safari" }), localizedSafariGrantContext),
      /visible browser page.*cannot click, type, scroll, navigate, drag, or send shortcuts/
    );
    await assert.rejects(
      executeComputerUse(parseComputerUseInput({ action: "open_app", app: "Saf" }), localizedSafariGrantContext),
      /not granted|request_access|could not identify/i
    );
    await releaseComputerUseSession(localizedSafariGrantContext);
    const localizedGrantContext = { cwd: project, kiraWorkspaceRoot: workspace, sessionId: "localized-grant-session" };
    const localizedGrantResult = await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Finder"],
      reason: "localized app approval"
    }), {
      ...localizedGrantContext,
      approvalResponse: {
        granted: [{ bundleId: "com.apple.finder", displayName: "访达", tier: "full", grantedAt: new Date().toISOString() }],
        denied: [],
        flags: { clipboardRead: false, clipboardWrite: false, systemKeyCombos: false },
        userConsented: true
      }
    });
    type AccessDenial = { bundleId: string; reason: "user_denied" | "not_installed" };

    const localizedGrantPayload = JSON.parse(localizedGrantResult) as {
      granted: Array<{ bundleId?: string; displayName?: string }>;
      denied: AccessDenial[];
    };
    assert.equal(localizedGrantPayload.granted[0]?.bundleId, "com.apple.finder");
    assert.equal(localizedGrantPayload.granted[0]?.displayName, "访达");
    assert.deepEqual(localizedGrantPayload.denied, []);
    await releaseComputerUseSession(localizedGrantContext);

    const unknownGrantContext = { cwd: project, kiraWorkspaceRoot: workspace, sessionId: "unknown-grant-session" };
    const unknownGrantResult = await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["DefinitelyNotInstalledKiraTestApp"],
      reason: "unknown app should not become a grant"
    }), {
      ...unknownGrantContext,
      approvalResponse: {
        grantedApps: ["DefinitelyNotInstalledKiraTestApp"],
        userConsented: true
      }
    });
    const unknownGrantPayload = JSON.parse(unknownGrantResult) as {
      granted: unknown[];
      denied: AccessDenial[];
    };
    assert.equal(unknownGrantPayload.granted.length, 0);
    assert.deepEqual(unknownGrantPayload.denied, [
      { bundleId: "DefinitelyNotInstalledKiraTestApp", reason: "not_installed" }
    ]);
    assert.equal(getComputerUseSessionState(unknownGrantContext).grants.length, 0);
    await releaseComputerUseSession(unknownGrantContext);

    const fuzzyGrantContext = { cwd: project, kiraWorkspaceRoot: workspace, sessionId: "fuzzy-grant-session" };
    const fuzzyGrantResult = await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Saf"],
      reason: "partial app names should not resolve"
    }), {
      ...fuzzyGrantContext,
      approvalResponse: {
        grantedApps: ["Saf"],
        userConsented: true
      }
    });
    const fuzzyGrantPayload = JSON.parse(fuzzyGrantResult) as {
      granted: unknown[];
      denied: AccessDenial[];
    };
    assert.equal(fuzzyGrantPayload.granted.length, 0);
    assert.deepEqual(fuzzyGrantPayload.denied, [
      { bundleId: "Saf", reason: "not_installed" }
    ]);
    assert.equal(getComputerUseSessionState(fuzzyGrantContext).grants.length, 0);
    await releaseComputerUseSession(fuzzyGrantContext);

    const userDeniedContext = {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "user-denied-session",
      deniedBundleIds: ["com.apple.Safari"]
    };
    const userDeniedAccess = await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Safari"],
      reason: "respect user deny list"
    }), {
      ...userDeniedContext,
      approvalResponse: {
        grantedApps: ["Safari"],
        userConsented: true
      }
    });
    const userDeniedPayload = JSON.parse(userDeniedAccess) as {
      userDenied?: { apps: Array<{ displayName: string }>; guidance: string };
      granted: unknown[];
      denied: AccessDenial[];
    };
    assert.equal(userDeniedPayload.granted.length, 0);
    assert.deepEqual(userDeniedPayload.denied, []);
    assert.match(userDeniedPayload.userDenied?.apps[0]?.displayName ?? "", /Safari|Safari浏览器/);
    assert.match(userDeniedPayload.userDenied?.guidance ?? "", /deny list/);
    assert.equal(getComputerUseSessionState(userDeniedContext).grants.length, 0);
    const accessResult = await executeComputerUse(parseComputerUseInput({
      action: "request_access",
      apps: ["Safari", "Terminal", "Spotify"],
      reason: "check structured grant feedback"
    }), {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "structured-feedback-session",
      approvalResponse: {
        granted: [
          { bundleId: "com.apple.Safari", displayName: "Safari", tier: "read", grantedAt: new Date().toISOString() },
          { bundleId: "com.apple.Terminal", displayName: "Terminal", tier: "click", grantedAt: new Date().toISOString() },
          { bundleId: "com.spotify.client", displayName: "Spotify", tier: "full", grantedAt: new Date().toISOString() }
        ],
        denied: [],
        userConsented: true
      }
    });
    const accessPayload = JSON.parse(accessResult) as {
      granted: Array<{ bundleId?: string; displayName?: string; tier?: string }>;
      grantFlags: { clipboardRead: boolean; clipboardWrite: boolean; systemKeyCombos: boolean };
      denied: AccessDenial[];
	      policyDenied?: { guidance: string };
	      tierGuidance?: string;
	      screenshotFiltering: string;
	      next?: string;
	    };
    assert.equal(accessPayload.granted.length, 2);
    assert.equal(accessPayload.granted.find((grant) => grant.bundleId === "com.apple.Safari")?.tier, "read");
    assert.equal(accessPayload.granted.find((grant) => grant.bundleId === "com.apple.Terminal")?.tier, "click");
    assert.equal(accessPayload.grantFlags.clipboardRead, false);
    assert.deepEqual(accessPayload.denied, [{ bundleId: "Spotify", reason: "user_denied" }]);
    assert.match(accessPayload.tierGuidance ?? "", /visible in screenshots only/);
    assert.match(accessPayload.tierGuidance ?? "", /Use Bash for command-line work/);
	    assert.match(accessPayload.policyDenied?.guidance ?? "", /blocked by Computer Use policy/);
	    assert.equal(accessPayload.screenshotFiltering, "native");
	    assert.equal(accessPayload.next, undefined);
    const teachAccessResult = await executeComputerUse(parseComputerUseInput({
      action: "request_teach_access",
      apps: ["Safari", "Terminal"],
      reason: "teach structured grant feedback"
    }), {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "structured-teach-feedback-session",
      teachStepResolver: () => ({ action: "next" }),
      approvalResponse: {
        granted: [
          { bundleId: "com.apple.Safari", displayName: "Safari", tier: "read", grantedAt: new Date().toISOString() },
          { bundleId: "com.apple.Terminal", displayName: "Terminal", tier: "click", grantedAt: new Date().toISOString() }
        ],
        denied: [],
        userConsented: true
      }
    });
    const teachAccessPayload = JSON.parse(teachAccessResult) as {
      granted: Array<{ bundleId?: string; displayName?: string; tier?: string }>;
	      teachModeActive: boolean;
	      tierGuidance?: string;
	      screenshotFiltering: string;
	      next?: string;
	    };
    assert.equal(teachAccessPayload.teachModeActive, true);
    assert.equal(teachAccessPayload.granted.find((grant) => grant.bundleId === "com.apple.Safari")?.tier, "read");
    assert.equal(teachAccessPayload.granted.find((grant) => grant.bundleId === "com.apple.Terminal")?.tier, "click");
	    assert.match(teachAccessPayload.tierGuidance ?? "", /visible in screenshots only/);
	    assert.equal(teachAccessPayload.screenshotFiltering, "native");
	    assert.equal(teachAccessPayload.next, undefined);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "structured-teach-feedback-session" });

    const teachUserDeniedResult = await executeComputerUse(parseComputerUseInput({
      action: "request_teach_access",
      apps: ["Safari", "Terminal"],
      reason: "user declined teach mode"
    }), {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "teach-user-denied-session",
      teachStepResolver: () => ({ action: "next" }),
      approvalResponse: {
        grantedApps: [],
        deniedApps: ["Safari", "Terminal"],
        userConsented: false
      }
    });
	    const teachUserDeniedPayload = JSON.parse(teachUserDeniedResult) as {
	      granted: unknown[];
	      denied: AccessDenial[];
	      teachModeActive: boolean;
	      next?: string;
    };
	    assert.equal(teachUserDeniedPayload.teachModeActive, false);
	    assert.equal(teachUserDeniedPayload.granted.length, 0);
	    assert.deepEqual(teachUserDeniedPayload.denied.map((item) => item.reason), ["user_denied", "user_denied"]);
	    assert.equal(teachUserDeniedPayload.next, undefined);
	    assert.equal(getComputerUseSessionState({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "teach-user-denied-session" }).grants.length, 0);
	    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "teach-user-denied-session" });

    const teachDeniedResult = await executeComputerUse(parseComputerUseInput({
      action: "request_teach_access",
      apps: ["Spotify"],
      reason: "blocked teach app"
    }), {
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "teach-policy-denied-session",
      teachStepResolver: () => ({ action: "next" }),
      approvalResponse: {
        granted: [{ bundleId: "com.spotify.client", displayName: "Spotify", tier: "full", grantedAt: new Date().toISOString() }],
        denied: [],
        userConsented: true
      }
    });
    const teachDeniedPayload = JSON.parse(teachDeniedResult) as {
      teachModeActive: boolean;
      policyDenied?: { guidance: string };
    };
    assert.equal(teachDeniedPayload.teachModeActive, false);
    assert.match(teachDeniedPayload.policyDenied?.guidance ?? "", /blocked by Computer Use policy/);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "teach-policy-denied-session" });

    const repeatedAccessPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      mode: "auto",
      toolUse: {
        id: "request-access-repeat",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_access", apps: ["Safari"], reason: "same app again" }
      }
    });
    assert.equal(repeatedAccessPermission.decision, "allow");
    assert.match(repeatedAccessPermission.reason, /already granted/);
    const partialRepeatedAccessPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      mode: "auto",
      toolUse: {
        id: "request-access-partial-repeat",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_access", apps: ["Saf"], reason: "partial app name should not skip approval" }
      }
    });
    assert.equal(partialRepeatedAccessPermission.decision, "ask");
    const repeatedAccessWithNewFlagPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      mode: "auto",
      toolUse: {
        id: "request-access-repeat-flag",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_access", apps: ["Safari"], reason: "need clipboard", clipboardRead: true }
      }
    });
    assert.equal(repeatedAccessWithNewFlagPermission.decision, "ask");

    const teachAccessPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "permission-session",
      mode: "auto",
      toolUse: {
        id: "request-teach-access",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_teach_access", apps: ["Safari"], reason: "teach visible browser control" }
      }
    });
    assert.equal(teachAccessPermission.decision, "ask");

    const inputPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      mode: "auto",
      toolUse: {
        id: "click",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "click", x: 1, y: 1 }
      }
    });
    assert.equal(inputPermission.decision, "allow");

    assert.throws(
      () => parseComputerUseInput({ action: "scroll", x: 1, y: 1 }),
      /scroll requires deltaX or deltaY/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "batch", actions: [] }),
      /batch requires at least one action/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "request_access", apps: ["Safari"] }),
      /request_access requires reason/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "request_teach_access", apps: ["Safari"] }),
      /request_teach_access requires reason/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "teach_step", explanation: "look here", actions: [] }),
      /teach_step requires next_preview/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "teach_batch", steps: [] }),
      /teach_batch requires at least one step/
    );
  assert.throws(
    () => parseComputerUseInput({ action: "hold_key", durationMs: 10 }),
    /hold_key action requires key/
  );
  assert.throws(
    () => parseComputerUseInput({ action: "wait" }),
    /duration must be a number/
  );
  assert.throws(
    () => parseComputerUseInput({ action: "wait", duration: "1" }),
    /duration must be a number/
  );
  assert.throws(
    () => parseComputerUseInput({ action: "hold_key", text: "space" }),
    /duration must be a number/
  );
  assert.throws(
    () => parseComputerUseInput({ action: "hold_key", text: "space", duration: "1" }),
    /duration must be a number/
  );
  assert.throws(
    () => parseComputerUseInput({ action: "write_clipboard" }),
    /write_clipboard action requires text/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "zoom", x: 1, y: 1, width: 0, height: 10 }),
      /width must be a positive number/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "switch_display" }),
      /switch_display requires display/
    );
    const switchByName = parseComputerUseInput({ action: "switch_display", display: "Display 2" });
    assert.equal(switchByName.display, "Display 2");
    const switchAuto = parseComputerUseInput({ action: "switch_display", display: "auto" });
    assert.equal(switchAuto.display, "auto");
    const magiLeftClick = parseComputerUseInput({ action: "left_click", coordinate: [11, 22] });
    assert.equal(magiLeftClick.action, "click");
    assert.equal(magiLeftClick.x, 11);
    assert.equal(magiLeftClick.y, 22);
    const magiMouseMove = parseComputerUseInput({ action: "mouse_move", coordinate: [33, 44] });
    assert.equal(magiMouseMove.action, "move");
    assert.equal(magiMouseMove.x, 33);
    assert.equal(magiMouseMove.y, 44);
    const magiDrag = parseComputerUseInput({ action: "left_click_drag", start_coordinate: [1, 2], coordinate: [30, 40] });
    assert.equal(magiDrag.action, "drag");
    assert.equal(magiDrag.x, 1);
    assert.equal(magiDrag.y, 2);
    assert.equal(magiDrag.toX, 30);
    assert.equal(magiDrag.toY, 40);
    const magiDragFromCursor = parseComputerUseInput({ action: "left_click_drag", coordinate: [30, 40] });
    assert.equal(magiDragFromCursor.action, "drag");
    assert.equal(magiDragFromCursor.x, undefined);
    assert.equal(magiDragFromCursor.y, undefined);
    assert.equal(magiDragFromCursor.toX, 30);
    assert.equal(magiDragFromCursor.toY, 40);
    const magiShiftClick = parseComputerUseInput({ action: "left_click", coordinate: [55, 66], text: "shift" });
    assert.equal(magiShiftClick.action, "click");
    assert.equal(magiShiftClick.text, "shift");
    const magiZoom = parseComputerUseInput({ action: "zoom", region: [10, 20, 110, 220] });
    assert.equal(magiZoom.x, 10);
    assert.equal(magiZoom.y, 20);
    assert.equal(magiZoom.width, 100);
    assert.equal(magiZoom.height, 200);
    const magiOpenApp = parseComputerUseInput({ action: "open_application", app: "Safari" });
    assert.equal(magiOpenApp.action, "open_app");
    const magiListGranted = parseComputerUseInput({ action: "list_granted_applications" });
    assert.equal(magiListGranted.action, "list_granted_apps");
    const magiScroll = parseComputerUseInput({ action: "scroll", coordinate: [5, 6], scroll_direction: "down", scroll_amount: 2 });
    assert.equal(magiScroll.x, 5);
    assert.equal(magiScroll.y, 6);
    assert.equal(magiScroll.deltaY, 2);
    const magiScrollUp = parseComputerUseInput({ action: "scroll", coordinate: [5, 6], scroll_direction: "up", scroll_amount: 2 });
    assert.equal(magiScrollUp.deltaY, -2);
    assert.throws(
      () => parseComputerUseInput({ action: "scroll", coordinate: [5, 6], scroll_direction: "down", scroll_amount: 101 }),
      /scroll_amount must be an integer between 0 and 100/
    );
    const magiWait = parseComputerUseInput({ action: "wait", duration: 1.5 });
    assert.equal(magiWait.durationMs, 1500);
    assert.throws(
      () => parseComputerUseInput({ action: "wait", duration: -1 }),
      /duration must be non-negative/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "wait", duration: 101 }),
      /duration is too long/
    );
    const magiKey = parseComputerUseInput({ action: "key", text: "cmd+a", repeat: 3 });
    assert.equal(magiKey.key, "cmd+a");
    assert.equal(magiKey.repeat, 3);
    assert.throws(
      () => parseComputerUseInput({ action: "key", text: "return", repeat: 101 }),
      /key repeat must be an integer between 1 and 100/
    );
    const magiHold = parseComputerUseInput({ action: "hold_key", text: "space", duration: 0.25 });
    assert.equal(magiHold.key, "space");
    assert.equal(magiHold.durationMs, 250);
    assert.throws(
      () => parseComputerUseInput({ action: "hold_key", text: "space", duration: -1 }),
      /duration must be non-negative/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "hold_key", text: "space", duration: 101 }),
      /duration is too long/
    );
    const batch = parseComputerUseInput({ action: "batch", actions: [{ action: "wait", durationMs: 10 }, { action: "screenshot", includeImage: false }] });
    assert.equal(batch.actions?.[0]?.action, "wait");
    assert.equal(batch.actions?.[0]?.durationMs, 10);
    assert.equal(batch.actions?.[1]?.action, "screenshot");
    const magiBatch = parseComputerUseInput({ action: "computer_batch", actions: [{ action: "left_click", coordinate: [7, 8] }, { action: "key", text: "return" }] });
    assert.equal(magiBatch.action, "batch");
    assert.equal(magiBatch.actions?.[0]?.action, "click");
    assert.equal(magiBatch.actions?.[0]?.x, 7);
    assert.equal(magiBatch.actions?.[0]?.y, 8);
    assert.equal(magiBatch.actions?.[1]?.key, "return");
    const magiMoveBatch = parseComputerUseInput({ action: "batch", actions: [{ action: "mouse_move", coordinate: [20, 21] }] });
    assert.equal(magiMoveBatch.actions?.[0]?.action, "move");
    assert.equal(magiMoveBatch.actions?.[0]?.x, 20);
    const magiDragBatch = parseComputerUseInput({ action: "batch", actions: [{ action: "left_click_drag", start_coordinate: [1, 2], coordinate: [3, 4] }] });
    assert.equal(magiDragBatch.actions?.[0]?.action, "drag");
    assert.equal(magiDragBatch.actions?.[0]?.x, 1);
    assert.equal(magiDragBatch.actions?.[0]?.toX, 3);
    const magiTeachBatch = parseComputerUseInput({
      action: "teach_batch",
      steps: [
        {
          explanation: "Step one",
          next_preview: "Next: click and type.",
          actions: [{ action: "left_click", coordinate: [12, 13] }, { action: "key", text: "return", repeat: 2 }]
        }
      ]
    });
    assert.equal(magiTeachBatch.steps?.[0]?.actions[0]?.action, "click");
    assert.equal(magiTeachBatch.steps?.[0]?.actions[0]?.x, 12);
    assert.equal(magiTeachBatch.steps?.[0]?.actions[1]?.repeat, 2);
    assert.throws(
      () => parseComputerUseInput({ action: "batch", actions: [{ action: "read_clipboard" }] }),
      /actions\[0\]\.action is unsupported/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "batch", actions: [{ action: "hotkey", keys: ["cmd", "a"] }] }),
      /actions\[0\]\.action is unsupported/
    );
    assert.throws(
      () => parseComputerUseInput({ action: "computer_batch", actions: [] }),
      /batch requires at least one action/
    );
    const heldMouseBatch = parseComputerUseInput({ action: "batch", actions: [{ action: "move", x: 10, y: 10 }, { action: "left_mouse_down" }, { action: "move", x: 20, y: 20 }, { action: "left_mouse_up" }] });
    assert.equal(heldMouseBatch.actions?.[1]?.action, "left_mouse_down");
    assert.equal(heldMouseBatch.actions?.[3]?.action, "left_mouse_up");
    const heldKey = parseComputerUseInput({ action: "hold_key", key: "shift+down", durationMs: 250 });
    assert.equal(heldKey.key, "shift+down");
    assert.equal(heldKey.durationMs, 250);
    const tripleClick = parseComputerUseInput({ action: "triple_click", x: 10, y: 20 });
    assert.equal(tripleClick.action, "triple_click");
    const middleClick = parseComputerUseInput({ action: "middle_click", x: 10, y: 20 });
    assert.equal(middleClick.action, "middle_click");
    const clipboardWrite = parseComputerUseInput({ action: "write_clipboard", text: "copy me" });
    assert.equal(clipboardWrite.text, "copy me");
    const clipboardReadPermission = checkToolPermission({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      mode: "auto",
      toolUse: {
        id: "read-clipboard",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "read_clipboard" }
      }
    });
    assert.equal(clipboardReadPermission.decision, "allow");
    const clipboardDenied = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "clipboard-session",
      permissionMode: "auto",
      toolUse: {
        id: "read-clipboard-denied",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "read_clipboard" }
      }
    });
    assert.equal(clipboardDenied.isError, true);
    assert.match(clipboardDenied.content, /clipboardRead/);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "clipboard-session" });

    const flaggedAccess = parseComputerUseInput({
      action: "request_access",
      apps: ["Safari"],
      reason: "clipboard test",
      clipboardRead: true,
      clipboardWrite: true,
      systemKeyCombos: true
    });
    assert.equal(flaggedAccess.clipboardRead, true);
    assert.equal(flaggedAccess.clipboardWrite, true);
    assert.equal(flaggedAccess.systemKeyCombos, true);
    const defaultType = parseComputerUseInput({ action: "type", text: "中文 input" });
    assert.equal(defaultType.viaClipboard, undefined);
    const forcedClipboardType = parseComputerUseInput({ action: "type", text: "中文 input", viaClipboard: true });
    assert.equal(forcedClipboardType.viaClipboard, true);
    const openByName = parseComputerUseInput({ action: "open_app", app: "Safari" });
    assert.equal(openByName.app, "Safari");

    const compatLeftClick = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "compat-left-click-session",
      permissionMode: "auto",
      toolUse: {
        id: "compat-left-click",
        type: "tool-use",
        name: "left_click",
        input: { coordinate: [10, 20] }
      }
    });
    assert.equal(compatLeftClick.isError, true);
    assert.doesNotMatch(compatLeftClick.content, /Unknown tool/);
    assert.match(compatLeftClick.content, /request_access|could not identify the target app|cannot control the computer|permission|visible browser page/i);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "compat-left-click-session" });

    const compatListGranted = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "compat-list-session",
      permissionMode: "auto",
      toolUse: {
        id: "compat-list",
        type: "tool-use",
        name: "list_granted_applications",
        input: {}
      }
    });
	    assert.equal(compatListGranted.isError, undefined);
	    assert.match(compatListGranted.content, /allowedApps/);
	    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "compat-list-session" });

	    const registeredAccessDenied = await executeRegisteredTool({
	      cwd: project,
	      kiraWorkspaceRoot: workspace,
	      sessionId: "registered-access-denied-session",
	      permissionMode: "auto",
	      toolUse: {
	        id: "registered-access-denied",
	        type: "tool-use",
	        name: "request_access",
	        input: {
	          apps: ["Safari"],
	          reason: "simulate user denied request_access"
	        }
	      },
	      approvalResolver: () => ({
	        approved: true,
	        computerUse: {
	          grantedApps: [],
	          deniedApps: ["Safari"],
	          userConsented: false
	        }
	      })
	    });
	    assert.equal(registeredAccessDenied.isError, undefined);
	    assert.doesNotMatch(registeredAccessDenied.content, /Permission ask:/);
	    assert.match(registeredAccessDenied.content, /"granted":\s*\[\]/);
	    assert.match(registeredAccessDenied.content, /"denied":\s*\[/);
	    assert.match(registeredAccessDenied.content, /"user_denied"/);
	    assert.doesNotMatch(registeredAccessDenied.content, /Call screenshot next/);
	    assert.equal(getComputerUseSessionState({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "registered-access-denied-session" }).grants.length, 0);
	    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "registered-access-denied-session" });

	    const registeredTeachDenied = await executeRegisteredTool({
	      cwd: project,
	      kiraWorkspaceRoot: workspace,
	      sessionId: "registered-teach-denied-session",
	      permissionMode: "auto",
	      toolUse: {
	        id: "registered-teach-denied",
	        type: "tool-use",
	        name: "request_teach_access",
	        input: {
	          apps: ["Safari"],
	          reason: "simulate user denied request_teach_access"
	        }
	      },
	      computerUseTeachStepResolver: () => ({ action: "next" }),
	      approvalResolver: () => ({
	        approved: true,
	        computerUse: {
	          grantedApps: [],
	          deniedApps: ["Safari"],
	          userConsented: false
	        }
	      })
	    });
	    assert.equal(registeredTeachDenied.isError, undefined);
	    assert.doesNotMatch(registeredTeachDenied.content, /Permission ask:|approval-required/);
	    assert.match(registeredTeachDenied.content, /"teachModeActive":\s*false/);
	    assert.match(registeredTeachDenied.content, /"user_denied"/);
	    assert.doesNotMatch(registeredTeachDenied.content, /Call screenshot next/);
	    assert.equal(getComputerUseSessionState({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "registered-teach-denied-session" }).grants.length, 0);
	    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "registered-teach-denied-session" });

	    const tccMissing = await executeRegisteredTool({
	      cwd: project,
	      kiraWorkspaceRoot: workspace,
      sessionId: "tcc-missing-session",
      permissionMode: "auto",
      toolUse: {
        id: "tcc-missing",
        type: "tool-use",
        name: "ComputerUse",
        input: {
          action: "request_access",
          apps: ["Safari"],
          reason: "test missing macOS permissions"
        }
      },
      approvalResolver: () => ({
        approved: true,
        computerUse: {
          tccState: {
            accessibility: false,
            screenRecording: false
          },
          userConsented: true
        }
      })
    });
    assert.equal(tccMissing.isError, undefined);
    assert.match(
      tccMissing.content,
      /macOS Accessibility and Screen Recording are now both granted|macOS Accessibility and Screen Recording permission\(s\) not yet granted/
    );
    assert.match(tccMissing.content, /call request_access again/i);

    const tccTeachMissing = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "tcc-teach-missing-session",
      permissionMode: "auto",
      toolUse: {
        id: "tcc-teach-missing",
        type: "tool-use",
        name: "ComputerUse",
        input: {
          action: "request_teach_access",
          apps: ["Safari"],
          reason: "test missing macOS permissions for teach mode"
        }
      },
      computerUseTeachStepResolver: () => ({ action: "next" }),
      approvalResolver: () => ({
        approved: true,
        computerUse: {
          tccState: {
            accessibility: true,
            screenRecording: false
          },
          userConsented: true
        }
      })
    });
    assert.equal(tccTeachMissing.isError, undefined);
    assert.match(
      tccTeachMissing.content,
      /macOS Accessibility and Screen Recording are now both granted|macOS Screen Recording permission\(s\) not yet granted/
    );
    assert.match(tccTeachMissing.content, /call request_teach_access again/i);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace, sessionId: "tcc-teach-missing-session" });

    const teachStep = parseComputerUseInput({
      action: "teach_step",
      explanation: "This is the search field.",
      next_preview: "Next: I will click the field.",
      anchor: [50, 60],
      actions: [{ action: "click", x: 50, y: 60 }]
    });
    assert.equal(teachStep.next_preview, "Next: I will click the field.");
    assert.deepEqual(teachStep.anchor, [50, 60]);
    const teachBatch = parseComputerUseInput({
      action: "teach_batch",
      steps: [
        {
          explanation: "Step one",
          nextPreview: "Next: wait briefly.",
          actions: [{ action: "wait", durationMs: 10 }]
        }
      ]
    });
    assert.equal(teachBatch.steps?.[0]?.nextPreview, "Next: wait briefly.");

    const unavailableTeach = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      permissionMode: "auto",
      toolUse: {
        id: "teach-unavailable",
        type: "tool-use",
        name: "ComputerUse",
        input: { action: "request_teach_access", apps: ["Safari"], reason: "teach without host resolver" }
      },
      approvalResolver: () => true
    });
    assert.equal(unavailableTeach.isError, true);
    assert.match(unavailableTeach.content, /teach mode is not available/);
    await releaseComputerUseSession({ cwd: project, kiraWorkspaceRoot: workspace });

    const inactiveTeachStep = await executeRegisteredTool({
      cwd: project,
      kiraWorkspaceRoot: workspace,
      sessionId: "teach-session",
      permissionMode: "auto",
      toolUse: {
        id: "teach-step",
        type: "tool-use",
        name: "ComputerUse",
        input: {
          action: "teach_step",
          explanation: "Look at this button.",
          next_preview: "Next: continue without actions.",
          actions: []
        }
      },
      computerUseTeachStepResolver: () => ({ action: "next" })
    });
    assert.equal(inactiveTeachStep.isError, true);
    assert.match(inactiveTeachStep.content, /Teach mode is not active/);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }

  console.log("computer use alignment tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
