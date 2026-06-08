import {
  cbor,
  CborMap,
  type Cbor,
} from "@bcts/dcbor";
import { MultipartDecoder, UR } from "@bcts/uniform-resources";

export const T3RMINAL_CONFIG_QR_UR_TYPE = "t3rminal-config" as const;
export const T3RMINAL_CONFIG_QR_VERSION_V1 = 1 as const;
export const T3RMINAL_CONFIG_QR_VERSION_V2 = 2 as const;
export const T3RMINAL_CONFIG_QR_PRICE_DECIMALS = 6 as const;
export const T3RMINAL_REPORT_PASSWORD_SCHEME_V1 = "admin-public-key-sha256-v1" as const;

const PASSWORD_SCHEME_V1_WIRE = 1;
const PRICE_SCALE = 10 ** T3RMINAL_CONFIG_QR_PRICE_DECIMALS;
const PRICE_INTEGER_TOLERANCE_MINOR_UNITS = 1e-7;
const MAX_CBOR_UINT64 = 0xffffffffffffffffn;
const MAX_SAFE_PLANCKS = BigInt(Number.MAX_SAFE_INTEGER);
const TEXT_ENCODER = /* @__PURE__ */ new TextEncoder();

export const T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS = {
  v: 0,
  merchantKey: 1,
  merchantId: 2,
  terminalId: 3,
  displayName: 4,
  receivingAddress: 5,
  passwordScheme: 6,
  reportPassword: 7,
  issuedAt: 8,
  priceDecimals: 9,
  config: 10,
  profile: 11,
} as const;

export const T3RMINAL_CONFIG_QR_CONFIG_KEYS = {
  id: 0,
  name: 1,
  updatedAt: 2,
  items: 3,
} as const;

export const T3RMINAL_CONFIG_QR_PROFILE_KEYS = {
  name: 0,
  addressLine1: 1,
  addressLine2: 2,
  phone: 3,
  taxId: 4,
} as const;

export const T3RMINAL_CONFIG_QR_ITEM_TUPLE_POSITIONS = {
  id: 0,
  name: 1,
  priceMinorUnits: 2,
} as const;

export type T3rminalConfigQrPasswordScheme = typeof T3RMINAL_REPORT_PASSWORD_SCHEME_V1;

export interface QrItem {
  readonly id: string;
  readonly name: string;
  readonly pricePlancks: string;
  readonly price: number;
}

export interface QrItemConfig {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly items: ReadonlyArray<QrItem>;
}

export interface AdminItemConfigQrItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
}

export interface AdminItemConfigQrConfig {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly items: ReadonlyArray<AdminItemConfigQrItem>;
}

/**
 * Restaurant profile carried inline in the v2 UR at top-level key 11.
 *
 * `name` (the legal/restaurant name) is required whenever a profile is
 * present; every other field is optional and omitted from the wire map
 * when absent, keeping the encoding minimal and deterministic. The
 * shape is intentionally flat so a future Bulletin-published profile
 * (fetched by CID) can reuse the exact same type.
 */
export interface MerchantProfile {
  readonly name: string;
  readonly addressLine1?: string;
  readonly addressLine2?: string;
  readonly phone?: string;
  readonly taxId?: string;
}

export interface T3rminalConfigQrPayloadV1 {
  readonly v: typeof T3RMINAL_CONFIG_QR_VERSION_V1;
  readonly type: typeof T3RMINAL_CONFIG_QR_UR_TYPE;
  readonly merchantKey: string;
  readonly merchantId: string;
  readonly terminalId: string;
  readonly displayName: string;
  readonly receivingAddress: string;
  readonly passwordScheme: T3rminalConfigQrPasswordScheme;
  readonly reportPassword: string;
  readonly itemConfigId: string;
  readonly itemConfigCid: string;
  readonly registryAddress: string;
  readonly issuedAt: string;
}

export interface T3rminalConfigQrPayloadV2 {
  readonly v: typeof T3RMINAL_CONFIG_QR_VERSION_V2;
  readonly type: typeof T3RMINAL_CONFIG_QR_UR_TYPE;
  readonly merchantKey: string;
  readonly merchantId: string;
  readonly terminalId: string;
  readonly displayName: string;
  readonly receivingAddress: string;
  readonly passwordScheme: T3rminalConfigQrPasswordScheme;
  readonly reportPassword: string;
  readonly issuedAt: string;
  readonly priceDecimals: typeof T3RMINAL_CONFIG_QR_PRICE_DECIMALS;
  readonly config: QrItemConfig;
  /** Restaurant profile — optional, additive at top-level key 11. */
  readonly profile?: MerchantProfile;
}

export type DecodedT3rminalConfigQr =
  | { readonly kind: "v1-json"; readonly payload: T3rminalConfigQrPayloadV1 }
  | { readonly kind: "v2-ur"; readonly payload: T3rminalConfigQrPayloadV2 };

export interface BuildT3rminalConfigQrV2Args {
  readonly merchantKey: string;
  readonly merchantId: string;
  readonly terminalId: string;
  readonly displayName: string;
  readonly receivingAddress: string;
  readonly reportPassword: string;
  readonly issuedAt: string;
  readonly config: AdminItemConfigQrConfig;
  readonly profile?: MerchantProfile;
  readonly passwordScheme?: T3rminalConfigQrPasswordScheme;
  readonly priceDecimals?: typeof T3RMINAL_CONFIG_QR_PRICE_DECIMALS;
}

export interface EncodedT3rminalConfigQrV2 {
  readonly ur: UR;
  readonly qrString: string;
  /** UTF-8 byte length of the uppercase UR string carried by the QR matrix. */
  readonly byteLength: number;
}

export interface T3rminalConfigQrMultipartDecoder {
  receive(rawFrame: string): DecodedT3rminalConfigQr | null;
}

export function itemPriceToPlancks(price: number): bigint {
  if (!Number.isFinite(price)) throw new Error("Item price must be finite.");
  if (price < 0) throw new Error("Item price must be non-negative.");

  const scaled = price * PRICE_SCALE;
  if (!Number.isFinite(scaled)) throw new Error("Item price is too large.");

  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded)) throw new Error("Item price minor units exceed safe integer range.");
  if (Math.abs(scaled - rounded) > PRICE_INTEGER_TOLERANCE_MINOR_UNITS) {
    throw new Error(
      `Item price must have at most ${T3RMINAL_CONFIG_QR_PRICE_DECIMALS} decimal places.`,
    );
  }

  return BigInt(rounded);
}

export function plancksToItemPrice(plancks: bigint): number {
  if (plancks < 0n) throw new Error("Item price minor units must be non-negative.");
  if (plancks > MAX_SAFE_PLANCKS) {
    throw new Error("Item price minor units exceed safe integer range.");
  }
  return Number(plancks) / PRICE_SCALE;
}

export function buildT3rminalConfigQrV2(args: BuildT3rminalConfigQrV2Args): T3rminalConfigQrPayloadV2 {
  const passwordScheme = args.passwordScheme ?? T3RMINAL_REPORT_PASSWORD_SCHEME_V1;
  const priceDecimals = args.priceDecimals ?? T3RMINAL_CONFIG_QR_PRICE_DECIMALS;
  if (passwordScheme !== T3RMINAL_REPORT_PASSWORD_SCHEME_V1) {
    throw new Error(`Unsupported T3rminal QR password scheme: ${passwordScheme}`);
  }
  if (priceDecimals !== T3RMINAL_CONFIG_QR_PRICE_DECIMALS) {
    throw new Error(`Unsupported T3rminal QR price decimals: ${priceDecimals}`);
  }
  assertString(args.merchantKey, "merchantKey");
  assertString(args.merchantId, "merchantId");
  assertString(args.terminalId, "terminalId");
  assertString(args.displayName, "displayName");
  assertString(args.receivingAddress, "receivingAddress");
  assertReportPassword(args.reportPassword);
  assertString(args.issuedAt, "issuedAt");
  assertString(args.config.id, "config.id");
  assertString(args.config.name, "config.name");
  assertString(args.config.updatedAt, "config.updatedAt");
  const profile = normalizeMerchantProfile(args.profile);

  return {
    v: T3RMINAL_CONFIG_QR_VERSION_V2,
    type: T3RMINAL_CONFIG_QR_UR_TYPE,
    merchantKey: args.merchantKey,
    merchantId: args.merchantId,
    terminalId: args.terminalId,
    displayName: args.displayName,
    receivingAddress: args.receivingAddress,
    passwordScheme,
    reportPassword: args.reportPassword,
    issuedAt: args.issuedAt,
    priceDecimals,
    config: {
      id: args.config.id,
      name: args.config.name,
      updatedAt: args.config.updatedAt,
      items: args.config.items.map((item) => {
        assertString(item.id, "config.items[].id");
        assertString(item.name, "config.items[].name");
        const plancks = itemPriceToPlancks(item.price);
        return {
          id: item.id,
          name: item.name,
          pricePlancks: plancks.toString(10),
          price: plancksToItemPrice(plancks),
        };
      }),
    },
    ...(profile !== undefined ? { profile } : {}),
  };
}

export function encodeT3rminalConfigQrV2(
  payload: T3rminalConfigQrPayloadV2,
): EncodedT3rminalConfigQrV2 {
  const body = payloadToCbor(payload);
  const ur = UR.new(T3RMINAL_CONFIG_QR_UR_TYPE, body);
  const qrString = ur.qrString();
  return { ur, qrString, byteLength: TEXT_ENCODER.encode(qrString).length };
}

export function decodeT3rminalConfigQr(raw: string): DecodedT3rminalConfigQr | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const prefix = trimmed.slice(0, 3).toLowerCase();
  if (prefix === "ur:") return decodeT3rminalConfigQrUrString(trimmed);
  if (trimmed[0] === "{") return decodeT3rminalConfigQrJson(trimmed);
  return null;
}

export function createT3rminalConfigQrMultipartDecoder(): T3rminalConfigQrMultipartDecoder {
  const decoder = new MultipartDecoder();
  return {
    receive(rawFrame: string): DecodedT3rminalConfigQr | null {
      const trimmed = rawFrame.trim();
      if (trimmed.length === 0) return null;
      if (trimmed[0] === "{") return decodeT3rminalConfigQrJson(trimmed);
      if (trimmed.slice(0, 3).toLowerCase() !== "ur:") return null;

      const single = decodeT3rminalConfigQrUrString(trimmed);
      if (single !== null) return single;

      try {
        decoder.receive(trimmed);
        if (!decoder.isComplete()) return null;
        const message = decoder.message();
        return message === null ? null : decodeT3rminalConfigQrUr(message);
      } catch {
        return null;
      }
    },
  };
}

function payloadToCbor(payload: T3rminalConfigQrPayloadV2): Cbor {
  if (payload.v !== T3RMINAL_CONFIG_QR_VERSION_V2) throw new Error("Unsupported T3rminal QR version.");
  if (payload.type !== T3RMINAL_CONFIG_QR_UR_TYPE) throw new Error("Unsupported T3rminal QR type.");
  if (payload.passwordScheme !== T3RMINAL_REPORT_PASSWORD_SCHEME_V1) {
    throw new Error(`Unsupported T3rminal QR password scheme: ${payload.passwordScheme}`);
  }
  if (payload.priceDecimals !== T3RMINAL_CONFIG_QR_PRICE_DECIMALS) {
    throw new Error(`Unsupported T3rminal QR price decimals: ${payload.priceDecimals}`);
  }
  assertReportPassword(payload.reportPassword);

  const top = new CborMap();
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.v, payload.v);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.merchantKey, payload.merchantKey);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.merchantId, payload.merchantId);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.terminalId, payload.terminalId);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.displayName, payload.displayName);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.receivingAddress, payload.receivingAddress);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.passwordScheme, PASSWORD_SCHEME_V1_WIRE);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.reportPassword, payload.reportPassword);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.issuedAt, payload.issuedAt);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.priceDecimals, payload.priceDecimals);
  top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.config, configToCborMap(payload.config));
  if (payload.profile !== undefined) {
    top.set(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.profile, profileToCborMap(payload.profile));
  }
  return cbor(top);
}

function configToCborMap(config: QrItemConfig): CborMap {
  const map = new CborMap();
  map.set(T3RMINAL_CONFIG_QR_CONFIG_KEYS.id, config.id);
  map.set(T3RMINAL_CONFIG_QR_CONFIG_KEYS.name, config.name);
  map.set(T3RMINAL_CONFIG_QR_CONFIG_KEYS.updatedAt, config.updatedAt);
  map.set(
    T3RMINAL_CONFIG_QR_CONFIG_KEYS.items,
    config.items.map((item) => [item.id, item.name, plancksStringToBigInt(item.pricePlancks)]),
  );
  return map;
}

function profileToCborMap(profile: MerchantProfile): CborMap {
  const map = new CborMap();
  map.set(T3RMINAL_CONFIG_QR_PROFILE_KEYS.name, profile.name);
  if (profile.addressLine1 !== undefined) {
    map.set(T3RMINAL_CONFIG_QR_PROFILE_KEYS.addressLine1, profile.addressLine1);
  }
  if (profile.addressLine2 !== undefined) {
    map.set(T3RMINAL_CONFIG_QR_PROFILE_KEYS.addressLine2, profile.addressLine2);
  }
  if (profile.phone !== undefined) {
    map.set(T3RMINAL_CONFIG_QR_PROFILE_KEYS.phone, profile.phone);
  }
  if (profile.taxId !== undefined) {
    map.set(T3RMINAL_CONFIG_QR_PROFILE_KEYS.taxId, profile.taxId);
  }
  return map;
}

function decodeT3rminalConfigQrUrString(raw: string): DecodedT3rminalConfigQr | null {
  try {
    return decodeT3rminalConfigQrUr(UR.fromURString(raw));
  } catch {
    return null;
  }
}

function decodeT3rminalConfigQrUr(ur: UR): DecodedT3rminalConfigQr | null {
  try {
    if (ur.urTypeStr() !== T3RMINAL_CONFIG_QR_UR_TYPE) return null;
    const payload = cborToPayload(ur.cbor());
    return payload === null ? null : { kind: "v2-ur", payload };
  } catch {
    return null;
  }
}

function cborToPayload(body: Cbor): T3rminalConfigQrPayloadV2 | null {
  const top = body.asMap();
  if (top === undefined) return null;
  const v = unsignedToNumber(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.v));
  if (v !== T3RMINAL_CONFIG_QR_VERSION_V2) return null;
  const passwordScheme = unsignedToNumber(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.passwordScheme));
  if (passwordScheme !== PASSWORD_SCHEME_V1_WIRE) return null;
  const priceDecimals = unsignedToNumber(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.priceDecimals));
  if (priceDecimals !== T3RMINAL_CONFIG_QR_PRICE_DECIMALS) return null;

  const reportPassword = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.reportPassword));
  if (reportPassword === null || !isReportPassword(reportPassword)) return null;

  const configMap = top.get<number, CborMap>(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.config);
  if (!(configMap instanceof CborMap)) return null;
  const config = cborMapToConfig(configMap);
  if (config === null) return null;

  const profileRaw = top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.profile);
  let profile: MerchantProfile | undefined;
  if (profileRaw !== undefined) {
    if (!(profileRaw instanceof CborMap)) return null;
    const parsed = cborMapToProfile(profileRaw);
    if (parsed === null) return null;
    profile = parsed;
  }

  const merchantKey = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.merchantKey));
  const merchantId = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.merchantId));
  const terminalId = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.terminalId));
  const displayName = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.displayName));
  const receivingAddress = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.receivingAddress));
  const issuedAt = textValue(top.get(T3RMINAL_CONFIG_QR_TOP_LEVEL_KEYS.issuedAt));
  if (
    merchantKey === null ||
    merchantId === null ||
    terminalId === null ||
    displayName === null ||
    receivingAddress === null ||
    issuedAt === null
  ) {
    return null;
  }

  return {
    v: T3RMINAL_CONFIG_QR_VERSION_V2,
    type: T3RMINAL_CONFIG_QR_UR_TYPE,
    merchantKey,
    merchantId,
    terminalId,
    displayName,
    receivingAddress,
    passwordScheme: T3RMINAL_REPORT_PASSWORD_SCHEME_V1,
    reportPassword,
    issuedAt,
    priceDecimals: T3RMINAL_CONFIG_QR_PRICE_DECIMALS,
    config,
    ...(profile !== undefined ? { profile } : {}),
  };
}

function cborMapToConfig(map: CborMap): QrItemConfig | null {
  const id = textValue(map.get(T3RMINAL_CONFIG_QR_CONFIG_KEYS.id));
  const name = textValue(map.get(T3RMINAL_CONFIG_QR_CONFIG_KEYS.name));
  const updatedAt = textValue(map.get(T3RMINAL_CONFIG_QR_CONFIG_KEYS.updatedAt));
  const rawItems = map.get<number, unknown[]>(T3RMINAL_CONFIG_QR_CONFIG_KEYS.items);
  if (id === null || name === null || updatedAt === null || !Array.isArray(rawItems)) return null;

  const items: QrItem[] = [];
  for (const rawItem of rawItems) {
    if (!Array.isArray(rawItem)) return null;
    if (rawItem.length !== 3) return null;
    const itemId = textValue(rawItem[T3RMINAL_CONFIG_QR_ITEM_TUPLE_POSITIONS.id]);
    const itemName = textValue(rawItem[T3RMINAL_CONFIG_QR_ITEM_TUPLE_POSITIONS.name]);
    const plancks = unsignedToBigInt(rawItem[T3RMINAL_CONFIG_QR_ITEM_TUPLE_POSITIONS.priceMinorUnits]);
    if (itemId === null || itemName === null || plancks === null) return null;
    items.push({
      id: itemId,
      name: itemName,
      pricePlancks: plancks.toString(10),
      price: plancksToItemPrice(plancks),
    });
  }

  return { id, name, updatedAt, items };
}

function cborMapToProfile(map: CborMap): MerchantProfile | null {
  const name = textValue(map.get(T3RMINAL_CONFIG_QR_PROFILE_KEYS.name));
  if (name === null || name.length === 0) return null;

  const profile: {
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    phone?: string;
    taxId?: string;
  } = { name };

  const addressLine1 = profileTextField(map, T3RMINAL_CONFIG_QR_PROFILE_KEYS.addressLine1);
  if (addressLine1 === null) return null;
  if (addressLine1 !== undefined) profile.addressLine1 = addressLine1;
  const addressLine2 = profileTextField(map, T3RMINAL_CONFIG_QR_PROFILE_KEYS.addressLine2);
  if (addressLine2 === null) return null;
  if (addressLine2 !== undefined) profile.addressLine2 = addressLine2;
  const phone = profileTextField(map, T3RMINAL_CONFIG_QR_PROFILE_KEYS.phone);
  if (phone === null) return null;
  if (phone !== undefined) profile.phone = phone;
  const taxId = profileTextField(map, T3RMINAL_CONFIG_QR_PROFILE_KEYS.taxId);
  if (taxId === null) return null;
  if (taxId !== undefined) profile.taxId = taxId;

  return profile;
}

/**
 * Read an optional profile sub-map field. `undefined` ⇒ key absent
 * (skip), `null` ⇒ key present but not a text string (reject the whole
 * payload), `string` ⇒ use it.
 */
function profileTextField(map: CborMap, key: number): string | null | undefined {
  const raw = map.get(key);
  if (raw === undefined) return undefined;
  return textValue(raw);
}

/**
 * Validate + normalize a build-time profile: `name` must be a
 * non-empty string; each optional field must be a string when present
 * and is dropped entirely when absent so the encoded map stays minimal.
 */
function normalizeMerchantProfile(profile: MerchantProfile | undefined): MerchantProfile | undefined {
  if (profile === undefined) return undefined;
  const name = profile.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("profile.name must be a non-empty string when a profile is supplied.");
  }
  const normalized: {
    name: string;
    addressLine1?: string;
    addressLine2?: string;
    phone?: string;
    taxId?: string;
  } = { name };
  const addressLine1 = optionalProfileString(profile.addressLine1, "profile.addressLine1");
  if (addressLine1 !== undefined) normalized.addressLine1 = addressLine1;
  const addressLine2 = optionalProfileString(profile.addressLine2, "profile.addressLine2");
  if (addressLine2 !== undefined) normalized.addressLine2 = addressLine2;
  const phone = optionalProfileString(profile.phone, "profile.phone");
  if (phone !== undefined) normalized.phone = phone;
  const taxId = optionalProfileString(profile.taxId, "profile.taxId");
  if (taxId !== undefined) normalized.taxId = taxId;
  return normalized;
}

function optionalProfileString(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  return value;
}

function decodeT3rminalConfigQrJson(raw: string): DecodedT3rminalConfigQr | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const o = value as Record<string, unknown>;
    if (o.v !== T3RMINAL_CONFIG_QR_VERSION_V1) return null;
    if (o.type !== T3RMINAL_CONFIG_QR_UR_TYPE) return null;
    if (o.passwordScheme !== T3RMINAL_REPORT_PASSWORD_SCHEME_V1) return null;
    const payload = {
      v: T3RMINAL_CONFIG_QR_VERSION_V1,
      type: T3RMINAL_CONFIG_QR_UR_TYPE,
      merchantKey: stringField(o.merchantKey),
      merchantId: stringField(o.merchantId),
      terminalId: stringField(o.terminalId),
      displayName: stringField(o.displayName),
      receivingAddress: stringField(o.receivingAddress),
      passwordScheme: T3RMINAL_REPORT_PASSWORD_SCHEME_V1,
      reportPassword: stringField(o.reportPassword),
      itemConfigId: stringField(o.itemConfigId),
      itemConfigCid: stringField(o.itemConfigCid),
      registryAddress: stringField(o.registryAddress),
      issuedAt: stringField(o.issuedAt),
    } satisfies T3rminalConfigQrPayloadV1;
    if (!isReportPassword(payload.reportPassword)) return null;
    return { kind: "v1-json", payload };
  } catch {
    return null;
  }
}

function stringField(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function unsignedToNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= MAX_SAFE_PLANCKS ? Number(value) : null;
  }
  return null;
}

function unsignedToBigInt(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_SAFE_PLANCKS) return null;
    return value;
  }
  return null;
}

function plancksStringToBigInt(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error("Item price minor units must be a decimal integer string.");
  const plancks = BigInt(value);
  if (plancks > MAX_CBOR_UINT64) throw new Error("Item price minor units exceed CBOR uint64 range.");
  return plancks;
}

function assertString(value: string, field: string): void {
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
}

function assertReportPassword(value: string): void {
  if (!isReportPassword(value)) {
    throw new Error("reportPassword must be a base64url-encoded 32-byte value without padding.");
  }
}

function isReportPassword(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
