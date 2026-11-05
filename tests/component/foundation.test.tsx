import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import HomePage from "@/app/page";

test("the app foundation presents Mathaino in its main landmark", () => {
  render(<HomePage />);

  expect(screen.getByRole("main")).toContainElement(
    screen.getByRole("heading", { level: 1, name: "Mathaino" }),
  );
});
