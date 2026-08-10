import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RedeemInvite } from "./redeem-invite";

// No wallet provider is mounted, so `useWallet` yields the disconnected
// default — which is the state an invited person is in when the link from the
// mail opens. Deliberately not `mock.module`: that is global in Bun and would
// replace the wallet adapter for every other test file in the run.

afterEach(cleanup);

describe("RedeemInvite", () => {
  it("prefills the code from the invite link so nobody retypes twenty characters", () => {
    render(<RedeemInvite networkId="devnet-regtest" initialCode="ABCDE-FGHIJ-KLMNO-PQRST" />);

    const input = screen.getByPlaceholderText("XXXXX-XXXXX-XXXXX-XXXXX") as HTMLInputElement;
    expect(input.value).toBe("ABCDE-FGHIJ-KLMNO-PQRST");
  });

  it("never redeems on its own — the irreversible four have to be read first", () => {
    render(<RedeemInvite networkId="devnet-regtest" initialCode="ABCDE-FGHIJ-KLMNO-PQRST" />);

    // A code alone is not enough: the address that becomes the membership is
    // still blank, and redeeming binds it permanently.
    const button = screen.getByRole("button", { name: "Redeem invite code" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("will not redeem to an address that is the wrong length", () => {
    render(<RedeemInvite networkId="devnet-regtest" initialCode="ABCDE-FGHIJ-KLMNO-PQRST" />);
    const address = screen.getByPlaceholderText(
      "Paste the address that will be your membership",
    );
    const button = screen.getByRole("button", { name: "Redeem invite code" }) as HTMLButtonElement;

    // Base58 with no checksum means length is the only cheap signal there is.
    fireEvent.change(address, { target: { value: "9MFnVxiXKtb" } });
    expect(button.disabled).toBe(true);

    fireEvent.change(address, {
      target: { value: "9MFnVxiXKtbduErMNm6gSsHdkBjUa5tcNpRQwZK12AnU" },
    });
    expect(button.disabled).toBe(false);
  });

  it("points people without a code at the application, not at a code", () => {
    render(<RedeemInvite networkId="devnet-regtest" />);

    const link = screen.getByRole("link", { name: "Apply for a seat" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain("/apply");
    expect((screen.getByPlaceholderText("XXXXX-XXXXX-XXXXX-XXXXX") as HTMLInputElement).value).toBe("");
  });
});
