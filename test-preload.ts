import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { mock } from "bun:test";
import { createElement } from "react";

// happy-dom has no document origin, so next/image's loader throws "Invalid URL"
// on the app-relative `/tokens/*.png` sources. Components under test only care
// that the image renders, not how Next optimizes it.
mock.module("next/image", () => ({
  default: ({ src, alt, ...rest }: { src: string; alt?: string }) =>
    createElement("img", { src, alt: alt ?? "", ...rest }),
}));
