import { expect, test } from "vitest";
import { localCalendarDate } from "@/domain/calendar-day";

test("attributes instants on opposite sides of local midnight to different days", () => {
  expect(
    localCalendarDate(new Date("2026-01-02T04:59:59.999Z"), "America/New_York"),
  ).toBe("2026-01-01");
  expect(
    localCalendarDate(new Date("2026-01-02T05:00:00.000Z"), "America/New_York"),
  ).toBe("2026-01-02");
});

test("the active timezone determines the date without rebucketing earlier facts", () => {
  const instant = new Date("2026-01-02T01:00:00Z");
  expect(localCalendarDate(instant, "Etc/UTC")).toBe("2026-01-02");
  expect(localCalendarDate(instant, "America/Los_Angeles")).toBe("2026-01-01");
});

test("daylight-saving boundaries use calendar dates rather than elapsed days", () => {
  expect(
    localCalendarDate(new Date("2026-03-08T04:59:59Z"), "America/New_York"),
  ).toBe("2026-03-07");
  expect(
    localCalendarDate(new Date("2026-03-08T05:00:00Z"), "America/New_York"),
  ).toBe("2026-03-08");
});
