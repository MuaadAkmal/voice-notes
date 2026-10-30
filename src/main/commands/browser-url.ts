import { isChromium, normaliseUrl } from '../../shared/capture-line';
import type { Capture } from './capture';
import { runPowerShell, type RunPowerShell } from './powershell';

// The address bar of a Chromium browser window, read through UI Automation. Its name is localised,
// so it is found as the first Edit control with a value, which in Chromium is the omnibox (the
// toolbar comes before the page in the tree). Its value is kept only if it reads as a web address.

const SCRIPT = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$root = $A::FromHandle([IntPtr][long]$env:VN_HWND)
$cond = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)),
  (New-Object System.Windows.Automation.PropertyCondition($A::IsValuePatternAvailableProperty, $true)))
$edit = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
$url = $null
if ($edit) { $url = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
@{ url = $url } | ConvertTo-Json -Compress
`;

export async function readBrowserUrl(c: Capture, run: RunPowerShell = runPowerShell): Promise<string | null> {
  if (!isChromium(c.processName)) return null;
  const out = (await run(SCRIPT, { VN_HWND: String(c.hwnd) })) as { url?: unknown } | null;
  return out && typeof out === 'object' && typeof out.url === 'string' ? normaliseUrl(out.url) : null;
}
