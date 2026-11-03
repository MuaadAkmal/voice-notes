import { expect, it } from "vitest";
import { deviceName } from "@/lib/device";

it("names the browser", () => {
  const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  expect(deviceName(chrome)).toBe("Web · Chrome");
  expect(deviceName(chrome + " Edg/140.0.0.0")).toBe("Web · Edge");
  expect(deviceName("Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Web · Firefox");
  expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Web · Safari");
  expect(deviceName("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0 Mobile Safari/537.36")).toBe("Web · Samsung Internet");
  expect(deviceName("curl/8")).toBe("Web · Browser");
});
