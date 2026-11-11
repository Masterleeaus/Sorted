import { escapeEmailText, safeEmailHref } from "@ai-fsm/email-templates";

export function portalMagicLinkHtml(name: string, url: string): string {
  const firstName = escapeEmailText(name.split(" ")[0]);
  const safeUrl = escapeEmailText(safeEmailHref(url));
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:48px auto;background:#fff;border-radius:10px;border:1px solid #e5e7eb;padding:40px;">
    <h1 style="margin:0 0 6px;font-size:22px;font-weight:700;color:#111;">Your portal link</h1>
    <p style="margin:0 0 24px;color:#6b7280;font-size:15px;">Hi ${firstName}, click below to access your account.</p>
    <a href="${safeUrl}"
       style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:13px 28px;border-radius:7px;font-size:15px;font-weight:600;letter-spacing:.01em;">
      Open my portal
    </a>
    <p style="margin:28px 0 0;font-size:12px;color:#9ca3af;line-height:1.5;">
      This link expires in 1 hour and can only be used once.<br>
      If you didn't request this, no action is needed.
    </p>
  </div>
</body>
</html>`;
}
