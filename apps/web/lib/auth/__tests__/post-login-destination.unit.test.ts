import { describe, expect, it } from "vitest";
import {
  allowlistedPostLoginNext,
  loginRedirectForPath,
  readWorkspaceModeCookie,
  resolvePostLoginHref,
} from "../post-login-destination";

describe("resolvePostLoginHref", () => {
  it("sends technicians to Today on every device", () => {
    expect(resolvePostLoginHref("tech", { isPhone: false })).toBe("/app/my-work");
    expect(resolvePostLoginHref("tech", { isPhone: true })).toBe("/app/my-work");
  });

  it("sends owner/admin to Titan Go Command on every device", () => {
    expect(resolvePostLoginHref("admin", { isPhone: true })).toBe("/app");
    expect(resolvePostLoginHref("owner", { isPhone: false })).toBe("/app");
    expect(resolvePostLoginHref("owner", { isPhone: true })).toBe("/app");
  });

  it("ignores legacy workspace mode cookies for Titan Go landing", () => {
    expect(resolvePostLoginHref("owner", { isPhone: false, cookieHeader: "dv_ws_mode=field" })).toBe("/app");
    expect(resolvePostLoginHref("owner", { isPhone: true, cookieHeader: "dv_ws_mode=office" })).toBe("/app");
  });

  it("honors the allowlisted capture next path", () => {
    expect(resolvePostLoginHref("owner", { next: "/app/capture" })).toBe("/app/capture");
    expect(resolvePostLoginHref("admin", { next: "/app/jobs" })).toBe("/app");
  });
});

describe("readWorkspaceModeCookie", () => {
  it("still reads legacy field/office values", () => {
    expect(readWorkspaceModeCookie(null)).toBeNull();
    expect(readWorkspaceModeCookie("foo=bar")).toBeNull();
    expect(readWorkspaceModeCookie("dv_ws_mode=auto")).toBeNull();
    expect(readWorkspaceModeCookie("dv_ws_mode=field")).toBe("field");
    expect(readWorkspaceModeCookie("a=1; dv_ws_mode=office; b=2")).toBe("office");
  });
});

describe("capture redirect helpers", () => {
  it("only allowlists capture", () => {
    expect(allowlistedPostLoginNext("/app/capture")).toBe("/app/capture");
    expect(allowlistedPostLoginNext("/app/jobs")).toBeNull();
  });

  it("adds next only for capture", () => {
    expect(loginRedirectForPath("/app/capture")).toBe("/login?next=/app/capture");
    expect(loginRedirectForPath("/app/jobs")).toBe("/login");
  });
});
