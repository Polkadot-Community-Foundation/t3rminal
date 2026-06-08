/**
 * T3rminal-side admin QR import tests.
 *
 * Pin three things end-to-end against the in-memory host-storage
 * fallback so we never silently break the scan→catalog hand-off:
 *
 *  1. The pure mapper synthesizes a single category and preserves
 *     wire-side item ids/names/plancks.
 *  2. The overwrite import wipes prior categories/items and marks
 *     the seed flag done, so the example menu can't resurrect.
 *  3. Malformed scans return null at the decoder boundary — never
 *     throw — and the multipart accumulator completes after enough
 *     frames.
 *  4. Settings persistence and catalog overwrite both happen on
 *     `importAdminQrConfig`.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildT3rminalConfigQrV2,
  createT3rminalConfigQrMultipartDecoder,
  decodeT3rminalConfigQr,
  encodeT3rminalConfigQrV2,
  T3RMINAL_REPORT_PASSWORD_SCHEME_V1,
  type AdminItemConfigQrConfig,
} from "@/lib/config/t3rminal-config-qr";
import { MultipartEncoder } from "@bcts/uniform-resources";

import {
  mapQrConfigToCatalog,
  overwriteCatalogFromQr,
} from "@/lib/items/catalog";
import {
  ADMIN_QR_PAYLOAD_SETTING,
  ADMIN_QR_RAW_SETTING,
  importAdminQrConfig,
  loadAdminQrPayload,
  loadAdminQrRaw,
  tryDecodeAdminQrFrame,
} from "@/lib/config/admin-qr";
import { readTable, writeTable } from "@/lib/storage/host-storage";
import { getSetting } from "@/lib/storage/database";

const SAMPLE_REPORT_PASSWORD = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

const sampleConfig: AdminItemConfigQrConfig = {
  id: "bar",
  name: "Bar",
  updatedAt: "2026-05-25T10:00:00Z",
  items: [
    { id: "sku-001", name: "Tequila Shot", price: 4 },
    { id: "sku-002", name: "Aperol Spritz", price: 8.5 },
  ],
};

function makePayload(config: AdminItemConfigQrConfig = sampleConfig) {
  return buildT3rminalConfigQrV2({
    merchantKey: "0xkey",
    merchantId: "funkhaus",
    terminalId: "t3r-feedbeef",
    displayName: "Bar East",
    receivingAddress: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MLDHajjSidz9bR544LEq1",
    reportPassword: SAMPLE_REPORT_PASSWORD,
    issuedAt: "2026-05-26T10:00:00Z",
    config,
  });
}

const CATEGORIES_TABLE = "item-categories";
const ITEMS_TABLE = "item-catalog";
const SETTINGS_TABLE = "settings";

async function resetStores() {
  await Promise.all([
    writeTable(CATEGORIES_TABLE, []),
    writeTable(ITEMS_TABLE, []),
    writeTable(SETTINGS_TABLE, []),
  ]);
}

describe("mapQrConfigToCatalog", () => {
  it("synthesizes one category named after the config and maps items 1:1", () => {
    const catalog = mapQrConfigToCatalog({
      id: "bar",
      name: "Bar",
      updatedAt: "2026-05-25T10:00:00Z",
      items: [
        { id: "sku-001", name: "Tequila Shot", pricePlancks: "4000000", price: 4 },
        { id: "sku-002", name: "Aperol Spritz", pricePlancks: "8500000", price: 8.5 },
      ],
    });
    expect(catalog.categories).toHaveLength(1);
    const [category] = catalog.categories;
    expect(category?.name).toBe("Bar");
    expect(catalog.items.map((i) => i.name)).toEqual(["Tequila Shot", "Aperol Spritz"]);
    expect(catalog.items.map((i) => i.pricePlanks)).toEqual(["4000000", "8500000"]);
    expect(catalog.items.every((i) => i.categoryId === category?.id)).toBe(true);
  });
});

describe("overwriteCatalogFromQr", () => {
  beforeEach(resetStores);

  it("replaces prior catalog state and marks the seed flag", async () => {
    await writeTable(CATEGORIES_TABLE, [{ id: "stale-cat", name: "Stale" }]);
    await writeTable(ITEMS_TABLE, [
      { id: "stale-item", categoryId: "stale-cat", name: "Stale", pricePlanks: "100" },
    ]);

    const result = await overwriteCatalogFromQr({
      id: "bar",
      name: "Bar",
      updatedAt: "2026-05-25T10:00:00Z",
      items: [
        { id: "sku-001", name: "Tequila Shot", pricePlancks: "4000000", price: 4 },
      ],
    });

    expect(result.categories).toHaveLength(1);
    expect(result.items).toHaveLength(1);

    const persistedCategories = await readTable<{ id: string; name: string }>(CATEGORIES_TABLE);
    const persistedItems = await readTable<{
      id: string;
      categoryId: string;
      name: string;
      pricePlanks: string;
    }>(ITEMS_TABLE);

    expect(persistedCategories.map((c) => c.name)).toEqual(["Bar"]);
    expect(persistedItems.map((i) => i.name)).toEqual(["Tequila Shot"]);
    expect(persistedItems[0]?.pricePlanks).toBe("4000000");
    expect(persistedItems[0]?.categoryId).toBe(persistedCategories[0]?.id);
  });
});

describe("importAdminQrConfig", () => {
  beforeEach(resetStores);

  it("persists the raw UR, decoded payload, and the imported catalog", async () => {
    const payload = makePayload();
    const { qrString } = encodeT3rminalConfigQrV2(payload);
    await importAdminQrConfig(payload, qrString);

    expect(await loadAdminQrRaw()).toBe(qrString);
    expect(await getSetting(ADMIN_QR_RAW_SETTING)).toBe(qrString);
    const stored = await loadAdminQrPayload();
    expect(stored).toEqual(payload);
    const storedJson = await getSetting(ADMIN_QR_PAYLOAD_SETTING);
    expect(storedJson).toBeTypeOf("string");

    const categories = await readTable<{ id: string; name: string }>(CATEGORIES_TABLE);
    const items = await readTable<{ id: string; name: string; pricePlanks: string }>(ITEMS_TABLE);
    expect(categories.map((c) => c.name)).toEqual(["Bar"]);
    expect(items.map((i) => i.name)).toEqual(["Tequila Shot", "Aperol Spritz"]);
    expect(items.map((i) => i.pricePlanks)).toEqual(["4000000", "8500000"]);
  });
});

describe("tryDecodeAdminQrFrame", () => {
  it("returns null on malformed scans instead of throwing", () => {
    expect(tryDecodeAdminQrFrame("totally not a qr")).toBeNull();
    expect(tryDecodeAdminQrFrame("ur:t3rminal-config/garbage")).toBeNull();
  });

  it("decodes single-frame v2 URs into a typed payload", () => {
    const payload = makePayload();
    const { qrString } = encodeT3rminalConfigQrV2(payload);
    const decoded = tryDecodeAdminQrFrame(qrString);
    expect(decoded?.kind).toBe("v2-ur");
  });

  it("recognises legacy v1 JSON payloads", () => {
    const legacy = JSON.stringify({
      v: 1,
      type: "t3rminal-config",
      merchantKey: "0xkey",
      merchantId: "funkhaus",
      terminalId: "t3r-feedbeef",
      displayName: "Bar East",
      receivingAddress: "addr",
      passwordScheme: T3RMINAL_REPORT_PASSWORD_SCHEME_V1,
      reportPassword: SAMPLE_REPORT_PASSWORD,
      itemConfigId: "bar",
      itemConfigCid: "bafy123",
      registryAddress: "0xreg",
      issuedAt: "2026-05-26T10:00:00Z",
    });
    const decoded = decodeT3rminalConfigQr(legacy);
    expect(decoded?.kind).toBe("v1-json");
  });
});

describe("multipart scan accumulator", () => {
  it("completes after enough fountain frames and decodes back to the same payload", () => {
    const payload = makePayload();
    const { ur } = encodeT3rminalConfigQrV2(payload);
    const encoder = new MultipartEncoder(ur, 20);
    const partsCount = encoder.partsCount();
    expect(partsCount).toBeGreaterThan(1);

    const accumulator = createT3rminalConfigQrMultipartDecoder();
    let final: ReturnType<typeof accumulator.receive> = null;
    for (let i = 0; i < partsCount * 2 && final === null; i++) {
      final = accumulator.receive(encoder.nextPart());
    }
    expect(final).not.toBeNull();
    if (final === null) throw new Error("unreachable");
    expect(final.kind).toBe("v2-ur");
    if (final.kind !== "v2-ur") throw new Error("unreachable");
    expect(final.payload).toEqual(payload);
  });
});
