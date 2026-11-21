// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootLayout, { metadata } from "../../app/layout";

describe("RootLayout", () => {
  it("renderiza el documento y expone los metadatos", () => {
    const html = renderToStaticMarkup(
      <RootLayout>
        <main>contenido</main>
      </RootLayout>,
    );

    expect(html).toContain('<html lang="en">');
    expect(html).toContain("contenido");
    expect(metadata.title).toBe("Starter Project");
  });
});
