/** @happy-dom */
import { describe, it, expect, afterEach } from "bun:test";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { TokenSourcePicker } from "./token-source-picker";

afterEach(cleanup);

describe("TokenSourcePicker", () => {
  it("is disabled when recipient type is btc, locked to zkBTC", () => {
    render(
      <TokenSourcePicker
        recipientType="btc"
        selected="zkBTC"
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole("button");
    expect(button).toBeDefined();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/zkBTC/i)).toBeDefined();
  });

  it("is enabled for stealth_sns (any shielded token)", () => {
    render(
      <TokenSourcePicker
        recipientType="stealth_sns"
        selected="zkBTC"
        onSelect={() => {}}
      />,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("inline renders a plain chip when locked to zkBTC, not a dead dropdown", () => {
    render(
      <TokenSourcePicker
        variant="inline"
        recipientType="btc"
        selected="zkBTC"
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("zkBTC")).toBeDefined();
  });

  it("inline opens the asset menu", () => {
    let picked = "";
    render(
      <TokenSourcePicker
        variant="inline"
        recipientType="stealth_sns"
        selected="zkBTC"
        onSelect={(s) => {
          picked = s;
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("token-source-trigger"));
    fireEvent.click(screen.getByTestId("token-source-zkSOL"));
    expect(picked).toBe("zkSOL");
  });

  it("is enabled for spl_wallet", () => {
    render(
      <TokenSourcePicker
        recipientType="spl_wallet"
        selected="zkBTC"
        onSelect={() => {}}
      />,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
