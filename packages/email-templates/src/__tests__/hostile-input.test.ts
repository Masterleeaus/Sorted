import { describe, expect, it } from "vitest";
import {
  bookingConfirmedEmailHtml,
  clientReactivationHtml,
  estimateEmailHtml,
  estimateEmailText,
  estimateFollowupHtml,
  intakeInviteEmailHtml,
  intakeInviteEmailText,
  invoiceEmailHtml,
  invoiceEmailText,
  invoiceFollowupEmailHtml,
  onMyWayEmailHtml,
  portalMagicLinkHtml,
  recurringInspectionHtml,
  reviewRequestEmailHtml,
  seasonalReminderHtml,
  visitReminderEmailHtml,
} from "../index.js";

const TAG = `<img src=x onerror="alert(1)">`;
const NAME = `"><script>alert(1)</script>`;
const AMP = `Tom & Jerry's "Repairs"`;
const JS_URL = "javascript:alert(document.cookie)";
const SAFE_URL = "https://example.test/view?a=1&b=2";

/** Output must contain no active markup or unsafe link from hostile input. */
function assertNoActiveMarkup(html: string) {
  // No live injected elements: escaped text shows as &lt;img ... and is inert.
  expect(html).not.toMatch(/<(script|img|svg|iframe|object|embed|style\s*\/)/i);
  expect(html).not.toMatch(/<[^>]*\son\w+\s*=/i);
  expect(html).not.toMatch(/href\s*=\s*"\s*javascript:/i);
  expect(html).not.toMatch(/href\s*=\s*"\s*data:/i);
}

describe("HTML email templates escape hostile values", () => {
  it("invoiceEmailHtml (unpaid)", () => {
    const html = invoiceEmailHtml({
      invoiceNumber: TAG,
      clientName: NAME,
      totalCents: 100,
      balanceCents: 100,
      dueDateStr: AMP,
      viewUrl: JS_URL,
      notes: TAG,
    });
    assertNoActiveMarkup(html);
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain("Tom &amp; Jerry&#39;s &quot;Repairs&quot;");
    expect(html).toContain('href="#"');
  });

  it("invoiceEmailHtml (paid receipt)", () => {
    const html = invoiceEmailHtml({
      invoiceNumber: TAG,
      clientName: NAME,
      totalCents: 100,
      balanceCents: 0,
      dueDateStr: null,
      viewUrl: JS_URL,
      notes: AMP,
      isPaid: true,
      paidAtStr: TAG,
    });
    assertNoActiveMarkup(html);
    expect(html).toContain("Tom &amp; Jerry&#39;s");
  });

  it("invoiceFollowupEmailHtml", () => {
    const html = invoiceFollowupEmailHtml({
      clientName: NAME,
      invoiceNumber: TAG,
      totalCents: 100,
      balanceCents: 100,
      daysOverdue: 3,
      viewUrl: JS_URL,
    });
    assertNoActiveMarkup(html);
  });

  it("estimateEmailHtml escapes URLs and text", () => {
    const html = estimateEmailHtml({
      estimateRef: TAG,
      clientName: NAME,
      totalCents: 100,
      depositCents: 50,
      balanceCents: 50,
      expiresStr: AMP,
      notes: TAG,
      approveUrl: JS_URL,
      declineUrl: "data:text/html,<script>x</script>",
      viewUrl: JS_URL,
    });
    assertNoActiveMarkup(html);
    expect(html).not.toContain("data:text/html");
    expect(html).toContain('href="#"');
  });

  it("estimateFollowupHtml", () => {
    assertNoActiveMarkup(
      estimateFollowupHtml({
        clientName: NAME,
        estimateNumber: TAG,
        totalCents: 100,
        daysSinceSent: 2,
        viewUrl: JS_URL,
      }),
    );
  });

  it("visit templates", () => {
    const base = {
      clientName: NAME,
      jobTitle: TAG,
      propertyAddress: AMP,
      techName: `" onmouseover="alert(1)`,
    };
    assertNoActiveMarkup(
      visitReminderEmailHtml({ ...base, scheduledStart: "2026-07-15T14:00:00.000Z" }),
    );
    assertNoActiveMarkup(
      onMyWayEmailHtml({ ...base, when: TAG }),
    );
    const booking = bookingConfirmedEmailHtml({
      ...base,
      scheduledStart: "2026-07-15T14:00:00.000Z",
      scheduledEnd: "2026-07-15T16:00:00.000Z",
    });
    assertNoActiveMarkup(booking);
    expect(booking).toContain("&quot; onmouseover=&quot;alert(1)");
  });

  it("intakeInviteEmailHtml escapes name and blocks javascript: link", () => {
    const html = intakeInviteEmailHtml({ leadName: NAME, intakeUrl: JS_URL });
    assertNoActiveMarkup(html);
    expect(html).toContain('href="#"');
  });

  it("intakeInviteEmailHtml keeps a safe link escaped", () => {
    const html = intakeInviteEmailHtml({ leadName: "Jane", intakeUrl: SAFE_URL });
    expect(html).toContain('href="https://example.test/view?a=1&amp;b=2"');
  });

  it("reviewRequestEmailHtml", () => {
    assertNoActiveMarkup(
      reviewRequestEmailHtml({ clientName: NAME, jobTitle: TAG, techName: TAG }),
    );
  });

  it("automation templates", () => {
    assertNoActiveMarkup(clientReactivationHtml({ clientName: NAME, monthsSinceLastService: 2 }));
    assertNoActiveMarkup(
      recurringInspectionHtml({ clientName: NAME, planName: TAG, propertyAddress: AMP }),
    );
    assertNoActiveMarkup(seasonalReminderHtml({ clientName: NAME, season: "spring" }));
  });

  it("portalMagicLinkHtml escapes name and blocks javascript: links", () => {
    const html = portalMagicLinkHtml(`${TAG} Doe`, JS_URL);
    assertNoActiveMarkup(html);
    expect(html).toContain('href="#"');
    const safe = portalMagicLinkHtml("Jane", "https://example.test/verify?token=abc&x=1");
    expect(safe).toContain('href="https://example.test/verify?token=abc&amp;x=1"');
  });
});

describe("plain-text bodies stay readable", () => {
  it("does not HTML-escape text bodies", () => {
    const text = invoiceEmailText({
      invoiceNumber: "INV-1",
      clientName: AMP,
      totalCents: 100,
      balanceCents: 100,
      dueDateStr: null,
      viewUrl: SAFE_URL,
      notes: TAG,
    });
    expect(text).toContain(AMP);
    expect(text).toContain(TAG);
    expect(estimateEmailText({
      estimateRef: "E-1",
      clientName: AMP,
      totalCents: 100,
      depositCents: 0,
      balanceCents: 100,
      expiresStr: null,
      notes: null,
      approveUrl: SAFE_URL,
      declineUrl: SAFE_URL,
      viewUrl: SAFE_URL,
    })).toContain(AMP);
    expect(intakeInviteEmailText({ leadName: AMP, intakeUrl: SAFE_URL })).toContain(AMP);
  });
});
