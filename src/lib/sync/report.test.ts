import { describe, expect, it } from "vitest";
import { reportProblem, SCREENSHOT_MAX, type Report } from "./report";

const ok: Report = { name: "A", email: "a@b.co", body: "The app froze when I added a task.", appVersion: "1.1.2", platform: "windows", screenshot: null };

describe("reportProblem", () => {
  it("accepts a complete report and rejects a bad email or short description", () => {
    expect(reportProblem(ok)).toBeNull();
    expect(reportProblem({ ...ok, email: "nope" })).toMatch(/email/);
    expect(reportProblem({ ...ok, body: "broken" })).toMatch(/Describe/);
    expect(reportProblem({ ...ok, body: "x".repeat(5001) })).toMatch(/too long/);
  });
  it("limits the screenshot to a 5 MB image", () => {
    const shot = (type: string, size: number) => ({ ...ok, screenshot: { name: "s", type, bytes: new Uint8Array(size) } });
    expect(reportProblem(shot("image/png", 10))).toBeNull();
    expect(reportProblem(shot("application/pdf", 10))).toMatch(/screenshot/);
    expect(reportProblem(shot("image/png", SCREENSHOT_MAX + 1))).toMatch(/5 MB/);
  });
});
