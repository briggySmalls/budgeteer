import { describe, expect, it } from "vitest";
import { IngestionError } from "../models";
import { listSpreadsheets } from "./googleAuth";
import type { FetchLike } from "./googleSheets";

describe("listSpreadsheets", () => {
  it("queries Drive for spreadsheets with auth and returns the files", async () => {
    const capture: { url?: string; auth?: string } = {};
    const fetchImpl: FetchLike = (url, init) => {
      capture.url = url;
      capture.auth = init?.headers?.Authorization;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ files: [{ id: "1", name: "Budget" }] }),
        text: () => Promise.resolve(""),
      });
    };
    const files = await listSpreadsheets("tok", fetchImpl);
    expect(files).toEqual([{ id: "1", name: "Budget" }]);
    expect(capture.auth).toBe("Bearer tok");
    expect(capture.url).toContain("mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27");
  });

  it("returns [] when Drive reports no files", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });
    expect(await listSpreadsheets("tok", fetchImpl)).toEqual([]);
  });

  it("raises IngestionError on an HTTP error", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve("nope"),
      });
    await expect(listSpreadsheets("tok", fetchImpl)).rejects.toBeInstanceOf(IngestionError);
  });
});
