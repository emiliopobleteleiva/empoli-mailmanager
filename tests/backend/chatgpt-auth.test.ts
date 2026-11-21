// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => state.values.get(name) ?? null,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: state.redirect,
}));

import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
  requireChatGPTUser,
} from "../../app/chatgpt-auth";

beforeEach(() => {
  state.values.clear();
  state.redirect.mockReset();
  state.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe("getChatGPTUser", () => {
  it("devuelve null si no hay identidad", async () => {
    await expect(getChatGPTUser()).resolves.toBeNull();
  });

  it("lee la identidad y decodifica el nombre completo", async () => {
    state.values.set("oai-authenticated-user-id", "u1");
    state.values.set("oai-authenticated-user-email", "bruno.silva@example.com");
    state.values.set(
      "oai-authenticated-user-full-name",
      encodeURIComponent("Bruno Silva"),
    );
    state.values.set(
      "oai-authenticated-user-full-name-encoding",
      "percent-encoded-utf-8",
    );

    await expect(getChatGPTUser()).resolves.toEqual({
      userId: "u1",
      displayName: "Bruno Silva",
      email: "bruno.silva@example.com",
      fullName: "Bruno Silva",
    });
  });

  it("tolera un nombre completo mal codificado", async () => {
    state.values.set("oai-authenticated-user-id", "u1");
    state.values.set("oai-authenticated-user-email", "bruno.silva@example.com");
    state.values.set("oai-authenticated-user-full-name", "%E0%A4%A");
    state.values.set(
      "oai-authenticated-user-full-name-encoding",
      "percent-encoded-utf-8",
    );

    const user = await getChatGPTUser();
    expect(user?.displayName).toBe("bruno.silva@example.com");
    expect(user?.fullName).toBeNull();
  });

  it("ignora el nombre si la codificación no es la esperada", async () => {
    state.values.set("oai-authenticated-user-id", "u1");
    state.values.set("oai-authenticated-user-email", "bruno.silva@example.com");
    state.values.set("oai-authenticated-user-full-name", "Mar%C3%ADa");
    state.values.set("oai-authenticated-user-full-name-encoding", "otra");

    const user = await getChatGPTUser();
    expect(user?.fullName).toBeNull();
  });
});

describe("rutas de autenticación", () => {
  it("codifica un returnTo relativo seguro", () => {
    expect(chatGPTSignInPath("/tareas?x=1")).toBe(
      "/signin-with-chatgpt?return_to=%2Ftareas%3Fx%3D1",
    );
  });

  it("rechaza returnTo externos o rutas reservadas", () => {
    expect(chatGPTSignInPath("//evil.example")).toBe(
      "/signin-with-chatgpt?return_to=%2F",
    );
    expect(chatGPTSignInPath("/signin-with-chatgpt")).toBe(
      "/signin-with-chatgpt?return_to=%2F",
    );
  });

  it("arma la ruta de salida", () => {
    expect(chatGPTSignOutPath()).toBe("/signout-with-chatgpt?return_to=%2F");
  });

  it("requireChatGPTUser devuelve al usuario autenticado", async () => {
    state.values.set("oai-authenticated-user-id", "u1");
    state.values.set("oai-authenticated-user-email", "bruno.silva@example.com");
    await expect(requireChatGPTUser("/")).resolves.toMatchObject({
      userId: "u1",
    });
  });

  it("requireChatGPTUser redirige al login si no hay sesión", async () => {
    await expect(requireChatGPTUser("/tareas")).rejects.toThrow(
      "redirect:/signin-with-chatgpt?return_to=%2Ftareas",
    );
  });
});
