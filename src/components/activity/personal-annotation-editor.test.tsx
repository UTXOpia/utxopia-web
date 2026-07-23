import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { PersonalAnnotationEditor } from "./personal-annotation-editor";

describe("PersonalAnnotationEditor", () => {
  it("creates a personal label and note", () => {
    const onSave = mock();
    render(<PersonalAnnotationEditor onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "Add personal label or note" }));
    fireEvent.change(screen.getByLabelText("Personal label"), {
      target: { value: "Relay fee" },
    });
    fireEvent.change(screen.getByLabelText("Personal note"), {
      target: { value: "Fee from test transaction" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(onSave).toHaveBeenCalledWith({
      label: "Relay fee",
      note: "Fee from test transaction",
    });
  });

  it("removes an existing annotation", () => {
    const onSave = mock();
    render(
      <PersonalAnnotationEditor
        annotation={{ label: "Relay fee", note: "Test", updatedAt: 1 }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove personal label and note" }));
    expect(onSave).toHaveBeenCalledWith({});
  });
});
