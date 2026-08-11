/** @happy-dom */
import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SnsStaleName } from "@/hooks/use-sns-name";
import { StaleNamesNotice } from "./preferences-form";

const named: SnsStaleName = {
  name: "albert",
  subdomainKey: "AkDFqNHoXnRJy4Fj9wckiD9mdvMm9vC9T8hxUTEi2t1d",
  owner: "5Y9NAh96g9rrRe7D7CxspNCXPWcq7dRPXgENVQfMhHcN",
};

afterEach(() => {
  cleanup();
});

describe("StaleNamesNotice", () => {
  it("renders nothing when there are no leftover names", () => {
    const { container } = render(
      <StaleNamesNotice staleNames={[]} parentDomain="utxopia" busy={false} onRelease={async () => true} />,
    );
    expect(container.textContent).toBe("");
  });

  it("releases by name", async () => {
    const released: string[] = [];
    render(
      <StaleNamesNotice
        staleNames={[named]}
        parentDomain="utxopia"
        busy={false}
        onRelease={async (name) => {
          released.push(name);
          return true;
        }}
      />,
    );

    expect(screen.getByText("albert.utxopia.sol")).toBeTruthy();
    fireEvent.click(screen.getByText("Release"));
    await waitFor(() => expect(released).toEqual(["albert"]));
  });

  it("cannot release a record whose reverse name is missing", () => {
    render(
      <StaleNamesNotice
        staleNames={[{ ...named, name: null }]}
        parentDomain="utxopia"
        busy={false}
        onRelease={async () => true}
      />,
    );

    // Delete is by name, so an unresolvable record has nothing to send.
    expect(screen.getByText("AkDFqNHo…")).toBeTruthy();
    expect((screen.getByText("Release") as HTMLButtonElement).disabled).toBe(true);
  });

  it("blocks releasing while another action is in flight", () => {
    render(
      <StaleNamesNotice staleNames={[named]} parentDomain="utxopia" busy onRelease={async () => true} />,
    );
    expect((screen.getByText("Release") as HTMLButtonElement).disabled).toBe(true);
  });
});
